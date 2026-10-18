import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, addUser, login } from './helpers.js';
import { computeBadges, BADGES } from '../backend/src/badges.js';

const tmp = useTempDb();

// A ride for the engine: local date and time are given in the rider's
// timezone (tzMin east of UTC), the way the app saves them.
let nextId = 1;
function ride({ date = '2026-03-02', time = '18:00', minutes = 30, km = 15, tzMin = 0, ...rest } = {}) {
  const startUtc = Date.parse(`${date}T${time}:00Z`) - tzMin * 60_000;
  return {
    id: nextId++,
    workout_id: null,
    started_at: new Date(startUtc).toISOString(),
    ended_at: new Date(startUtc + minutes * 60_000).toISOString(),
    distance_m: km * 1000,
    max_power: 300,
    avg_cadence: 85,
    ftp: 200,
    tz_offset_min: tzMin,
    ...rest,
  };
}

function badges(sessions, extra = {}) {
  const list = computeBadges({
    sessions,
    sampleStats: {},
    best20: {},
    workouts: [],
    ftpHistory: [],
    currentFtp: 200,
    ...extra,
  });
  return Object.fromEntries(list.map((b) => [b.id, b]));
}

const days = (n, start = '2026-03-02') =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10));

describe('badge engine', () => {
  test('every badge has an id, a group, a name and a description; ids are unique', () => {
    assert.equal(new Set(BADGES.map((b) => b.id)).size, BADGES.length);
    for (const b of BADGES) assert.ok(b.id && b.group && b.name && b.description, b.id);
    for (const b of BADGES.filter((x) => x.hidden)) assert.ok(b.hint, `${b.id} needs a hint`);
  });

  test('nothing earned without rides, with progress shown', () => {
    const b = badges([]);
    assert.equal(b['pushes-1'].earned, false);
    assert.deepEqual(b['pushes-10'].progress, { value: 0, target: 10, unit: 'rides' });
  });

  test('a count badge is earned on the ride that reached it', () => {
    const rides = days(10).map((d) => ride({ date: d }));
    const b = badges(rides);
    assert.equal(b['pushes-1'].session_id, rides[0].id);
    assert.equal(b['pushes-10'].session_id, rides[9].id);
    assert.equal(b['pushes-10'].earned_at, rides[9].started_at);
    assert.deepEqual(b['pushes-50'].progress, { value: 10, target: 50, unit: 'rides' });
  });

  test('cumulative distance crosses on the right ride', () => {
    const rides = [ride({ km: 60 }), ride({ date: '2026-03-03', km: 30 }), ride({ date: '2026-03-04', km: 20 })];
    const b = badges(rides);
    assert.equal(b['distance-100'].session_id, rides[2].id);
    assert.equal(b['distance-500'].progress.value, 110);
  });

  test('single-ride badges, with the best effort so far as progress', () => {
    const b = badges([ride({ minutes: 45, km: 28 })]);
    assert.equal(b['ride-1h'].earned, false);
    assert.deepEqual(b['ride-1h'].progress, { value: 45, target: 60, unit: 'min' });
    assert.equal(badges([ride({ minutes: 61 })])['ride-1h'].earned, true);
  });

  test('days in a row use local dates and break on a gap', () => {
    const three = days(3).map((d) => ride({ date: d }));
    assert.equal(badges(three)['streak-3'].session_id, three[2].id);
    const gap = [ride({ date: '2026-03-02' }), ride({ date: '2026-03-03' }), ride({ date: '2026-03-05' })];
    assert.equal(badges(gap)['streak-3'].earned, false);
    assert.equal(badges(gap)['streak-3'].progress.value, 2);
  });

  test('local time matters: 23:30 in Montréal is the next day in UTC', () => {
    // Montréal in March is UTC-4 (-240 min). Three evenings in a row locally;
    // read as UTC the last two would merge into one day.
    const rides = [
      ride({ date: '2026-03-02', time: '20:00', tzMin: -240 }),
      ride({ date: '2026-03-03', time: '19:00', tzMin: -240 }),
      ride({ date: '2026-03-04', time: '23:30', tzMin: -240 }),
    ];
    assert.equal(badges(rides)['streak-3'].earned, true);
  });

  test('four weeks in a row with three rides each', () => {
    const rides = [];
    for (let week = 0; week < 4; week++) {
      for (const d of [0, 2, 4]) rides.push(ride({ date: days(1, `2026-03-${String(2 + week * 7 + d).padStart(2, '0')}`)[0] }));
    }
    const b = badges(rides);
    assert.equal(b['weeks-4'].earned, true);
    assert.equal(b['weeks-4'].session_id, rides.at(-1).id);
    assert.equal(badges(rides.slice(0, -1))['weeks-4'].progress.value, 3);
  });

  test('power badges, including holding FTP for 20 minutes', () => {
    const r = ride({ minutes: 40, max_power: 760, ftp: 220 });
    const b = badges([r], { best20: { [r.id]: 225 } });
    assert.equal(b['peak-500'].earned, true);
    assert.equal(b['peak-750'].earned, true);
    assert.equal(b['peak-1000'].earned, false);
    assert.equal(b.threshold.earned, true);
    assert.equal(badges([r], { best20: { [r.id]: 210 } }).threshold.earned, false);
  });

  test('FTP badges come from the FTP history', () => {
    const history = [
      { ftp: 210, previous_ftp: 200, source: 'test', session_id: 7, created_at: '2026-03-01 18:00:00' },
      { ftp: 222, previous_ftp: 210, source: 'manual', session_id: null, created_at: '2026-04-01 18:00:00' },
    ];
    const b = badges([], { ftpHistory: history });
    assert.equal(b['ftp-tested'].session_id, 7);
    assert.equal(b['ftp-tested'].earned_at, '2026-03-01T18:00:00Z');
    assert.equal(b['ftp-5'].earned_at, '2026-03-01T18:00:00Z', '210 is 5% over the first 200');
    assert.equal(b['ftp-10'].earned_at, '2026-04-01T18:00:00Z', '222 is 11% over 200');
    assert.equal(b.humbled.earned, false);
  });

  test('workouts finished to the end, and the whole library', () => {
    const workouts = [
      { id: 1, library: true, test: false, totalSec: 1800 },
      { id: 2, library: true, test: false, totalSec: 3600 },
      { id: 3, library: true, test: true, totalSec: 3780 }, // the FTP test doesn't count
    ];
    const rides = [
      ride({ workout_id: 1, minutes: 30 }),
      ride({ date: '2026-03-03', workout_id: 2, minutes: 40 }), // abandoned
      ride({ date: '2026-03-04', workout_id: 2, minutes: 60 }),
    ];
    const b = badges(rides, { workouts });
    assert.equal(b['finish-1'].session_id, rides[0].id);
    assert.equal(b['library-all'].session_id, rides[2].id);
    assert.deepEqual(badges(rides.slice(0, 2), { workouts })['library-all'].progress, { value: 1, target: 2, unit: 'workouts' });
  });
});

describe('the funny ones and the secrets', () => {
  test('Coffee Break, π, Wrong Sport', () => {
    assert.equal(badges([ride({ minutes: 3 })])['coffee-break'].earned, true);
    assert.equal(badges([ride({ minutes: 0.5 })])['coffee-break'].earned, false, 'a 30-second accident does not count');
    assert.equal(badges([ride({ km: 3.141 })]).pi.earned, true);
    assert.equal(badges([ride({ km: 42.2 })])['wrong-sport'].earned, true);
  });

  test('cadence and coasting', () => {
    const r = ride({ minutes: 40, avg_cadence: 102 });
    assert.equal(badges([r])['spin-doctor'].earned, true);
    assert.equal(badges([ride({ minutes: 40, avg_cadence: 58 })]).grinder.earned, true);
    const coasty = ride({ minutes: 40 });
    // 30% of samples at zero cadence over 40 minutes = 12 minutes coasting.
    assert.equal(badges([coasty], { sampleStats: { [coasty.id]: { count: 100, zero: 30 } } }).freewheeler.earned, true);
  });

  test('dates and hours in the rider\'s local time', () => {
    // 21:00 on 24 December in Montréal is already the 25th in UTC: not Christmas.
    assert.equal(badges([ride({ date: '2026-12-24', time: '21:00', tzMin: -300 })]).christmas.earned, false);
    assert.equal(badges([ride({ date: '2026-12-25', time: '10:00', tzMin: -300 })]).christmas.earned, true);
    assert.equal(badges([ride({ date: '2027-01-01' })])['new-year'].earned, true);
    assert.equal(badges([ride({ date: '2028-02-29' })])['leap-day'].earned, true);
    assert.equal(badges([ride({ date: '2026-11-13' })])['friday-13'].earned, true, '13 Nov 2026 is a Friday');
    assert.equal(badges([ride({ time: '02:30' })])['night-owl'].earned, true);
    assert.equal(badges([ride({ time: '05:15' })])['early-bird'].earned, true);
  });

  test('Groundhog Day: the same workout five days running', () => {
    const rides = days(5).map((d) => ride({ date: d, workout_id: 9 }));
    assert.equal(badges(rides).groundhog.session_id, rides[4].id);
    const mixed = days(5).map((d, i) => ride({ date: d, workout_id: i === 2 ? 8 : 9 }));
    assert.equal(badges(mixed).groundhog.earned, false);
  });

  test('Overachiever, Humbled, and the Camus one', () => {
    assert.equal(badges([ride({ max_power: 620, ftp: 200 })]).overachiever.earned, true);
    const humbled = badges([], { ftpHistory: [{ ftp: 190, previous_ftp: 200, source: 'test', session_id: 3, created_at: '2026-03-01 10:00:00' }] });
    assert.equal(humbled.humbled.earned, true);
    const thirtyIn60 = days(60).filter((_, i) => i % 2 === 0).map((d) => ride({ date: d }));
    assert.equal(badges(thirtyIn60).camus.earned, true);
    assert.equal(badges(thirtyIn60.slice(0, 29)).camus.earned, false);
  });

  test('secrets stay "???" with a hint and no progress until earned', () => {
    const b = badges([ride({ km: 10 })]);
    assert.equal(b.pi.name, '???');
    assert.equal(b.pi.description, 'Irrational, but round enough.');
    assert.equal(b.pi.progress, null);
    assert.equal(badges([ride({ km: 3.14 })]).pi.name, 'π');
  });
});

describe('yearly champions', () => {
  const at = (iso) => Date.parse(iso);
  const champ = (yearTotals, now) => badges([], { yearTotals, now })['champion-2026'];

  test('the most minutes of everyone wins once the year is over, ties shared', () => {
    const after = at('2027-01-02T00:00:00Z');
    const won = champ({ 2026: { mine: 3000, best: 3000 } }, after);
    assert.equal(won.earned, true);
    assert.equal(won.earned_at, '2027-01-01T12:00:00.000Z');
    assert.equal(champ({ 2026: { mine: 2999, best: 3000 } }, after).earned, false);
    assert.equal(champ({}, after).earned, false, 'nobody rode: nobody wins');
  });

  test('during the year it shows where you stand against the leader', () => {
    const b = champ({ 2026: { mine: 600, best: 1500 } }, at('2026-10-18T12:00:00Z'));
    assert.equal(b.earned, false);
    assert.deepEqual([b.progress.value, b.progress.target], [600, 1500]);
    assert.equal(champ({ 2026: { mine: 1500, best: 1500 } }, at('2026-12-31T23:00:00Z')).earned, false, 'not before it ends');
  });

  test('a year that has not started shows no progress', () => {
    const b = badges([], { yearTotals: {}, now: at('2026-10-18T12:00:00Z') })['champion-2028'];
    assert.equal(b.earned, false);
    assert.equal(b.progress, null);
  });
});

describe('badges API', () => {
  let server;
  let alice;
  let bob;

  before(async () => {
    let base;
    ({ server, base } = await startServer());
    await addUser('alice', 'a');
    await addUser('bob', 'b');
    alice = await login(base, 'alice', 'a');
    bob = await login(base, 'bob', 'b');
  });

  after(() => {
    server?.close();
    tmp.cleanup();
  });

  test('earned on the saved ride, in the rider\'s own time zone, and only for them', async () => {
    const saved = await (await alice.post('/api/sessions', {
      // 02:30 local in Montréal (UTC-4) is 06:30 UTC.
      started_at: '2026-04-10T06:30:00.000Z',
      ended_at: '2026-04-10T06:33:00.000Z',
      tz_offset_min: -240,
      distance_m: 3141,
      samples: [{ timestamp_offset_sec: 0, power: 150, cadence: 80, speed: 25 }],
    })).json();
    assert.equal(saved.tz_offset_min, -240);

    const mine = await (await alice.get('/api/badges')).json();
    const byId = Object.fromEntries(mine.badges.map((b) => [b.id, b]));
    for (const id of ['pushes-1', 'coffee-break', 'night-owl', 'pi']) {
      assert.equal(byId[id].earned, true, id);
      assert.equal(byId[id].session_id, saved.id, id);
    }
    assert.equal(byId['early-bird'].earned, false, 'read as UTC it would have been 06:30');
    assert.equal(mine.earned, mine.badges.filter((b) => b.earned).length);

    const theirs = await (await bob.get('/api/badges')).json();
    assert.equal(theirs.earned, 0);
    assert.equal(theirs.badges.find((b) => b.id === 'pi').name, '???');
  });

  test('champion progress compares this year\'s minutes with the leader\'s', async () => {
    const year = new Date().getUTCFullYear();
    if (![2026, 2027, 2028].includes(year)) return;
    const start = `${year}-06-15T12:00:00.000Z`;
    await bob.post('/api/sessions', {
      started_at: start, ended_at: new Date(Date.parse(start) + 120 * 60_000).toISOString(), tz_offset_min: 0,
      samples: [{ timestamp_offset_sec: 0, power: 150, cadence: 80, speed: 25 }],
    });
    const find = async (who) => (await (await who.get('/api/badges')).json()).badges.find((b) => b.id === `champion-${year}`);
    const mine = await find(alice);
    assert.equal(mine.progress.target, 120, 'Bob leads');
    assert.ok(mine.progress.value < 120);
    const his = await find(bob);
    assert.deepEqual([his.progress.value, his.progress.target], [120, 120]);
  });

  test('an out-of-range time zone is ignored, not stored', async () => {
    const saved = await (await alice.post('/api/sessions', {
      started_at: '2026-04-11T10:00:00Z',
      ended_at: '2026-04-11T10:30:00Z',
      tz_offset_min: 5000,
      samples: [{ timestamp_offset_sec: 0, power: 150, cadence: 80, speed: 25 }],
    })).json();
    assert.equal(saved.tz_offset_min, null);
  });
});
