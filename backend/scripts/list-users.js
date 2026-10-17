// Lists accounts and how much each has ridden.
//
//   npm run list-users
import 'dotenv/config';
import db from '../src/db/index.js';

const rows = db.prepare(
  `SELECT u.username, u.display_name, u.is_admin, u.created_at,
          (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS rides,
          (SELECT COUNT(*) FROM auth_sessions a WHERE a.user_id = u.id AND a.expires_at > ?) AS logins
   FROM users u ORDER BY u.id`
).all(new Date().toISOString());

if (rows.length === 0) console.log('No accounts yet.');
else console.table(rows.map((r) => ({ ...r, is_admin: !!r.is_admin })));
