import { Router } from 'express';

// The phone remote: a rider's phone (remote.html) shifts the virtual gears
// of the ride running in their browser beside the bike, and shows its gear
// and numbers. The server is only a relay, per rider, over Server-Sent
// Events (a GET that stays open; browsers reconnect on their own):
//
//   ride page  --GET  /events?role=ride--->  receives  shift, remotes
//   phone      --GET  /events?role=remote->  receives  state
//   phone      --POST /shift {direction}-->  sent to that rider's ride pages
//   ride page  --POST /state {...}-------->  kept, and sent to their phones
//
// Nothing is stored: a restart forgets the last state until the ride page
// sends the next one.

const HEARTBEAT_MS = 25_000; // proxies drop a silent connection (Cloudflare after 100 s)
const STATE_FIELDS = ['riding', 'paused', 'mode', 'gear', 'gears', 'power', 'cadence', 'speed', 'workout'];

export function createRemoteRouter() {
  const router = Router();
  const riders = new Map(); // userId -> { rides: Set<res>, remotes: Set<res>, state }

  const rider = (userId) => {
    if (!riders.has(userId)) riders.set(userId, { rides: new Set(), remotes: new Set(), state: null });
    return riders.get(userId);
  };
  const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const tellRidesAboutRemotes = (r) => {
    for (const res of r.rides) send(res, 'remotes', { count: r.remotes.size });
  };

  router.get('/events', (req, res) => {
    const role = req.query.role === 'remote' ? 'remote' : 'ride';
    const r = rider(req.user.id);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // no proxy buffering
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    (role === 'ride' ? r.rides : r.remotes).add(res);
    if (role === 'remote') {
      send(res, 'state', r.state ?? { riding: false });
      tellRidesAboutRemotes(r);
    } else {
      send(res, 'remotes', { count: r.remotes.size });
    }
    const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    req.on('close', () => {
      clearInterval(beat);
      (role === 'ride' ? r.rides : r.remotes).delete(res);
      if (role === 'remote') tellRidesAboutRemotes(r);
    });
  });

  router.post('/shift', (req, res) => {
    const direction = req.body?.direction;
    if (direction !== 'up' && direction !== 'down') return res.status(400).json({ error: "direction must be 'up' or 'down'" });
    const r = rider(req.user.id);
    for (const ride of r.rides) send(ride, 'shift', { direction });
    res.json({ delivered: r.rides.size });
  });

  router.post('/state', (req, res) => {
    const body = req.body ?? {};
    const state = Object.fromEntries(STATE_FIELDS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
    const r = rider(req.user.id);
    r.state = state;
    for (const remote of r.remotes) send(remote, 'state', state);
    res.json({ remotes: r.remotes.size });
  });

  return router;
}
