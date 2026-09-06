import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RollingAverage } from '../frontend/js/metrics/rolling-average.js';
import { DistanceTracker } from '../frontend/js/metrics/distance.js';
import { SessionRecorder } from '../frontend/js/session/recorder.js';

describe('RollingAverage', () => {
  test('averages only what is inside the time window', () => {
    const a = new RollingAverage(10000);
    a.push(100, 0);
    a.push(200, 3000);
    a.push(300, 9000);
    assert.equal(a.average(), 200);
    // At t=12s the t=0 sample has aged out of the 10s window.
    a.push(400, 12000);
    assert.equal(a.average(), 300);
  });

  test('is windowed by time, not by sample count', () => {
    // Trainers notify at varying rates, so a count-based window would
    // silently change duration when the rate changed.
    const a = new RollingAverage(1000);
    for (let i = 0; i < 50; i++) a.push(100, i * 10); // 50 samples in 500ms
    assert.equal(a.samples.length, 50, 'all still inside a 1s window');
  });

  test('returns null before any data', () => {
    assert.equal(new RollingAverage().average(), null);
  });
});

describe('DistanceTracker', () => {
  test('uses the device total, baselined at first reading', () => {
    // Some firmware does not start its odometer at zero.
    const d = new DistanceTracker();
    d.update({ totalDistanceM: 5000, instantaneousSpeedKmh: 20 }, 0);
    assert.equal(d.currentTotalM, 0, 'first reading is the baseline');
    d.update({ totalDistanceM: 5100, instantaneousSpeedKmh: 20 }, 1000);
    assert.equal(d.currentTotalM, 100);
  });

  test('integrates speed when the device reports no distance', () => {
    const d = new DistanceTracker();
    d.update({ totalDistanceM: null, instantaneousSpeedKmh: 36 }, 0); // 10 m/s
    const after = d.update({ totalDistanceM: null, instantaneousSpeedKmh: 36 }, 1000);
    assert.equal(Math.round(after), 10);
  });

  test('integration is trapezoidal across a speed change', () => {
    const d = new DistanceTracker();
    d.update({ totalDistanceM: null, instantaneousSpeedKmh: 0 }, 0);
    // 0 -> 36 km/h over 1s averages 5 m/s, so 5m, not 10m.
    const after = d.update({ totalDistanceM: null, instantaneousSpeedKmh: 36 }, 1000);
    assert.equal(Math.round(after), 5);
  });

  test('the mode is chosen once and held for the session', () => {
    const d = new DistanceTracker();
    d.update({ totalDistanceM: null, instantaneousSpeedKmh: 36 }, 0);
    d.update({ totalDistanceM: 9999, instantaneousSpeedKmh: 36 }, 1000);
    assert.equal(d.mode, 'integrated', 'a late device field must not switch modes mid-ride');
  });
});

describe('SessionRecorder', () => {
  test('commits the mean of readings in each window', () => {
    const r = new SessionRecorder();
    r.start(0);
    r.addReading({ power: 100, cadence: 80, speed: 30 });
    r.addReading({ power: 200, cadence: 90, speed: 32 });
    r.commitSample(1000);
    const [sample] = r.getSamples();
    assert.equal(sample.power, 150);
    assert.equal(sample.cadence, 85);
    assert.equal(sample.timestamp_offset_sec, 1);
  });

  test('tracks the true peak across raw readings, not the peak of means', () => {
    // This is the whole point: a short spike inside a window must survive.
    const r = new SessionRecorder();
    r.start(0);
    r.addReading({ power: 100 });
    r.addReading({ power: 600 });
    r.commitSample(1000);
    assert.equal(r.getSamples()[0].power, 350, 'the stored sample is the mean');
    assert.equal(r.getMaxPower(), 600, 'but the peak is preserved separately');
  });

  test('an empty window records nulls rather than repeating stale values', () => {
    // A dropout is a real gap; repeating the last value would invent data.
    const r = new SessionRecorder();
    r.start(0);
    r.addReading({ power: 150 });
    r.commitSample(1000);
    r.commitSample(2000);
    assert.equal(r.getSamples()[1].power, null);
  });

  test('each window is independent', () => {
    const r = new SessionRecorder();
    r.start(0);
    r.addReading({ power: 100 });
    r.commitSample(1000);
    r.addReading({ power: 300 });
    r.commitSample(2000);
    assert.deepEqual(r.getSamples().map((s) => s.power), [100, 300]);
  });

  test('reset clears samples and the peak', () => {
    const r = new SessionRecorder();
    r.start(0);
    r.addReading({ power: 400 });
    r.commitSample(1000);
    r.reset();
    assert.equal(r.getSamples().length, 0);
    assert.equal(r.getMaxPower(), null);
  });
});
