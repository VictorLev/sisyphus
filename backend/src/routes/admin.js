import { Router } from 'express';
import { readFileSync } from 'node:fs';
import db from '../db/index.js';
import { requireAdmin } from '../auth/middleware.js';
import { generatePassword } from '../auth/password.js';
import { createUser, deleteUser, findUserById, setPassword, countUserData, publicUser } from '../auth/users.js';
import { endAllSessions } from '../auth/login-sessions.js';
import { getScenery, setScenery, sceneryEntries, MAX_SCENERY } from '../scenery.js';
import { giveDrachmas } from './shop.js';
import { GIFT_MAX } from '../shop-catalog.js';
import { inboxDir, listInbox, scanInbox } from '../route-inbox.js';

// /api/admin: the Admin Panel, admins only. Riders (list, create, delete,
// reset a password), the shared scenery, the route inbox, and the release
// history.
// Passwords handed out here are random and shown once, like the CLI's.

const releases = JSON.parse(readFileSync(new URL('../releases.json', import.meta.url), 'utf8'));

const selectRiders = db.prepare(
  `SELECT u.id, u.username, u.display_name, u.is_admin, u.created_at,
          COUNT(s.id) AS rides, MAX(s.started_at) AS last_ride
   FROM users u LEFT JOIN sessions s ON s.user_id = u.id
   GROUP BY u.id ORDER BY u.display_name COLLATE NOCASE`
);

const router = Router();
router.use(requireAdmin);

router.get('/users', (req, res) => {
  res.json(selectRiders.all().map((u) => ({ ...u, is_admin: Boolean(u.is_admin), you: u.id === req.user.id })));
});

router.post('/users', async (req, res) => {
  const { username, display_name: displayName, is_admin: isAdmin } = req.body ?? {};
  const password = generatePassword();
  try {
    const user = await createUser({ username, password, displayName, isAdmin: Boolean(isAdmin) });
    res.status(201).json({ user: publicUser(user), password });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/users/:id/reset-password', async (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'no such rider' });
  // Your own: Settings -> Account (this would log you out of the panel).
  if (user.id === req.user.id) return res.status(400).json({ error: 'change your own password in Settings → Account' });
  const password = generatePassword();
  await setPassword(user.id, password);
  endAllSessions(user.id); // the old password's sessions end everywhere
  res.json({ user: publicUser(user), password });
});

// What deleting would remove, for the confirmation.
router.get('/users/:id/data', (req, res) => {
  if (!findUserById(req.params.id)) return res.status(404).json({ error: 'no such rider' });
  res.json(countUserData(Number(req.params.id)));
});

router.delete('/users/:id', (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'no such rider' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'you can\'t delete your own account here' });
  try {
    res.json({ removed: deleteUser(user.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Give a rider drachmas (a whole number, 1 to GIFT_MAX).
router.post('/users/:id/drachmas', (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'no such rider' });
  const amount = Number(req.body?.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > GIFT_MAX) {
    return res.status(400).json({ error: `amount must be a whole number from 1 to ${GIFT_MAX}` });
  }
  const note = req.body?.note ? String(req.body.note).slice(0, 200) : null;
  const { balance } = giveDrachmas(user.id, amount, { note, givenBy: req.user.id });
  res.json({ user: publicUser(user), amount, balance });
});

router.get('/scenery', (req, res) => res.json({ videos: getScenery(), max: MAX_SCENERY }));

router.put('/scenery', (req, res) => {
  const text = String(req.body?.videos ?? '');
  const entries = sceneryEntries(text);
  if (entries.length > MAX_SCENERY) return res.status(400).json({ error: `at most ${MAX_SCENERY} videos` });
  setScenery(entries.join(', '));
  res.json({ videos: getScenery(), max: MAX_SCENERY });
});

// The route inbox: what's waiting, then a scan that imports it.
const inboxView = () => ({
  dir: inboxDir(),
  folders: listInbox().map(({ folder, size, reason }) => ({ folder, size, reason })),
});

router.get('/inbox', (req, res) => res.json(inboxView()));

router.post('/inbox/scan', async (req, res) => {
  const result = await scanInbox({ createdBy: req.user.id });
  res.json({ ...result, ...inboxView() });
});

router.get('/releases', (req, res) => {
  res.json({ running: process.env.GIT_SHA?.slice(0, 7) || null, releases });
});

export default router;
