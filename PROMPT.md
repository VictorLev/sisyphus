# Sisyphus — Project Spec

A personal, self-hosted alternative to Zwift: connects to an Elite Rivo smart
trainer over Bluetooth, shows live ride data like a bike computer, runs
structured workouts, and keeps a permanent training log. No 3D routes, no
avatars — retro/arcade pixel-art data screen only.

**Tagline:** "Push the boulder. Every day."

## Theme: Sisyphus

The name is the whole idea, not decoration: indoor training is the boulder
that rolls back down every night, and you push it up again tomorrow. Theming
should touch the copy and one visual motif, but never get in the way of the
data — this is still a bike computer, not a storybook.

- **One visual motif:** a small pixel-art boulder that rolls/fills up an
  incline as you progress through the current workout segment. On the *ride*
  screen that remains the only "game" element — no characters, scenes, or
  other animation, so nothing competes with the data.
- **Chrome outside the ride screen:** a looping pixel-art Sisyphus pushes
  his boulder up a slope, sitting in the home header opposite the title and
  drawn in the same bronze — it escapes near the top, rolls back, and he
  begins again. Canvas-rendered like the ride boulder (no image assets).
  Absent from the live view, so the ride screen keeps its no-animation
  rule, and hidden on narrow screens.
- **Palette:** stone-grey and bronze/gold rather than neon arcade colors —
  reads "ancient" while staying pixel-art and dark mode.
- **Light naming touches**, kept legible over clever:
  - Session history → **The Chronicle**
  - Personal-best records → **Feats**
  - A completed ride → **a Push**
- Everything else — power, cadence, speed, workout builder, segment labels —
  stays plain and literal. Do not rename core data fields; the myth theme
  applies to framing and history, not to the numbers you're reading mid-ride.

## Hardware

- **Trainer:** Elite Rivo, supports the standard Bluetooth **FTMS**
  (Fitness Machine Service) profile.
- **Drivetrain:** Zwift Cog — a *single* sprocket, so the bike has **no
  physical gears**. All gearing is virtual (implemented — see the phase
  list): the app holds a gear index and maps it to trainer resistance.
  Put the chain on whichever front ring gives the straightest line to the
  Cog and leave it there; the ring never changes effective gearing.
- **Shifting input:** a **Bluetooth keyboard** mounted on the bars — `+`
  (or `=`) shifts up, `-` shifts down. A Zwift Click v2 was built and
  working first, but its firmware carries a daily hardware lock that only
  the official Zwift app can clear, so it was removed in favour of plain
  HID: no proprietary locks, session expiries, or sleep timers. (The Click
  implementation is in git history if it is ever wanted back.)
- **Sensors:** trainer reports its own speed/cadence — no separate ANT+/BLE
  speed or cadence sensor needed.
- **Heart rate:** not now, but design the data model so an HR strap
  (`heart_rate` BLE service) can be added later without a schema change.
- **Client:** Chrome on desktop only. Web Bluetooth requires a secure context
  (HTTPS, or `localhost`).

### Bluetooth detail Claude Code should know up front

**Trainer — FTMS (standardised, documented)**

- Service: `fitness_machine` (`0x1826`)
- Read/notify characteristic: **Indoor Bike Data** (`0x2AD2`) — speed,
  cadence, power, all gated behind a flags bitfield (fields are only present
  if their flag bit is set, and they appear in bit order). This parser is
  fiddly — get it right first, before building anything on top of it.
- Read characteristic: **Fitness Machine Feature** (`0x2ACC`) — **probed
  on the actual Rivo**: ERG (`0x05`), resistance (`0x04`) and simulation
  (`0x11`) are all SUPPORTED. Probed ranges: resistance 0–20.0 in 0.1
  steps (`0x2AD6`), power 0–4000 W in 1 W steps (`0x2AD8`). A dev probe
  page lives at `/probe.html` (linked from the home screen).
- Write characteristic: **Fitness Machine Control Point** (`0x2AD9`) —
  **implemented and confirmed against the Rivo** (every write acked
  `success`, resistance physically changes):
  - `0x00` Request Control — required first; the trainer acks each write
    via indication `[0x80, opcode, result]`. Control can lapse when idle,
    so the app re-requests it on a failed write.
  - `0x04` Set Target Resistance Level — parameter is a **UINT8 at 0.1
    resolution** (level 14.0 → raw `140`). This is what drives virtual
    shifting; resistance mode holds a fixed brake level, so power scales
    with pedal speed — gear-like, confirmed by feel.
  - `0x05` Set Target Power (ERG) — SINT16 LE watts. Module supports it;
    not yet used by any feature (phase 3 remainder).
  - `0x11` Set Indoor Bike Simulation Parameters — wind speed, **grade**
    (signed), rolling/wind resistance. Supported by the Rivo; unused so
    far (fallback option if resistance-mode gears ever feel wrong).

## Architecture

- **Frontend:** plain HTML/CSS/JS (no framework). Installable as a **PWA**
  (manifest + service worker) so it can be added to Chrome as an app. All
  Bluetooth calls live here, since Web Bluetooth is a browser-only API.
- **Backend:** small Node.js + Express server. Responsibilities:
  - Persist ride history, workouts, and best-effort records
  - Hold the Strava OAuth client secret and handle the token exchange/refresh
  - Serve the frontend files
- **Database:** SQLite (single file). Matches a one-user personal project,
  trivial to back up, and needs no separate DB server when this later moves
  to your home server.
- **Deployment target:** runs today on your desktop for development, later
  deployed as-is on your home server (same Node process + SQLite file);
  Bluetooth still happens client-side in the browser regardless of where the
  server lives.

## Data model (rough)

- `workouts`: id, name, created_at, starred (starred workouts are the ones
  pinned to the home screen), structure (JSON: ordered list of
  segments, each `{ duration_sec, target_watts, label, grade_percent? }`).
  `grade_percent` is optional and signed (-20..20): positive climbs,
  negative descends, absent reads as flat, so older workouts still load.
- `sessions`: id, workout_id (nullable — free rides have none, and cleared
  when a workout is deleted), workout_name (the workout's name as it was
  when ridden — denormalised on purpose so deleting a template never
  rewrites history), started_at,
  ended_at, distance_m, avg_power, max_power, avg_cadence, avg_speed.
  Averages are computed server-side over **moving** samples (cadence > 0)
  so setup/coasting time doesn't drag them down; max_power is over all
  samples. distance_m is the client's running total (device total-distance
  field when reported, else trapezoidal speed integration).
- `session_samples`: session_id, timestamp_offset_sec, power (the **mean
  of every BLE reading** in each recording window — smoothing is
  display-only, never stored; the session's true peak is tracked separately
  across raw readings and sent as max_power, since a window mean would
  flatten a sprint),
  cadence, speed, heart_rate (null until a strap exists), lap_marker
  (vestigial: lap marking was cut as a feature; the column stays at 0 to
  avoid a migration) — the time series behind the charts
- `records`: metric name, value, session_id (for "longest ride", "highest
  avg power", etc., recomputed or updated as sessions complete)
- `strava_tokens`: access_token, refresh_token, expires_at
- `app_config`: key/value, each value a JSON document. Two keys today —
  `profile` (name, ftp, weight_kg, max_hr) and `settings` (gear_count,
  min/max_resistance, start_gear, power_smoothing_sec,
  sample_interval_sec, default_mode). Key/value rather than typed columns
  so adding a setting never needs a migration; the server merges stored
  values over its defaults, so new settings appear with sane values.

## Features by phase

**Phase 1 — MVP (BUILT, verified against the trainer)**
- Connect to trainer over Bluetooth, parse Indoor Bike Data correctly ✓
- Live screen ✓ — a full-viewport dashboard: workout steps down the left
  with the current one lit, power/cadence/speed across the top centre,
  current power zone + level top right, the intensity timeline along the
  bottom, End Ride bottom-left and the gear bottom-right.
- Power displayed as **10-second smoothed** average (storage keeps raw) ✓
- Workout builder: ordered `duration + target watts` segments, manual
  targets (no FTP auto-scaling) ✓, with a live bar preview — width by
  duration, height by watts, coloured by power zone — plus Z1–Z6 quick-add
  buttons, zone gridlines, and running duration/load. Zone colours are a
  heat progression through the app's own palette (stone, slate, bronze,
  gold, ember, rust) rather than the neon bands other apps use: zone colour
  is functional, but it should not fight the interface. FTP still scales
  nothing automatically — it only labels and colours.
- Run a workout: current segment, target watts, time remaining, workout
  progression; "PUSH COMPLETE" state at the end ✓
- Boulder motif ✓ — during a ride Sisyphus occupies the centre of the
  dashboard and **works harder the higher the power zone**: the slope
  steepens, his stride quickens (190ms → 70ms per frame), and from Z4 up
  he drops from upright into a braced-low posture. Three cues at once, so
  the difference between Z2 and Z5 is legible from the bike.
- Session (a Push) saved permanently to SQLite at the end of a ride ✓
- ~~Manual lap marking~~ — cut by decision; `lap_marker` column remains

**Ride modes (BUILT — pulled forward from phase 3)**

Two modes, **chosen on the home screen before a ride starts** — never
switchable mid-ride, so a ride is one committed mode from start to finish.
They are mutually exclusive because both drive the same Control Point —
ERG blocks gear writes, which would otherwise fight the trainer's target.

- **Virtual Gears** — resistance is fixed per gear and the rider chases
  the target. **Terrain**: a segment's `grade_percent` composes into the
  same resistance write — the grade sets the load, the gear stays the
  rider's lever against it (`resistance = gear + grade x
  resistance_per_grade`, clamped to the device's 0..20, so a descent
  bottoms out at freewheel). FTMS simulation mode (`0x11`) was rejected
  for this: it takes no gear input, so it would have made gearing
  meaningless. The ride boulder's incline steepens on climbs and tips
  down on descents. GearModel: 12 gears mapped linearly over resistance 0–8
  (tuned down from 2–18 after ride feel; the two numbers in
  `frontend/js/gears.js` are the tuning knobs), starting gear 5. Keyboard
  `+`/`=` up, `-` down — live-view only, one shift per press, `▲/▼`
  confirmation on screen. Each shift writes `0x04`, re-requesting control
  if the trainer dropped it.
- **ERG** — the trainer forces each segment's target watts (`0x05`),
  written at ride start and again on every segment change. Gearing is
  irrelevant, so shifting is inert and says so. The gear tile reads "ERG".
- ERG needs a workout's targets, so **free rides always run in gears**;
  choosing ERG for a free ride is remembered for the next workout rather
  than discarded.
- Ending a ride sends Reset (`0x01`) so ERG stops forcing a target on the
  rider once they stop.

**Levelling (BUILT)**
- XP accrues from **time and distance ridden plus each completed Push** —
  deliberately not from training load, because load depends on FTP, so
  raising your FTP would shrink past rides and your level could go *down*.
  A progression system must never regress.
- Cumulative thresholds are `100 x (L-1) x L / 2`: level 2 lands after
  roughly an hour and a half of riding, level 10 after ~64 hours.
- Name and level sit in the nav bar; the Profile page shows the level, a
  progress bar and the totals behind it. Computed from the sessions table
  alone (no sample scanning) so the header can ask for it on every load.

**Profile and Settings pages (BUILT)**
- **Profile**: name, FTP, weight, max HR. FTP annotates live workout
  targets as `% FTP`; weight and max HR are stored for later use.
- **Settings**: everything previously hardcoded — gear count, min/max
  resistance, starting gear, power-smoothing window, sample interval, and
  default ride mode. Applied at startup and on save without a reload.
- Both persist to SQLite (`app_config`) rather than browser storage, so
  they live with the training log and survive a browser reset.

**Phase 2**
- FTP: manual entry is BUILT (Profile page; annotates targets as %FTP).
  A short guided estimator test is still outstanding.
- History view (**the Chronicle**) — BUILT: a month calendar where ridden
  days fill with bronze scaled by volume (with per-month Push/minute/km
  totals, and clicking a day filters the list), every Push newest-first
  with date/duration/distance/avg power, a weekly-minutes bar chart, and a
  per-ride power trace. When the ride followed a workout, the workout's
  target steps are overlaid on the trace so effort can be read against
  what was being chased. Pushes can be deleted (samples cascade), since a
  mis-recorded ride has to be removable from the log.
- Best-effort records (**Feats**) — BUILT: longest/furthest Push, highest
  avg power, peak power, and a power curve (best 5s / 1min / 5min / 20min
  sustained). Computed on demand from the log rather than cached, so
  deleting a ride can't leave a stale record standing. A window only counts
  if the ride actually covered it, so a 20-minute record can't be set by a
  5-minute ride — unearned records read "No ride long enough yet" instead
  of a misleading number. Each Feat links to the ride that set it.
- PWA installability (manifest, icons, service worker for offline shell)
- Basic test suite (unit tests on the FTMS parser and workout logic — the
  parser is the highest-risk piece of code, test it thoroughly) + GitHub
  Actions CI running tests on push

**Phase 3 — complete**

All of the original phase 3 (hardware probe, Control Point groundwork,
virtual shifting, ERG mode) was pulled forward and is built. Remaining
trainer-control ideas are optional polish rather than planned work:

- Simulation mode (`0x11`) as an alternative gear feel, if resistance-mode
  gears ever prove unsatisfying
- ERG target trimming (bump the held wattage ±N W mid-interval)

**Phase 4**
- Strava export: OAuth connect flow, upload completed sessions as
  activities

## Explicit non-goals

- No 3D graphics, avatars, or virtual routes. Using FTMS simulation mode
  (`0x11`) as the *mechanism* behind virtual shifting is fine — what's
  ruled out is route/course content, not the opcode.
- No calorie tracking
- No multi-device sync — single machine, local SQLite is the source of truth
- No failure states or penalties in workouts — additive/informational only
- No phone/tablet support — desktop Chrome only

## Style

- Dark mode, pixel-art aesthetic in stone-grey and bronze/gold
- Feels like a bike computer (data-forward), not a game with score/animation
- The rolling boulder is the only game element on screen — everything else
  is plain numbers and labels
- Silent — no sound or music