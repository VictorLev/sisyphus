// "My First Ride": every new account gets it in My Workouts, starred, so the
// Ride page has something to press on day one. Twenty easy minutes in % of
// FTP, with two short lifts to feel the trainer respond. It's the rider's
// own copy: they can edit, unstar or delete it.
//
// Labels are ones the app translates, so the segments read in French too.

export const FIRST_RIDE = {
  name: 'My First Ride',
  structure: [
    { duration_sec: 300, target_ftp_pct: 50, label: 'Warmup' },
    { duration_sec: 300, target_ftp_pct: 60, label: 'Easy spin' },
    { duration_sec: 120, target_ftp_pct: 70, label: 'Build' },
    { duration_sec: 120, target_ftp_pct: 55, label: 'Easy' },
    { duration_sec: 120, target_ftp_pct: 75, label: 'Build' },
    { duration_sec: 240, target_ftp_pct: 45, label: 'Cooldown' },
  ],
};
