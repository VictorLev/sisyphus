import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseIndoorBikeData } from '../frontend/js/ble/ftms-parser.js';

// Builds an Indoor Bike Data buffer: a 16-bit LE flags field followed by
// whichever fields the flags declare, in ascending bit order.
function frame(flags, bytes = []) {
  const view = new DataView(new ArrayBuffer(2 + bytes.length));
  view.setUint16(0, flags, true);
  bytes.forEach((b, i) => view.setUint8(2 + i, b));
  return view;
}

const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];
const u24 = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff];

describe('FTMS Indoor Bike Data parser', () => {
  test('bit 0 is INVERTED: clear means speed is present', () => {
    const r = parseIndoorBikeData(frame(0x0000, u16(2500)));
    assert.equal(r.instantaneousSpeedKmh, 25.0);
  });

  test('bit 0 set means speed is absent, and the field is not consumed', () => {
    // Cadence only. If bit 0 were read normally, cadence would be misread
    // from the speed field's bytes.
    const r = parseIndoorBikeData(frame(0x0005, u16(180)));
    assert.equal(r.instantaneousSpeedKmh, null);
    assert.equal(r.instantaneousCadenceRpm, 90.0);
  });

  test('applies each field resolution', () => {
    // 0x0045: bit 0 SET (speed absent) + cadence + power. Leaving bit 0
    // clear would make the parser read these bytes as speed — the exact
    // trap the inverted bit sets.
    const r = parseIndoorBikeData(frame(0x0045, [...u16(170), ...u16(245)]));
    assert.equal(r.instantaneousCadenceRpm, 85.0, 'cadence is 0.5 rpm/unit');
    assert.equal(r.instantaneousPowerW, 245, 'power is whole watts');

    const met = parseIndoorBikeData(frame(0x0401, [85]));
    assert.equal(met.metabolicEquivalent, 8.5, 'MET is 0.1/unit');
  });

  test('decodes the 24-bit little-endian distance field', () => {
    const r = parseIndoorBikeData(frame(0x0011, u24(12345)));
    assert.equal(r.totalDistanceM, 12345);
  });

  test('reads signed fields as signed', () => {
    const r = parseIndoorBikeData(frame(0x0061, [...u16(0xfffb), ...u16(0xfff4)]));
    assert.equal(r.resistanceLevel, -5);
    assert.equal(r.instantaneousPowerW, -12);
  });

  test('expended energy is three sub-fields gated by one bit', () => {
    const r = parseIndoorBikeData(frame(0x0101, [...u16(534), ...u16(612), 9]));
    assert.deepEqual(r.expendedEnergy, { totalKcal: 534, perHourKcal: 612, perMinuteKcal: 9 });
  });

  test('fields appear in ascending bit order, not declaration order', () => {
    // speed, avg speed, cadence, distance, power — interleaved widths.
    const r = parseIndoorBikeData(frame(0x0056, [
      ...u16(3200), ...u16(3100), ...u16(170), ...u24(12345), ...u16(245),
    ]));
    assert.equal(r.instantaneousSpeedKmh, 32.0);
    assert.equal(r.averageSpeedKmh, 31.0);
    assert.equal(r.instantaneousCadenceRpm, 85.0);
    assert.equal(r.totalDistanceM, 12345);
    assert.equal(r.instantaneousPowerW, 245);
  });

  test('single-byte fields at the far end of the flags', () => {
    const r = parseIndoorBikeData(frame(0x1e01, [142, 85, ...u16(125), ...u16(475)]));
    assert.equal(r.heartRateBpm, 142);
    assert.equal(r.metabolicEquivalent, 8.5);
    assert.equal(r.elapsedTimeSec, 125);
    assert.equal(r.remainingTimeSec, 475);
  });

  test('absent fields read as null, never zero', () => {
    // Zero is a legitimate power reading; null means "not reported". The
    // difference matters when averaging a ride.
    const r = parseIndoorBikeData(frame(0x0001));
    for (const key of ['instantaneousSpeedKmh', 'instantaneousPowerW', 'heartRateBpm']) {
      assert.equal(r[key], null, `${key} should be null`);
    }
  });

  test('a truncated buffer does not throw and stops cleanly', () => {
    // A malformed notification must never kill a ride in progress.
    const view = new DataView(new ArrayBuffer(3));
    view.setUint16(0, 0x0040, true); // claims power is present
    view.setUint8(2, 0xff); // ...but only one of its two bytes arrived
    let result;
    assert.doesNotThrow(() => { result = parseIndoorBikeData(view); });
    assert.equal(result.instantaneousPowerW, null);
  });

  test('a buffer too short to hold flags is handled', () => {
    assert.doesNotThrow(() => parseIndoorBikeData(new DataView(new ArrayBuffer(1))));
  });

  test('a real-world frame: speed, cadence and power together', () => {
    const r = parseIndoorBikeData(frame(0x0045, [...u16(180), ...u16(210)]));
    assert.equal(r.instantaneousCadenceRpm, 90);
    assert.equal(r.instantaneousPowerW, 210);
  });
});
