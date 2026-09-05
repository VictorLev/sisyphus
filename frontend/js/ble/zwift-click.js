// Zwift Click v2 — proprietary Zwift BLE service, not FTMS.
//
// Protocol constants and framing confirmed against OpenBikeControl
// (github.com/OpenBikeControl/bikecontrol) and the makinolo teardown
// (makinolo.com/blog/2024/07/26/zwift-ride-protocol/), and verified against
// the actual hardware. The Click v2 uses the Zwift Ride protocol: button
// state arrives as 0x23 frames carrying a 32-bit little-endian bitmap where
// a CLEARED bit means pressed (see RIDE_BUTTON_BITS below).
//
// Two things about this hardware drive the connection logic here:
//  - It is the "encrypted" variant: it sends a public-key handshake (0xFF
//    0x03 …) we don't answer, yet it still streams button frames in
//    plaintext — so no crypto is implemented.
//  - It SLEEPS after ~1 minute idle and needs a physical button press to
//    wake. An idle unit therefore drops mid-ride; the wake-press is what
//    triggers our auto-reconnect. Nothing sent over BLE keeps it awake.

// Two possible service UUIDs: newer Click firmware exposes 0xFC82, older
// firmware the legacy 128-bit custom UUID. The three characteristics keep
// the same UUIDs under either service.
const SERVICE_FC82 = '0000fc82-0000-1000-8000-00805f9b34fb';
const SERVICE_LEGACY = '00000001-19ca-4651-86e5-fa29dcdd09d1';
const CHAR_ASYNC = '00000002-19ca-4651-86e5-fa29dcdd09d1'; // notify: button data
const CHAR_SYNC_RX = '00000003-19ca-4651-86e5-fa29dcdd09d1'; // write: handshake
const CHAR_SYNC_TX = '00000004-19ca-4651-86e5-fa29dcdd09d1'; // indicate: handshake reply

const RIDE_ON = Uint8Array.from([0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e]); // "RideOn"

// First byte of every notification is a message type.
const MSG_EMPTY = 0x15; // keepalive, arrives constantly when idle
const MSG_BATTERY = 0x19; // 25
const MSG_CLICK_BUTTONS = 0x37; // 55  — old Click (two-field ClickKeyPadStatus)
const MSG_RIDE_BUTTONS = 0x23; //  35 — Click v2 / Ride (inverted button bitmask)
const MSG_DISCONNECT = 0xfe;

// Ride-protocol button bitmask (field 1 of a 0x23 frame). On the wire the
// value is INVERTED — idle is all-ones and a press clears the button's bit
// — so we invert before testing. Bit indices per OpenBikeControl's
// RideButtonMask.
const RIDE_BUTTON_BITS = {
  0: 'LEFT', 1: 'UP', 2: 'RIGHT', 3: 'DOWN',
  4: 'A', 5: 'B', 6: 'Y', 7: 'Z',
  8: 'SHIFT_UP_L', 9: 'SHIFT_DN_L', 10: 'POWERUP_L', 11: 'ONOFF_L',
  12: 'SHIFT_UP_R', 13: 'SHIFT_DN_R', 14: 'POWERUP_R', 15: 'ONOFF_R',
};

// Minimal protobuf reader. The button payload is just two varint fields, so
// pulling in a protobuf library would be overkill.
function decodeVarintFields(bytes) {
  const fields = {};
  let i = 0;
  while (i < bytes.length) {
    const tag = bytes[i++];
    if ((tag & 0x07) !== 0) break; // non-varint: not something we expect
    const fieldNumber = tag >> 3;
    let value = 0;
    let shift = 0;
    let byte;
    do {
      if (i >= bytes.length) return fields;
      byte = bytes[i++];
      value |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    fields[fieldNumber] = value;
  }
  return fields;
}

// Counter-intuitive, and worth stating plainly: in Zwift's enum ON = 0 and
// OFF = 1, ON means *pressed*, and the field's protobuf default is ON. So a
// field missing from the wire reads as pressed, and 0 means pressed.
function isPressed(value) {
  return (value ?? 0) === 0;
}

export class ZwiftClickConnection extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.syncRxCharacteristic = null;
    this.batteryLevel = null;
    // The Click repeats the same state message many times per press, so
    // shifts are emitted on the transition into "pressed", not per message.
    this._plusPressed = false;
    this._minusPressed = false;
    this._prevMask = 0; // Ride-protocol pressed-bit mask, previous frame
    this._intentionalDisconnect = false;
    this._reconnectTimer = null;
    this._streamMonitor = null;
    this._keepaliveTimer = null;
    this._lastDataAt = 0; // timestamp of the last frame received; 0 = none yet
    this._connectedAt = 0;
    this._silentRestarts = 0;
    this._onAsyncValue = this._onAsyncValue.bind(this);
    this._onDisconnected = this._onDisconnected.bind(this);
  }

  // Call from a click handler — requestDevice needs transient activation.
  async connect() {
    // The Click does not advertise its custom service UUID, so a service
    // filter never matches and Chrome's chooser comes up empty. Match on
    // the device name and on Zwift's Bluetooth manufacturer ID (0x094A)
    // instead — the same way BikeControl identifies these controllers —
    // and request access to the service via optionalServices.
    this.device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: 'Zwift' },
        { manufacturerData: [{ companyIdentifier: 0x094a }] },
      ],
      optionalServices: [SERVICE_FC82, SERVICE_LEGACY, 'battery_service', 'device_information'],
    });
    this.device.addEventListener('gattserverdisconnected', this._onDisconnected);
    this._intentionalDisconnect = false;
    await this._openAndSetup();
  }

  // Everything after device selection — reused by both connect() and the
  // auto-reconnect path (a known device's gatt.connect() needs no gesture).
  async _openAndSetup() {
    this._prevMask = 0; // don't carry a stale pressed-state across a reconnect
    const server = await this.device.gatt.connect();

    let service = null;
    for (const uuid of [SERVICE_FC82, SERVICE_LEGACY]) {
      try {
        service = await server.getPrimaryService(uuid);
        break;
      } catch {
        // not this one — try the other
      }
    }
    if (!service) {
      // Surface whatever Chrome was allowed to see, so a miss produces a
      // diagnosable error instead of a dead end.
      let visible = [];
      try {
        visible = (await server.getPrimaryServices()).map((s) => s.uuid);
      } catch { /* enumeration itself can fail; report empty */ }
      throw new Error(
        `no Zwift service found (tried fc82 and legacy). Visible services: ${visible.join(', ') || '(none)'}`
      );
    }
    this.serviceUuid = service.uuid;

    const asyncChar = await service.getCharacteristic(CHAR_ASYNC);
    const syncTx = await service.getCharacteristic(CHAR_SYNC_TX);
    this.syncRxCharacteristic = await service.getCharacteristic(CHAR_SYNC_RX);

    asyncChar.addEventListener('characteristicvaluechanged', this._onAsyncValue);
    await asyncChar.startNotifications();
    await syncTx.startNotifications(); // handshake reply arrives as an indication

    this._lastDataAt = 0;
    this._connectedAt = Date.now();
    await this._sendStartSequence();

    this.dispatchEvent(new CustomEvent('connected', { detail: { deviceName: this.device.name } }));

    this._startStreamMonitor();
    this._startKeepalive();
  }

  // Proactive session refresh. An un-unlocked left unit kills its stream
  // roughly a minute after the last start command — and once dead, nothing
  // over BLE revives it (verified on hardware). So don't let it die:
  // re-send the start command well inside that window.
  _startKeepalive() {
    clearInterval(this._keepaliveTimer);
    this._keepaliveTimer = setInterval(() => {
      if (this._intentionalDisconnect || !this.device?.gatt?.connected) return;
      this.syncRxCharacteristic
        ?.writeValueWithoutResponse(Uint8Array.from([0xff, 0x04, 0x00]))
        .catch(() => { /* a truly dead session is the stream monitor's job */ });
    }, 25000);
  }

  async _sendStartSequence() {
    // Handshake: the device stays silent until it receives RideOn.
    await this.syncRxCharacteristic.writeValueWithoutResponse(RIDE_ON);
    // Click v2 firmware needs a follow-up start command before it streams
    // button frames — RideOn alone leaves it sending only telemetry.
    await new Promise((r) => setTimeout(r, 250));
    try {
      await this.syncRxCharacteristic.writeValueWithoutResponse(Uint8Array.from([0xff, 0x04, 0x00]));
    } catch (err) {
      console.warn('[zwift-click] start command rejected:', err.message);
    }
  }

  // Continuous stream monitor. A live unit chatters constantly (keepalives
  // and idle button frames), so a few seconds of silence means the stream
  // died — which the un-unlocked LEFT unit does roughly once a minute (see
  // PROMPT.md on the Click v2 daily lock). Rather than requiring the daily
  // Zwift unlock, this automates the "quick restart": re-send the start
  // sequence, and if that doesn't revive it, cycle the connection (which
  // hands off to the auto-reconnect path).
  _startStreamMonitor() {
    clearInterval(this._streamMonitor);
    this._silentRestarts = 0;
    this._streamMonitor = setInterval(async () => {
      if (this._intentionalDisconnect || !this.device?.gatt?.connected) return;
      const lastAlive = Math.max(this._lastDataAt, this._connectedAt);
      if (Date.now() - lastAlive < 4000) return;

      this._silentRestarts += 1;
      this.dispatchEvent(new CustomEvent('stream-restart', { detail: { attempt: this._silentRestarts } }));
      if (this._silentRestarts <= 2) {
        console.warn(`[zwift-click] stream silent, re-sending start (try ${this._silentRestarts})`);
        try {
          await this._sendStartSequence();
        } catch { /* retry on the next tick */ }
        this._connectedAt = Date.now(); // give the re-send time to take effect
      } else {
        console.warn('[zwift-click] stream not reviving, cycling the connection');
        this._silentRestarts = 0;
        try {
          this.device.gatt.disconnect(); // triggers the auto-reconnect path
        } catch { /* reconnect path handles it */ }
      }
    }, 2000);
  }

  disconnect() {
    this._intentionalDisconnect = true;
    clearTimeout(this._reconnectTimer);
    clearInterval(this._streamMonitor);
    clearInterval(this._keepaliveTimer);
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
  }

  // On an unexpected drop, keep retrying until the rider disconnects on
  // purpose. A sleeping unit wakes only on a physical button press — at an
  // arbitrary later moment — so a persistent pending reconnect is what
  // catches it the instant that press happens. After a few quick failures
  // we tell the UI the unit is asleep, then keep retrying quietly.
  async _attemptReconnect(attempt = 1) {
    if (this._intentionalDisconnect) return;
    if (attempt <= 4) {
      this.dispatchEvent(new CustomEvent('reconnecting', { detail: { attempt, deviceName: this.device?.name } }));
    } else if (attempt === 5) {
      this.dispatchEvent(new CustomEvent('awaiting-wake', { detail: { deviceName: this.device?.name } }));
    }
    try {
      await this._openAndSetup();
    } catch {
      this._reconnectTimer = setTimeout(
        () => this._attemptReconnect(attempt + 1),
        Math.min(3000, 1000 + attempt * 500)
      );
    }
  }

  _onAsyncValue(event) {
    const bytes = new Uint8Array(event.target.value.buffer);
    if (bytes.length === 0) return;

    this._lastDataAt = Date.now(); // any frame counts as "streaming"
    this._silentRestarts = 0;

    const type = bytes[0];
    const payload = bytes.subarray(1);

    switch (type) {
      case MSG_EMPTY:
        return;
      case MSG_BATTERY:
        if (payload.length > 1 && payload[1] !== this.batteryLevel) {
          this.batteryLevel = payload[1];
          this.dispatchEvent(new CustomEvent('battery', { detail: { level: this.batteryLevel } }));
        }
        return;
      case MSG_CLICK_BUTTONS:
        this._handleButtons(payload);
        return;
      case MSG_RIDE_BUTTONS:
        this._handleRideButtons(payload);
        return;
      case MSG_DISCONNECT:
        this.dispatchEvent(new CustomEvent('disconnected'));
        return;
      default:
        this.dispatchEvent(new CustomEvent('unknown-message', { detail: { type, bytes } }));
    }
  }

  _handleButtons(payload) {
    // An empty payload carries no button state, but because the protobuf
    // default is "pressed" it would otherwise decode as both buttons down
    // and fire two spurious shifts. Absent *individual* fields are still
    // meaningful (that is how a real press arrives), so only the wholly
    // empty case is rejected.
    if (payload.length === 0) return;

    const fields = decodeVarintFields(payload);
    const plus = isPressed(fields[1]);
    const minus = isPressed(fields[2]);

    if (plus && !this._plusPressed) {
      this.dispatchEvent(new CustomEvent('shift', { detail: { direction: 'up' } }));
    }
    if (minus && !this._minusPressed) {
      this.dispatchEvent(new CustomEvent('shift', { detail: { direction: 'down' } }));
    }
    this._plusPressed = plus;
    this._minusPressed = minus;
  }

  _handleRideButtons(payload) {
    if (payload.length === 0) return;
    const fields = decodeVarintFields(payload);
    if (!(1 in fields)) return;

    // Invert (pressed bits become 1) and keep 32 bits unsigned.
    const pressed = (~fields[1]) >>> 0;
    const newlyPressed = (pressed & ~this._prevMask) >>> 0;
    this._prevMask = pressed;

    for (let bit = 0; bit < 24; bit++) {
      if (!((newlyPressed >>> bit) & 1)) continue;
      const name = RIDE_BUTTON_BITS[bit] ?? `bit${bit}`;
      this.dispatchEvent(new CustomEvent('button', { detail: { name, bit } }));
      // Map the two shifter buttons to the app-facing shift event. Confirmed
      // against the hardware: + reports as SHIFT_UP_R (bit 12). The app
      // listens only for these two bits, so presses on any other button are
      // ignored — which also filters button-grid noise.
      // Confirmed against this unit: + = SHIFT_UP_R (bit 12), - = SHIFT_UP_L (bit 8).
      if (name === 'SHIFT_UP_R') this.dispatchEvent(new CustomEvent('shift', { detail: { direction: 'up' } }));
      if (name === 'SHIFT_UP_L') this.dispatchEvent(new CustomEvent('shift', { detail: { direction: 'down' } }));
    }
  }

  _onDisconnected() {
    this.dispatchEvent(new CustomEvent('disconnected', { detail: { intentional: this._intentionalDisconnect } }));
    if (!this._intentionalDisconnect) this._attemptReconnect();
  }
}

export const ZWIFT_CLICK_INTERNALS = { SERVICE_FC82, SERVICE_LEGACY, CHAR_ASYNC, CHAR_SYNC_RX, CHAR_SYNC_TX, decodeVarintFields, isPressed };
