import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, fromCsv, toZwo, fromZwo, parseWorkoutFile, fileSlug } from '../frontend/js/workout/files.js';
import { validateStructure } from '../backend/src/workout-structure.js';

const sweetSpot = {
  name: 'Sweet Spot, "the classic"',
  structure: [
    { duration_sec: 600, target_ftp_pct: 55, label: 'Warmup' },
    { duration_sec: 1200, target_ftp_pct: 89.5, label: 'Sweet spot', grade_percent: 2 },
    { duration_sec: 300, target_ftp_pct: 50, label: 'Cooldown' },
  ],
};

describe('CSV', () => {
  test('round-trips a workout, including an awkward name and a grade', () => {
    const csv = toCsv(sweetSpot);
    assert.match(csv.split('\n')[0], /^workout,label,duration_sec,ftp_pct,grade_pct$/);
    const [back] = fromCsv(csv);
    assert.deepEqual(back, sweetSpot);
    assert.equal(validateStructure(back.structure), null, 'imports pass the server rules');
  });

  test('one file can hold several workouts (Export all)', () => {
    const other = { name: 'Recovery', structure: [{ duration_sec: 900, target_ftp_pct: 50, label: 'Easy' }] };
    const back = fromCsv(toCsv([sweetSpot, other]));
    assert.deepEqual(back.map((w) => w.name), [sweetSpot.name, 'Recovery']);
  });

  test('accepts what a spreadsheet produces: other column names, m:ss, %, semicolons', () => {
    const csv = '﻿Label;Duration;%FTP\nWarm up;5:00;55%\nBlock;1:02:30;90\n';
    const [w] = fromCsv(csv, { fallbackName: 'From Excel' });
    assert.equal(w.name, 'From Excel');
    assert.deepEqual(w.structure, [
      { duration_sec: 300, target_ftp_pct: 55, label: 'Warm up' },
      { duration_sec: 3750, target_ftp_pct: 90, label: 'Block' },
    ]);
  });

  test('a watts column is converted at the rider\'s FTP', () => {
    const [w] = fromCsv('label,duration_sec,watts\nHard,60,300\n', { ftp: 250 });
    assert.equal(w.structure[0].target_ftp_pct, 120);
  });

  test('says which line is wrong', () => {
    assert.throws(() => fromCsv('label,duration_sec,ftp_pct\nA,60,80\nB,abc,80\n'), /Line 3: duration/);
    assert.throws(() => fromCsv('label,duration_sec,ftp_pct\nA,60,900\n'), /Line 2: the target/);
    assert.throws(() => fromCsv('label,ftp_pct\nA,80\n'), /No duration column/);
    assert.throws(() => fromCsv('just a header\n'), /header row and at least one segment/);
  });
});

describe('Zwift .zwo', () => {
  test('round-trips (grades are dropped: Zwift workouts have no terrain)', () => {
    const zwo = toZwo(sweetSpot);
    assert.match(zwo, /<SteadyState Duration="1200" Power="0.895">/);
    assert.match(zwo, /<name>Sweet Spot, &quot;the classic&quot;<\/name>/);
    const [back] = fromZwo(zwo);
    assert.equal(back.name, sweetSpot.name);
    assert.deepEqual(back.structure, sweetSpot.structure.map(({ grade_percent, ...s }) => s));
  });

  test('reads a typical Zwift file: warm-up ramp, intervals, free ride, cool-down', () => {
    const zwo = `<?xml version="1.0"?>
<workout_file>
  <author>Coach</author>
  <name>4x4 VO2 &amp; more</name>
  <sportType>bike</sportType>
  <workout>
    <Warmup Duration="600" PowerLow="0.40" PowerHigh="0.75"/>
    <IntervalsT Repeat="4" OnDuration="240" OffDuration="180" OnPower="1.15" OffPower="0.5">
      <textevent timeoffset="0" message="Go!"/>
    </IntervalsT>
    <FreeRide Duration="300"/>
    <Cooldown Duration="300" PowerLow="0.6" PowerHigh="0.4"/>
  </workout>
</workout_file>`;
    const [w] = fromZwo(zwo);
    assert.equal(w.name, '4x4 VO2 & more');
    const total = w.structure.reduce((s, x) => s + x.duration_sec, 0);
    assert.equal(total, 600 + 4 * (240 + 180) + 300 + 300, 'no time lost or gained');
    const warm = w.structure.filter((s) => s.label === 'Warmup');
    assert.equal(warm.length, 10, 'the 10-minute ramp becomes 1-minute steps');
    assert.ok(warm[0].target_ftp_pct < warm.at(-1).target_ftp_pct, 'rising');
    assert.equal(w.structure.filter((s) => s.label === 'Go!').length, 4);
    assert.equal(w.structure.find((s) => s.label === 'Go!').target_ftp_pct, 115);
    assert.equal(validateStructure(w.structure), null);
  });

  test('rejects files that are not workouts', () => {
    assert.throws(() => fromZwo('<html></html>'), /Not a Zwift workout/);
    assert.throws(() => fromZwo('<workout_file><name>x</name><workout></workout></workout_file>'), /No steps/);
  });
});

describe('picking the format', () => {
  test('by extension or content; the file name names a nameless workout', () => {
    assert.equal(parseWorkoutFile('my_intervals.csv', 'label,duration_sec,ftp_pct\nA,60,80\n')[0].name, 'my intervals');
    assert.equal(parseWorkoutFile('x.txt', toZwo(sweetSpot))[0].name, sweetSpot.name);
    assert.equal(fileSlug('Sweet Spot, "the classic"'), 'sweet-spot-the-classic');
  });
});
