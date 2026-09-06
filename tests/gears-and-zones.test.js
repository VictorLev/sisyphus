import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GearModel } from '../frontend/js/gears.js';
import { ZONES, zoneForWatts, wattsForZone, estimatedLoad } from '../frontend/js/zones.js';

describe('GearModel', () => {
  test('spreads gears evenly between min and max resistance', () => {
    const g = new GearModel({ gearCount: 11, minResistance: 0, maxResistance: 10, startGear: 1 });
    assert.equal(g.resistance, 0);
    g.shiftUp();
    assert.equal(Math.round(g.resistance * 10) / 10, 1);
  });

  test('clamps at both end stops and reports whether it moved', () => {
    const g = new GearModel({ gearCount: 3, startGear: 1 });
    assert.equal(g.shiftDown(), false, 'already at the bottom');
    assert.equal(g.shiftUp(), true);
    assert.equal(g.shiftUp(), true);
    assert.equal(g.shiftUp(), false, 'already at the top');
    assert.equal(g.gearNumber, 3);
  });

  test('emits a change event carrying the new resistance', () => {
    const g = new GearModel({ gearCount: 5, minResistance: 0, maxResistance: 8, startGear: 1 });
    const seen = [];
    g.addEventListener('change', (e) => seen.push(e.detail));
    g.shiftUp();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].gear, 2);
    assert.equal(seen[0].resistance, 2);
  });

  test('reconfiguring keeps the current gear where possible', () => {
    const g = new GearModel({ gearCount: 12, startGear: 8 });
    g.configure({ maxResistance: 12 });
    assert.equal(g.gearNumber, 8, 'gear preserved when only resistance changes');
  });

  test('shrinking the gear count clamps rather than going out of range', () => {
    const g = new GearModel({ gearCount: 12, startGear: 10 });
    g.configure({ gearCount: 4 });
    assert.equal(g.gearNumber, 4);
    assert.ok(Number.isFinite(g.resistance));
  });

  test('a single-gear drivetrain does not divide by zero', () => {
    const g = new GearModel({ gearCount: 1, minResistance: 3, maxResistance: 9 });
    assert.equal(g.resistance, 3);
  });
});

describe('power zones', () => {
  test('classifies against FTP at the documented boundaries', () => {
    const ftp = 200;
    assert.equal(zoneForWatts(100, ftp).name, 'Z1'); // 50%
    assert.equal(zoneForWatts(120, ftp).name, 'Z2'); // 60%
    assert.equal(zoneForWatts(160, ftp).name, 'Z3'); // 80%
    assert.equal(zoneForWatts(200, ftp).name, 'Z4'); // 100%
    assert.equal(zoneForWatts(220, ftp).name, 'Z5'); // 110%
    assert.equal(zoneForWatts(300, ftp).name, 'Z6'); // 150%
  });

  test('a boundary value falls in the upper zone', () => {
    // 55% is the Z1/Z2 edge; it should read as Z2, not Z1.
    assert.equal(zoneForWatts(110, 200).name, 'Z2');
  });

  test('every zone is reachable and ordered', () => {
    const ftp = 200;
    const names = ZONES.map((z) => zoneForWatts(wattsForZone(z, ftp), ftp).name);
    assert.deepEqual(names, ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6']);
  });

  test('falls back sanely with no FTP set', () => {
    assert.ok(zoneForWatts(200, null));
    assert.equal(estimatedLoad([{ duration_sec: 3600, target_watts: 200 }], null), null);
  });

  test('an hour at FTP is a load of about 100', () => {
    const load = estimatedLoad([{ duration_sec: 3600, target_watts: 200 }], 200);
    assert.equal(load, 100);
  });
});
