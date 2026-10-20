import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { VirtualSpeed, steadySpeedKmh } from '../frontend/js/metrics/virtual-speed.js';

// Rides a steady effort for `seconds`, one reading per second.
function ride(model, { watts, grade = 0, seconds, startMs = 0 }) {
  let t = startMs;
  for (let i = 0; i <= seconds; i++, t += 1000) model.update(watts, grade, t);
  return { kmh: model.speedKmh, endMs: t - 1000 };
}

describe('steady speed', () => {
  test('200 W on the flat is a believable road speed', () => {
    const kmh = steadySpeedKmh(200, 84, 0);
    assert.ok(kmh > 31 && kmh < 35, `${kmh.toFixed(1)} km/h`);
  });

  test('weight barely matters on the flat and a lot up a climb', () => {
    const flatGap = steadySpeedKmh(200, 70, 0) - steadySpeedKmh(200, 100, 0);
    const climbGap = steadySpeedKmh(200, 70, 8) - steadySpeedKmh(200, 100, 8);
    assert.ok(flatGap > 0 && flatGap < 1.5, `flat: ${flatGap.toFixed(2)} km/h`);
    assert.ok(climbGap > 3, `8%: ${climbGap.toFixed(2)} km/h`);
    assert.ok(steadySpeedKmh(200, 84, 8) < steadySpeedKmh(200, 84, 0) / 2);
  });

  test('no power, no speed (on the flat)', () => {
    assert.equal(steadySpeedKmh(0, 84, 0), 0);
  });
});

describe('riding', () => {
  test('a steady effort settles at the steady speed', () => {
    const model = new VirtualSpeed({ riderKg: 75, bikeKg: 9 });
    const { kmh } = ride(model, { watts: 200, seconds: 120 });
    assert.ok(Math.abs(kmh - steadySpeedKmh(200, 84, 0)) < 0.3, `${kmh.toFixed(2)} km/h`);
  });

  test('a heavier rider is slower to get going', () => {
    const light = new VirtualSpeed({ riderKg: 60, bikeKg: 8 });
    const heavy = new VirtualSpeed({ riderKg: 100, bikeKg: 12 });
    assert.ok(ride(light, { watts: 250, seconds: 5 }).kmh > ride(heavy, { watts: 250, seconds: 5 }).kmh);
  });

  test('a heavier rider is slower up a climb', () => {
    const light = new VirtualSpeed({ riderKg: 60, bikeKg: 8 });
    const heavy = new VirtualSpeed({ riderKg: 100, bikeKg: 12 });
    const a = ride(light, { watts: 250, grade: 6, seconds: 90 }).kmh;
    const b = ride(heavy, { watts: 250, grade: 6, seconds: 90 }).kmh;
    assert.ok(a - b > 4, `${a.toFixed(1)} vs ${b.toFixed(1)} km/h`);
  });

  test('stopping pedalling coasts down rather than stopping dead', () => {
    const model = new VirtualSpeed();
    const { kmh: cruising, endMs } = ride(model, { watts: 200, seconds: 60 });
    model.update(0, 0, endMs + 1000);
    assert.ok(model.speedKmh > cruising * 0.85, 'one second later, still rolling');
    ride(model, { watts: 0, seconds: 300, startMs: endMs + 2000 });
    assert.ok(model.speedKmh < 3, 'eventually stops');
  });

  test('a pause is not ridden through, and a long gap counts as two seconds', () => {
    const model = new VirtualSpeed();
    const { endMs } = ride(model, { watts: 200, seconds: 30 });
    model.resume();
    assert.equal(model.speedKmh, 0);
    model.update(200, 0, endMs + 600_000);
    assert.equal(model.speedKmh, 0, 'the first reading after a pause only sets the clock');
    const fresh = new VirtualSpeed();
    fresh.update(300, 0, 0);
    fresh.update(300, 0, 60_000);
    const two = new VirtualSpeed();
    two.update(300, 0, 0);
    two.update(300, 0, 2000);
    assert.equal(fresh.speedKmh, two.speedKmh);
  });

  test('weights out of range fall back to a typical rider and bike', () => {
    const model = new VirtualSpeed({ riderKg: 0, bikeKg: -1 });
    assert.equal(model.massKg, 84);
    model.configure({ riderKg: 90 });
    assert.equal(model.massKg, 99);
  });
});
