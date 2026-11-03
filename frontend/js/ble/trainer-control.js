// FTMS Fitness Machine Control Point (0x2AD9) — the write path for
// resistance / ERG / simulation. Operates on an already-connected
// fitness_machine service (shared with the Indoor Bike Data notifications),
// so the trainer is opened once and used for both data and control.
//
// Every command must be preceded by Request Control (0x00), and the trainer
// answers each write with an indication [0x80, requestOpCode, resultCode].
//
// Not every trainer takes a resistance level: smart bikes like the Ascend
// S2 answer 0x04 with "op code not supported" and only accept simulation
// (grade). The Fitness Machine Feature characteristic says which, and a
// refused 0x04 says it too; either way resistance is then written as the
// grade it stands for (resistanceToGrade).
//
// The browser runs one GATT operation at a time ("GATT operation already in
// progress" otherwise), and FTMS answers one command at a time, so commands
// queue: each waits for the previous one's indication. Targets (resistance,
// grade, power) only matter as the latest: a target that's been overtaken
// while it waited is skipped, so fast shifting doesn't build a backlog.

const CHAR_CONTROL_POINT = 'fitness_machine_control_point'; // 0x2AD9
const CHAR_FEATURE = 'fitness_machine_feature'; // 0x2ACC

const OP_REQUEST_CONTROL = 0x00;
const OP_RESET = 0x01;
const OP_SET_TARGET_RESISTANCE = 0x04;
const OP_SET_TARGET_POWER = 0x05; // ERG
const OP_SET_SIMULATION = 0x11; // grade
const OP_RESPONSE = 0x80;

const RESULT_NOT_SUPPORTED = 2;

// Target Setting Features bits (second UINT32 of 0x2ACC).
const TARGET_RESISTANCE = 1 << 2;
const TARGET_SIMULATION = 1 << 13;

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

// Simulation grades are kept to what a road can be.
const GRADE_MIN = -10;
const GRADE_MAX = 20;

// Without the rider's settings: level 5 is the flat, 0.4 a percent.
const defaultResistanceToGrade = (level) => (level - 5) / 0.4;

// From the Fitness Machine Feature value: false when the trainer says it
// can't take a resistance level but can simulate grade, true otherwise
// (including when it doesn't say).
export function takesResistance(dataView) {
  if (!dataView || dataView.byteLength < 8) return true;
  const targets = dataView.getUint32(4, true);
  return !(!(targets & TARGET_RESISTANCE) && (targets & TARGET_SIMULATION));
}

// Simulation parameters: wind 0, grade in 0.01 %, Crr 0.004, Cw 0.51 kg/m.
export function simulationBytes(gradePercent) {
  const g = Math.round(Math.max(GRADE_MIN, Math.min(GRADE_MAX, gradePercent)) * 100);
  return [OP_SET_SIMULATION, 0, 0, g & 0xff, (g >> 8) & 0xff, 40, 51];
}

export class TrainerControl extends EventTarget {
  constructor(service, { resistanceToGrade = defaultResistanceToGrade } = {}) {
    super();
    this.service = service;
    this.resistanceToGrade = resistanceToGrade;
    this.useSimulation = false;
    this.controlPoint = null;
    this._pending = null; // { op, resolve, reject, timer }
    this._queue = Promise.resolve();
    this._targetSeq = 0;
    this._onIndication = this._onIndication.bind(this);
  }

  async init() {
    this.controlPoint = await this.service.getCharacteristic(CHAR_CONTROL_POINT);
    await this.controlPoint.startNotifications();
    this.controlPoint.addEventListener('characteristicvaluechanged', this._onIndication);
    try {
      const feature = await this.service.getCharacteristic(CHAR_FEATURE);
      const value = await feature.readValue();
      this.useSimulation = !takesResistance(value);
      if (value.byteLength >= 8) {
        console.info(`[trainer] FTMS target settings 0x${value.getUint32(4, true).toString(16)}${this.useSimulation ? ', simulation only: resistance sent as grade' : ''}`);
      }
    } catch {
      // Optional to read; a refused 0x04 switches over anyway.
    }
  }

  requestControl() {
    return this._command([OP_REQUEST_CONTROL]);
  }

  reset() {
    return this._command([OP_RESET]);
  }

  // level: 0.0–20.0 (clamped). Written as UINT8 raw = level / 0.1.
  // On a simulation-only trainer, the grade the level stands for.
  async setResistance(level) {
    const clamped = Math.max(0, Math.min(RESISTANCE_MAX, level));
    if (this.useSimulation) return this.setGrade(this.resistanceToGrade(clamped));
    const raw = Math.max(0, Math.min(RESISTANCE_RAW_MAX, Math.round(clamped / 0.1)));
    try {
      await this._target([OP_SET_TARGET_RESISTANCE, raw]);
    } catch (err) {
      if (err.result !== RESULT_NOT_SUPPORTED) throw err;
      this.useSimulation = true;
      console.info('[trainer] resistance level refused (0x04); sending grade from now on');
      return this.setGrade(this.resistanceToGrade(clamped));
    }
  }

  // Indoor Bike Simulation: the trainer makes the grade feel like a road.
  setGrade(gradePercent) {
    return this._target(simulationBytes(gradePercent));
  }

  // ERG target, SINT16 little-endian watts.
  setPower(watts) {
    const w = Math.max(0, Math.min(4000, Math.round(watts)));
    return this._target([OP_SET_TARGET_POWER, w & 0xff, (w >> 8) & 0xff]);
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
      if (ok) resolve();
      else reject(Object.assign(new Error(`opcode 0x${reqOp.toString(16).padStart(2, '0')}: ${RESULT[result] ?? result}`), { result }));
    }
  }

  // Every command, in order, one at a time.
  _command(bytes) {
    return this._enqueue(() => this._send(bytes));
  }

  // A target: sent unless a newer target was asked for while it waited.
  _target(bytes) {
    const ticket = ++this._targetSeq;
    return this._enqueue(() => (ticket === this._targetSeq ? this._send(bytes) : undefined));
  }

  _enqueue(job) {
    const run = this._queue.then(job, job);
    this._queue = run.catch(() => {}); // a failure doesn't stop the next one
    return run;
  }

  _send(bytes, timeoutMs = 2000) {
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

export const TRAINER_CONTROL_INTERNALS = { OP_SET_TARGET_RESISTANCE, OP_SET_SIMULATION, RESISTANCE_MAX, RESISTANCE_RAW_MAX };
