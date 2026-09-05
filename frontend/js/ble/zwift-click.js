// Zwift Click — proprietary Zwift BLE service, not FTMS.
//
// Protocol constants and framing confirmed against OpenBikeControl
// (github.com/OpenBikeControl/bikecontrol, lib/bluetooth/devices/zwift/),
// which is a working third-party implementation rather than a published
// spec. Verified against real hardware: see PROMPT.md.

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

    // Handshake: the device stays silent until it receives this.
    await this.syncRxCharacteristic.writeValueWithoutResponse(RIDE_ON);

    // Click v2 firmware needs a follow-up start command before it streams
    // button frames — RideOn alone leaves it sending only telemetry. This is
    // the command OpenBikeControl sends to an unlocked Click v2.
    await new Promise((r) => setTimeout(r, 250));
    try {
      await this.syncRxCharacteristic.writeValueWithoutResponse(Uint8Array.from([0xff, 0x04, 0x00]));
    } catch (err) {
      // Non-fatal: older Click firmware streams without it.
      console.warn('[zwift-click] start command rejected:', err.message);
    }

    this.dispatchEvent(new CustomEvent('connected', { detail: { deviceName: this.device.name } }));
  }

  disconnect() {
    this._intentionalDisconnect = true;
    clearTimeout(this._reconnectTimer);
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
  }

  // On an unexpected drop, retry the connection a handful of times with a
  // short backoff. The units sleep/drop occasionally; this keeps shifting
  // alive without the rider re-picking the device.
  async _attemptReconnect(attempt = 1) {
    const MAX_ATTEMPTS = 6;
    if (this._intentionalDisconnect || attempt > MAX_ATTEMPTS) {
      if (attempt > MAX_ATTEMPTS) {
        this.dispatchEvent(new CustomEvent('reconnect-failed', { detail: { deviceName: this.device?.name } }));
      }
      return;
    }
    this.dispatchEvent(new CustomEvent('reconnecting', { detail: { attempt, deviceName: this.device?.name } }));
    try {
      await this._openAndSetup();
    } catch {
      this._reconnectTimer = setTimeout(() => this._attemptReconnect(attempt + 1), 1500);
    }
  }

  _onAsyncValue(event) {
    const bytes = new Uint8Array(event.target.value.buffer);
    if (bytes.length === 0) return;

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
