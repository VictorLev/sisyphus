// FTMS Fitness Machine Control Point (0x2AD9) — the write path for
// resistance / ERG / simulation. Operates on an already-connected
// fitness_machine service (shared with the Indoor Bike Data notifications),
// so the trainer is opened once and used for both data and control.
//
// Every command must be preceded by Request Control (0x00), and the trainer
// answers each write with an indication [0x80, requestOpCode, resultCode].

const CHAR_CONTROL_POINT = 'fitness_machine_control_point'; // 0x2AD9

const OP_REQUEST_CONTROL = 0x00;
const OP_RESET = 0x01;
const OP_SET_TARGET_RESISTANCE = 0x04;
const OP_SET_TARGET_POWER = 0x05; // ERG
const OP_SET_SIMULATION = 0x11; // grade
const OP_RESPONSE = 0x80;

const RESULT = {
  1: 'success',
  2: 'op code not supported',
  3: 'invalid parameter',
  4: 'operation failed',
  5: 'control not permitted',
};

// Device resistance domain is 0.0–20.0 at 0.1 resolution (per 0x2AD6).
const RESISTANCE_MAX = 20.0;
const RESISTANCE_RAW_MAX = 200;

export class TrainerControl extends EventTarget {
  constructor(service) {
    super();
    this.service = service;
    this.controlPoint = null;
    this._pending = null; // { op, resolve, reject, timer }
    this._onIndication = this._onIndication.bind(this);
  }

  async init() {
    this.controlPoint = await this.service.getCharacteristic(CHAR_CONTROL_POINT);
    await this.controlPoint.startNotifications();
    this.controlPoint.addEventListener('characteristicvaluechanged', this._onIndication);
  }

  requestControl() {
    return this._command([OP_REQUEST_CONTROL]);
  }

  reset() {
    return this._command([OP_RESET]);
  }

  // level: 0.0–20.0 (clamped). Written as UINT8 raw = level / 0.1.
  setResistance(level) {
    const clamped = Math.max(0, Math.min(RESISTANCE_MAX, level));
    const raw = Math.max(0, Math.min(RESISTANCE_RAW_MAX, Math.round(clamped / 0.1)));
    return this._command([OP_SET_TARGET_RESISTANCE, raw]);
  }

  // ERG target, SINT16 little-endian watts.
  setPower(watts) {
    const w = Math.max(0, Math.min(4000, Math.round(watts)));
    return this._command([OP_SET_TARGET_POWER, w & 0xff, (w >> 8) & 0xff]);
  }

  _onIndication(event) {
    const bytes = new Uint8Array(event.target.value.buffer);
    if (bytes[0] !== OP_RESPONSE) return;

    const reqOp = bytes[1];
    const result = bytes[2];
    const ok = result === 1;
    this.dispatchEvent(new CustomEvent('ack', {
      detail: { reqOp, result, ok, message: RESULT[result] ?? `unknown (${result})` },
    }));

    if (this._pending && this._pending.op === reqOp) {
      const { resolve, reject, timer } = this._pending;
      clearTimeout(timer);
      this._pending = null;
      ok ? resolve() : reject(new Error(`opcode 0x${reqOp.toString(16).padStart(2, '0')}: ${RESULT[result] ?? result}`));
    }
  }

  _command(bytes, timeoutMs = 2000) {
    const op = bytes[0];
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pending?.op === op) {
          this._pending = null;
          reject(new Error(`ack timeout for opcode 0x${op.toString(16).padStart(2, '0')}`));
        }
      }, timeoutMs);
      this._pending = { op, resolve, reject, timer };

      // Control Point is a write-with-response characteristic. A failed write
      // rejects the same promise the ack would have resolved.
      this.controlPoint.writeValueWithResponse(Uint8Array.from(bytes)).catch((err) => {
        if (this._pending?.op === op) {
          clearTimeout(timer);
          this._pending = null;
          reject(err);
        }
      });
    });
  }
}

export const TRAINER_CONTROL_INTERNALS = { OP_SET_TARGET_RESISTANCE, RESISTANCE_MAX, RESISTANCE_RAW_MAX };
