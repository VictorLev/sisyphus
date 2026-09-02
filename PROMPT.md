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
  incline as you progress through the current workout segment. That's the
  only "game" element on screen — no other characters, scenes, or animation.
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

- **Trainer:** Elite Rivo (with Zwift Cog + Click), supports the standard
  Bluetooth **FTMS** (Fitness Machine Service) profile.
- **Sensors:** trainer reports its own speed/cadence — no separate ANT+/BLE
  speed or cadence sensor needed.
- **Heart rate:** not now, but design the data model so an HR strap
  (`heart_rate` BLE service) can be added later without a schema change.
- **Client:** Chrome on desktop only. Web Bluetooth requires a secure context
  (HTTPS, or `localhost`).

### Bluetooth detail Claude Code should know up front

- Service: `fitness_machine` (`0x1826`)
- Read/notify characteristic: **Indoor Bike Data** (`0x2AD2`) — speed,
  cadence, power, all gated behind a flags bitfield (fields are only present
  if their flag bit is set, and they appear in bit order). This parser is
  fiddly — get it right first, before building anything on top of it.
- Write characteristic: **Fitness Machine Control Point** (`0x2AD9`) — used
  for ERG mode (opcode `0x05`, "Set Target Power"). Requires requesting
  control (opcode `0x00`) first and handling the trainer's ack. **Treat ERG
  auto-resistance as a phase 2 feature, not part of the MVP** — ship
  visual-target workouts first (rider manually matches power by feel/gearing),
  add auto-resistance once the basic app works end to end.

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

- `workouts`: id, name, created_at, structure (JSON: ordered list of
  segments, each `{ duration_sec, target_watts, label }`)
- `sessions`: id, workout_id (nullable — free rides have none), started_at,
  ended_at, distance_m, avg_power, max_power, avg_cadence, avg_speed
- `session_samples`: session_id, timestamp_offset_sec, power, cadence,
  speed, lap_marker (bool) — the time series behind the charts
- `records`: metric name, value, session_id (for "longest ride", "highest
  avg power", etc., recomputed or updated as sessions complete)
- `strava_tokens`: access_token, refresh_token, expires_at

## Features by phase

**Phase 1 — MVP**
- Connect to trainer over Bluetooth, parse Indoor Bike Data correctly
- Live screen: power, cadence, speed, all visible at once, styled as a
  pixel-art bike-computer readout (dark mode, stone-grey/bronze palette)
- Power displayed as **10-second smoothed** average (not instantaneous)
- Workout builder: create a workout as an ordered list of
  `duration + target watts` segments; you choose the targets manually (no
  FTP auto-scaling in phase 1)
- Run a workout: screen shows current segment, target watts, time
  remaining in segment, and progression through the workout — no
  auto-resistance yet, just a clear visual target
- Manual lap/interval marking (a button that timestamps a split)
- Boulder-incline motif fills as you progress through the current segment
- Session (a Push) saved permanently to SQLite at the end of a ride

**Phase 2**
- FTP estimator (short guided test or manual entry) — used only to help
  you pick sensible workout targets, not to auto-scale anything
- History view (**the Chronicle**): table of past sessions + simple charts
  (power over time per ride, weekly totals)
- Best-effort records (**Feats**) surfaced back to you (longest ride,
  highest avg power, etc.)
- PWA installability (manifest, icons, service worker for offline shell)
- Basic test suite (unit tests on the FTMS parser and workout logic — the
  parser is the highest-risk piece of code, test it thoroughly) + GitHub
  Actions CI running tests on push

**Phase 3**
- ERG mode: write to the Control Point characteristic so the trainer
  auto-adjusts resistance to hit each segment's target watts
- Strava export: OAuth connect flow, upload completed sessions as
  activities

## Explicit non-goals

- No 3D graphics, avatars, or virtual routes
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