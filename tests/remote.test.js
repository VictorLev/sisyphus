// The phone remote relay: shifts reach the rider's own ride page, state
// reaches their own phone, and nobody else's.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, addUser, login } from './helpers.js';

const tmp = useTempDb();

// Opens an SSE stream and collects its events until closed.
function listen(base, cookie, role) {
  const controller = new AbortController();
  const events = [];
  const ready = (async () => {
    const res = await fetch(`${base}/api/remote/events?role=${role}`, { headers: { Cookie: cookie }, signal: controller.signal });
    assert.match(res.headers.get('content-type'), /^text\/event-stream/);
    return res.body;
  })();
  const done = ready.then(async (body) => {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of body) {
        buffer += decoder.decode(chunk, { stream: true });
        let i;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const event = block.match(/^event: (.*)$/m)?.[1];
          const data = block.match(/^data: (.*)$/m)?.[1];
          if (event) events.push({ event, data: JSON.parse(data) });
        }
      }
    } catch { /* aborted */ }
  });
  return { events, ready, close: () => { controller.abort(); return done; } };
}
const settle = () => new Promise((r) => setTimeout(r, 100));

describe('phone remote', () => {
  let server;
  let base;
  let alice;
  let bob;

  before(async () => {
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

  test('a shift from your phone reaches your ride page, not anyone else\'s', async () => {
    const mine = listen(base, alice.cookie, 'ride');
    const theirs = listen(base, bob.cookie, 'ride');
    await mine.ready; await theirs.ready; await settle();
    const res = await (await alice.post('/api/remote/shift', { direction: 'up' })).json();
    assert.equal(res.delivered, 1);
    await alice.post('/api/remote/shift', { direction: 'down' });
    await settle();
    assert.deepEqual(mine.events.filter((e) => e.event === 'shift').map((e) => e.data.direction), ['up', 'down']);
    assert.equal(theirs.events.filter((e) => e.event === 'shift').length, 0);
    await mine.close(); await theirs.close();
  });

  test('your phone gets the ride\'s state, the last one first; the ride page hears a phone arrive', async () => {
    const ride = listen(base, alice.cookie, 'ride');
    await ride.ready; await settle();
    await alice.post('/api/remote/state', { riding: true, mode: 'gears', gear: 6, gears: 12, power: 210, secret: 'dropped' });
    const phone = listen(base, alice.cookie, 'remote');
    await phone.ready; await settle();
    assert.deepEqual(phone.events[0], { event: 'state', data: { riding: true, mode: 'gears', gear: 6, gears: 12, power: 210 } });
    assert.ok(ride.events.some((e) => e.event === 'remotes' && e.data.count === 1));
    await alice.post('/api/remote/state', { riding: true, mode: 'gears', gear: 7, gears: 12 });
    await settle();
    assert.equal(phone.events.at(-1).data.gear, 7);

    const bobsPhone = listen(base, bob.cookie, 'remote');
    await bobsPhone.ready; await settle();
    assert.deepEqual(bobsPhone.events[0].data, { riding: false }, 'Bob sees no ride of Alice\'s');
    await phone.close(); await ride.close(); await bobsPhone.close();
  });

  test('only up or down, and only when logged in', async () => {
    assert.equal((await alice.post('/api/remote/shift', { direction: 'sideways' })).status, 400);
    assert.equal((await fetch(`${base}/api/remote/shift`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${base}/api/remote/events?role=ride`)).status, 401);
  });

  test('/remote serves the phone page', async () => {
    const res = await fetch(`${base}/remote`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /remote\.js/);
  });
});
