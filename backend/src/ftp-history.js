import db from './db/index.js';

const insertEntry = db.prepare(
  `INSERT INTO ftp_history (user_id, ftp, previous_ftp, source, session_id)
   VALUES (@userId, @ftp, @previous, @source, @sessionId)`
);

// Records a change of FTP. Called wherever the profile's FTP changes (a
// Profile save, or accepting a test result), never for a no-op.
export function recordFtp({ userId, ftp, previous, source, sessionId = null }) {
  if (previous != null && Number(previous) === Number(ftp)) return;
  insertEntry.run({ userId, ftp, previous: previous ?? null, source, sessionId });
}
