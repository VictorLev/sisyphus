// Throwaway sanity check for the FTMS parser — not a permanent test suite
// (Phase 2 owns real tests/CI). Run with: node scripts/verify-ftms-parser.mjs
import assert from 'node:assert/strict';
import { parseIndoorBikeData } from '../frontend/js/ble/ftms-parser.js';

function buf(bytes) {
  const u8 = new Uint8Array(bytes);
  return new DataView(u8.buffer);
}

let passed = 0;
let failed = 0;

function testCase(name, fn) {
  try {
    fn();
    console.log(`case ${name}: OK`);
    passed++;
  } catch (err) {
    console.error(`case ${name}: FAIL`);
    console.error(err);
    failed++;
  }
}

// 1. Baseline / inverted bit0 — flags=0x0000 (bit0=0 -> speed present, nothing else)
testCase('1 baseline inverted-bit0 speed-only', () => {
  const view = new DataView(new ArrayBuffer(4));
  view.setUint16(0, 0x0000, true);
  view.setUint16(2, 2500, true); // 25.00 km/h
  const r = parseIndoorBikeData(view);
  assert.strictEqual(r.instantaneousSpeedKmh, 25.0);
  assert.strictEqual(r.instantaneousPowerW, null);
  assert.strictEqual(r.instantaneousCadenceRpm, null);
});

// 2. Speed absent + cadence + power — flags=0x0045 (bit0=1, bit2, bit6)
testCase('2 speed-absent + cadence + power', () => {
  const view = new DataView(new ArrayBuffer(6));
  view.setUint16(0, 0x0045, true);
  view.setUint16(2, 180, true); // cadence raw -> 90.0 rpm
  view.setInt16(4, 250, true); // power 250 W
  const r = parseIndoorBikeData(view);
  assert.strictEqual(r.instantaneousSpeedKmh, null);
  assert.strictEqual(r.instantaneousCadenceRpm, 90.0);
  assert.strictEqual(r.instantaneousPowerW, 250);
});

// 3. Multi-field frame incl. 24-bit distance — flags=0x0056 (bit0=0,1,2,4,6)
testCase('3 multi-field frame with 24-bit distance', () => {
  const view = new DataView(new ArrayBuffer(2 + 2 + 2 + 2 + 3 + 2));
  view.setUint16(0, 0x0056, true);
  let o = 2;
  view.setUint16(o, 3200, true); o += 2; // speed 32.00 km/h
  view.setUint16(o, 3100, true); o += 2; // avg speed 31.00 km/h
  view.setUint16(o, 170, true); o += 2; // cadence -> 85.0 rpm
  view.setUint8(o, 0x39); view.setUint8(o + 1, 0x30); view.setUint8(o + 2, 0x00); o += 3; // distance 12345 m LE
  view.setInt16(o, 245, true); o += 2; // power 245 W
  const r = parseIndoorBikeData(view);
  assert.strictEqual(r.instantaneousSpeedKmh, 32.0);
  assert.strictEqual(r.averageSpeedKmh, 31.0);
  assert.strictEqual(r.instantaneousCadenceRpm, 85.0);
  assert.strictEqual(r.totalDistanceM, 12345);
  assert.strictEqual(r.instantaneousPowerW, 245);
});

// 4. Signed-field edge case — negative resistance and power
testCase('4 negative resistance and power via getInt16', () => {
  const view = new DataView(new ArrayBuffer(2 + 2 + 2));
  view.setUint16(0, 0x0061, true); // bit0=1 (speed absent), bit5 resistance, bit6 power
  view.setInt16(2, -5, true);
  view.setInt16(4, -12, true);
  const r = parseIndoorBikeData(view);
  assert.strictEqual(r.resistanceLevel, -5);
  assert.strictEqual(r.instantaneousPowerW, -12);
});

// 5. Single-byte + 0.1-resolution fields — HR, MET, elapsed, remaining
testCase('5 single-byte + 0.1-resolution fields', () => {
  const view = new DataView(new ArrayBuffer(2 + 1 + 1 + 2 + 2));
  view.setUint16(0, 0x1e01, true); // bit0=1 (absent), bit9,10,11,12
  let o = 2;
  view.setUint8(o, 142); o += 1; // HR
  view.setUint8(o, 85); o += 1; // MET raw -> 8.5
  view.setUint16(o, 125, true); o += 2; // elapsed
  view.setUint16(o, 475, true); o += 2; // remaining
  const r = parseIndoorBikeData(view);
  assert.strictEqual(r.instantaneousSpeedKmh, null);
  assert.strictEqual(r.heartRateBpm, 142);
  assert.strictEqual(r.metabolicEquivalent, 8.5);
  assert.strictEqual(r.elapsedTimeSec, 125);
  assert.strictEqual(r.remainingTimeSec, 475);
});

// 6. Expended energy 3-subfield block — flags bit0=0 (speed present) + bit8
testCase('6 expended energy 3-subfield block', () => {
  const view = new DataView(new ArrayBuffer(2 + 2 + 2 + 2 + 1));
  view.setUint16(0, 0x0100, true);
  let o = 2;
  view.setUint16(o, 1200, true); o += 2; // speed 12.00 km/h
  view.setUint16(o, 534, true); o += 2; // total kcal
  view.setUint16(o, 612, true); o += 2; // kcal/h
  view.setUint8(o, 9); o += 1; // kcal/min
  const r = parseIndoorBikeData(view);
  assert.deepStrictEqual(r.expendedEnergy, { totalKcal: 534, perHourKcal: 612, perMinuteKcal: 9 });
});

// 7. Truncated/malformed buffer — must not throw, must null out unreachable fields
testCase('7 truncated buffer is handled defensively', () => {
  const view = new DataView(new ArrayBuffer(3)); // flags claim power present, but buffer ends early
  view.setUint16(0, 0x0040, true); // bit6 power
  view.setUint8(2, 0xff);
  const r = parseIndoorBikeData(view);
  assert.strictEqual(r.instantaneousPowerW, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
