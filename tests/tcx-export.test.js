// Rides as .tcx downloads, for uploading to Strava by hand.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, addUser, login } from './helpers.js';

const tmp = useTempDb();
const { buildTcx } = await import('../backend/src/tcx.js');

const samples = [0, 20, 40].map((t) => ({ timestamp_offset_sec: t, power: 200 + t, cadence: 90, speed: 30, heart_rate: t ? 140 : null }));

describe('TCX', () => {
  test('a ride becomes trackpoints with power, cadence, speed, heart rate and distance', () => {
    const tcx = buildTcx(
      { started_at: '2026-10-18T22:00:00.000Z', ended_at: '2026-10-18T22:01:00.000Z', distance_m: 500, avg_power: 220 },
      samples
    );
    assert.equal((tcx.match(/<Trackpoint>/g) ?? []).length, 3);
    assert.match(tcx, /<Activity Sport="Biking">/);
    assert.match(tcx, /<Time>2026-10-18T22:00:20.000Z<\/Time>/);
    assert.match(tcx, /<ns3:Watts>240<\/ns3:Watts>/);
    assert.match(tcx, /<Cadence>90<\/Cadence>/);
    assert.match(tcx, /<ns3:Speed>8.33<\/ns3:Speed>/, '30 km/h in m/s');
    assert.match(tcx, /<HeartRateBpm><Value>140<\/Value><\/HeartRateBpm>/);
    assert.equal((tcx.match(/<HeartRateBpm>/g) ?? []).length, 2, 'no heart rate where there was none');
    assert.match(tcx, /<DistanceMeters>500<\/DistanceMeters><HeartRateBpm>/, 'the last point reaches the ride\'s distance');
    assert.match(tcx, /<TotalTimeSeconds>60<\/TotalTimeSeconds>/);
  });
});

describe('download API and setting', () => {
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

  test('your ride downloads as a .tcx named by its local date', async () => {
    const saved = await (await alice.post('/api/sessions', {
      // 22:30 on the 18th in Montréal is 02:30 UTC on the 19th.
      started_at: '2026-10-19T02:30:00.000Z',
      ended_at: '2026-10-19T02:31:00.000Z',
      tz_offset_min: -240,
      distance_m: 500,
      samples,
    })).json();
    const res = await alice.get(`/api/sessions/${saved.id}/tcx`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /tcx\+xml/);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="sisyphus-2026-10-18-free-ride\.tcx"/);
    const body = await res.text();
    assert.match(body, /<TrainingCenterDatabase/);
    assert.equal((body.match(/<Trackpoint>/g) ?? []).length, 3);

    assert.equal((await bob.get(`/api/sessions/${saved.id}/tcx`)).status, 404, 'not someone else\'s');
  });

  test('the Strava box is off until the rider turns it on', async () => {
    assert.equal((await (await alice.get('/api/settings')).json()).strava_export, false);
    assert.equal((await (await alice.put('/api/settings', { strava_export: true })).json()).strava_export, true);
    assert.equal((await alice.put('/api/settings', { strava_export: 'yes' })).status, 400);
  });
});
