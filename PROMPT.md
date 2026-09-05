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

- **Trainer:** Elite Rivo, supports the standard Bluetooth **FTMS**
  (Fitness Machine Service) profile.
- **Drivetrain:** Zwift Cog — a *single* sprocket, so the bike has **no
  physical gears**. All gearing is virtual (implemented — see the phase
  list): the app holds a gear index and maps it to trainer resistance.
  Put the chain on whichever front ring gives the straightest line to the
  Cog and leave it there; the ring never changes effective gearing.
- **Shifting input:** a **Bluetooth keyboard** mounted on the bars — `+`
  (or `=`) shifts up, `-` shifts down. Chosen over the Zwift Click v2
  after fighting its daily hardware lock: a keyboard is plain HID with no
  proprietary locks, session expiries, or sleep timers.
- **Controller (optional):** Zwift Click v2 — still supported when
  unlocked (see the daily-lock note below), feeding the same gear model
  as the keyboard. Speaks a proprietary Zwift service rather than a
  standard GATT profile, and connects as a second, independent BLE device
  alongside the trainer.
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

**Zwift Click v2 — optional input (proprietary protocol, verified on
hardware)**

- Not FTMS. It speaks the Zwift *Ride* protocol, confirmed against
  OpenBikeControl, the makinolo teardown
  (makinolo.com/blog/2024/07/26/zwift-ride-protocol/), and the actual
  units:
  - Service is `0xFC82` on current firmware (legacy 128-bit UUID on older).
  - Buttons arrive as `0x23` frames: a 32-bit little-endian bitmap where a
    **cleared** bit = pressed. `+` = SHIFT_UP_R (bit 12), `-` = SHIFT_UP_L
    (bit 8). One unit reports the whole button grid, so a single connected
    unit gives both shifters.
  - Handshake is `RideOn` then a `0xFF 0x04 0x00` start command; the unit
    otherwise streams only telemetry. It also sends an unanswered public-key
    handshake (`0xFF 0x03 …`) but streams buttons in plaintext regardless —
    no crypto needed.
  - **It sleeps after ~1 min idle** and needs a physical button press to
    wake; nothing over BLE keeps it awake. The app handles this by
    auto-reconnecting when the wake-press brings it back, and by re-sending
    the start command if a fresh connection stays silent.
  - **Daily hardware lock (the big one).** Zwift locks the v2 so it only
    streams to third-party apps after being unlocked, and the unlock expires
    daily. Rather than implement Zwift's challenge-response crypto (what
    OpenBikeControl's unlock flow does — large and fragile), we use the same
    workaround as QZ: **pair the controllers with the official Zwift app for
    2+ minutes once a day to unlock them, then wake them (button press)
    before connecting here.** This is an operational step, surfaced as a hint
    on the home screen, not something the app performs.
- The app's connection layer works around all of this where software can:
  a continuous stream monitor re-sends the start command every 25 s and on
  silence, and reconnects persist until the rider's wake-press is caught.
  What software cannot fix is the daily lock itself — which is why the
  keyboard became the primary input.

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
  ended_at, distance_m, avg_power, max_power, avg_cadence, avg_speed.
  Averages are computed server-side over **moving** samples (cadence > 0)
  so setup/coasting time doesn't drag them down; max_power is over all
  samples. distance_m is the client's running total (device total-distance
  field when reported, else trapezoidal speed integration).
- `session_samples`: session_id, timestamp_offset_sec, power (**raw
  instantaneous**, 1 Hz — smoothing is display-only, never stored),
  cadence, speed, heart_rate (null until a strap exists), lap_marker
  (vestigial: lap marking was cut as a feature; the column stays at 0 to
  avoid a migration) — the time series behind the charts
- `records`: metric name, value, session_id (for "longest ride", "highest
  avg power", etc., recomputed or updated as sessions complete)
- `strava_tokens`: access_token, refresh_token, expires_at

## Features by phase

**Phase 1 — MVP (BUILT, verified against the trainer)**
- Connect to trainer over Bluetooth, parse Indoor Bike Data correctly ✓
- Live screen: power, cadence, speed, all visible at once, styled as a
  pixel-art bike-computer readout (dark mode, stone-grey/bronze palette) ✓
- Power displayed as **10-second smoothed** average (storage keeps raw) ✓
- Workout builder: ordered `duration + target watts` segments, manual
  targets (no FTP auto-scaling) ✓
- Run a workout: current segment, target watts, time remaining, workout
  progression; "PUSH COMPLETE" state at the end ✓
- Boulder-incline motif fills per segment, holds the summit on completion ✓
- Session (a Push) saved permanently to SQLite at the end of a ride ✓
- ~~Manual lap marking~~ — cut by decision; `lap_marker` column remains

**Virtual shifting (BUILT — pulled forward from phase 3)**
- GearModel: 12 gears mapped linearly over resistance 0–8 (tuned down
  from 2–18 after ride feel; the two numbers in `frontend/js/gears.js`
  are the tuning knobs), starting gear 5
- **Keyboard is the primary input**: `+`/`=` up, `-` down, live-view only,
  one shift per press, on-screen `▲/▼` confirmation of every press
- Zwift Click v2 optional, same shift path, subject to its daily lock
- Each shift writes `0x04` with control auto-re-request on failure

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

**Phase 3 — remaining trainer control**

Most of the original phase 3 (hardware probe, Control Point groundwork,
Click decoding, virtual shifting) was pulled forward and is built. What
remains:

- ERG mode: hold each segment's target watts automatically (`0x05`) —
  the TrainerControl module already implements the write; the feature
  needs a UI toggle and interplay rules with virtual shifting (ERG makes
  gears irrelevant while active)

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