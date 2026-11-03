import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TrainerControl, takesResistance, simulationBytes } from '../frontend/js/ble/trainer-control.js';

// The Fitness Machine Feature value: machine features, then target settings.
function feature(targets) {
  const view = new DataView(new ArrayBuffer(8));
  view.setUint32(4, targets, true);
  return view;
}

// A fake FTMS service: records every control point write and answers it,
// with "op code not supported" for the opcodes in `refuses`.
function fakeService({ targets = null, refuses = [] } = {}) {
  const writes = [];
  const controlPoint = new EventTarget();
  controlPoint.startNotifications = async () => {};
  let busy = false;
  controlPoint.writeValueWithResponse = async (bytes) => {
    // Like Chrome: one GATT operation at a time (here, until the answer).
    if (busy) throw new Error('GATT operation already in progress.');
    busy = true;
    writes.push([...bytes]);
    const value = new DataView(Uint8Array.from([0x80, bytes[0], refuses.includes(bytes[0]) ? 2 : 1]).buffer);
    setTimeout(() => {
      const event = new Event('characteristicvaluechanged');
      Object.defineProperty(event, 'target', { value: { value } });
      busy = false;
      controlPoint.dispatchEvent(event);
    }, 0);
  };
  return {
    writes,
    async getCharacteristic(name) {
      if (name === 'fitness_machine_control_point') return controlPoint;
      if (name === 'fitness_machine_feature' && targets != null) return { readValue: async () => feature(targets) };
      throw new Error('not found');
    },
  };
}

describe('trainer control', () => {
  test('a trainer that takes resistance gets a resistance level', async () => {
    const service = fakeService({ targets: (1 << 2) | (1 << 13) });
    const control = new TrainerControl(service);
    await control.init();
    await control.setResistance(7.5);
    assert.deepEqual(service.writes.at(-1), [0x04, 75]);
  });

  test('a simulation-only trainer (by its features) gets the grade', async () => {
    const service = fakeService({ targets: 1 << 13 });
    const control = new TrainerControl(service, { resistanceToGrade: (level) => (level - 5) / 0.5 });
    await control.init();
    await control.setResistance(6); // 2 %
    assert.deepEqual(service.writes.at(-1), [0x11, 0, 0, 200, 0, 40, 51]);
    assert.equal(service.writes.some((w) => w[0] === 0x04), false);
  });

  test('a refused 0x04 switches to simulation for good', async () => {
    const service = fakeService({ refuses: [0x04] });
    const control = new TrainerControl(service);
    await control.init();
    await control.setResistance(5); // the flat
    await control.setResistance(3); // -5 %
    assert.deepEqual(service.writes.map((w) => w[0]), [0x04, 0x11, 0x11]);
    assert.deepEqual(service.writes.at(-1).slice(3, 5), [0x0c, 0xfe]); // -500
  });

  test('other refusals still fail', async () => {
    const service = fakeService({ refuses: [0x04, 0x11] });
    const control = new TrainerControl(service);
    await control.init();
    await assert.rejects(control.setResistance(5), /op code not supported/);
  });

  test('commands asked for at once go one at a time; only the latest target is sent', async () => {
    const service = fakeService({ targets: 1 << 2 });
    const control = new TrainerControl(service);
    await control.init();
    await Promise.all([control.requestControl(), control.setResistance(5), control.setResistance(6), control.setResistance(7)]);
    assert.deepEqual(service.writes, [[0x00], [0x04, 70]]);
  });

  test('a failed command doesn\'t block the next', async () => {
    const service = fakeService({ targets: 1 << 2, refuses: [0x01] });
    const control = new TrainerControl(service);
    await control.init();
    const [reset, resistance] = await Promise.allSettled([control.reset(), control.setResistance(4)]);
    assert.equal(reset.status, 'rejected');
    assert.equal(resistance.status, 'fulfilled');
    assert.deepEqual(service.writes.at(-1), [0x04, 40]);
  });

  test('feature bits and simulation bytes', () => {
    assert.equal(takesResistance(null), true);
    assert.equal(takesResistance(feature(0)), true);
    assert.equal(takesResistance(feature(1 << 13)), false);
    assert.deepEqual(simulationBytes(40).slice(3, 5), [0xd0, 0x07]); // clamped to 20 %
  });
});
