# Sisyphus

**Push the boulder. Every day.**

A self-hosted indoor cycling app for a smart trainer. It connects to the trainer
over Bluetooth from the browser, shows a live bike-computer dashboard, runs
structured workouts, controls trainer resistance, and keeps a permanent training
log in a single SQLite file on your own machine.

No cloud service, no subscription, no 3D world to ride through — just the
numbers, a workout to follow, and a record of every session. One server can
host a handful of riders: each logs in and gets their own log, settings,
Feats and level. Accounts are created by whoever runs the server.

The name is the point: indoor training is the boulder that rolls back down every
night, and you push it up again tomorrow.

## What it does

- **Live ride dashboard** — power (10-second smoothed), cadence and speed; the
  current workout step plus the next four; your live power zone; and a pixel-art
  Sisyphus who visibly works harder the deeper into your zones you ride.
- **Two ride modes**
  - **Virtual Gears** — the trainer holds a fixed resistance per gear and you
    chase the target yourself. Shift with `+` and `−` on any keyboard.
  - **ERG** — the trainer forces each segment's target watts on you regardless
    of cadence.
- **Terrain** — workout segments can carry a gradient. Climbs add resistance on
  top of your gear, descents subtract it down to a freewheel.
- **Workout library** — about a dozen built-in workouts (recovery to VO2max,
  a ramp test, some short ones) written in % of FTP, so they fit every rider.
  Ride them as they are, or copy one to edit.
- **FTP test** — a 20-minute test started from Profile. It runs in virtual
  gears so you set the pace; afterwards the app works out your FTP (95% of your best 20
  minutes) and asks before changing it. Profile keeps your FTP history.
- **Workout builder** — stack segments of duration + target watts (+ optional
  gradient), with a live bar preview coloured by power zone and Z1–Z6 quick-add.
- **The Chronicle** — a month calendar of everything you've ridden, weekly
  totals, and a power-over-time trace per ride with the workout's targets
  overlaid.
- **Feats** — longest and furthest ride, best average and peak power, and a
  power curve (best 5s / 1min / 5min / 20min sustained).
- **Levelling** — XP from time and distance ridden, so it can never go backwards.
- **Badges** — 47 of them on the Feats page: ride counts, distance and time,
  big rides, streaks, power, FTP gains, finished workouts, some funny ones
  (Coffee Break, Spin Doctor, Night Owl…) and secrets that stay "???" until
  someone finds them. Computed from the log, so they can't go stale; the
  summary after a ride shows any new ones.
- **Installable** as a desktop app (PWA) with an offline shell.

## What you need

**A smart trainer speaking Bluetooth FTMS.** This is the standard fitness
machine profile, so most modern smart trainers work — the app asks for the
generic `fitness_machine` service rather than any specific model. It was built
and tested against an **Elite Rivo**.

Reading power/cadence/speed works on any FTMS trainer. The extras depend on what
your trainer supports:

| Feature | Needs |
| --- | --- |
| Live data, workouts, logging | FTMS Indoor Bike Data (`0x2AD2`) |
| Virtual gears + terrain | Set Target Resistance (`0x04`) |
| ERG mode | Set Target Power (`0x05`) |

If the trainer misbehaves, **Settings → Log** lists Bluetooth events, warnings and
errors from your browser, with a Copy button for bug reports. The app also ships
a diagnostics page (**Settings → Hardware diagnostics**) that reads
your trainer's feature bits and tells you which of these it accepts. Run it first
if you're unsure.

**Desktop Chrome** (or another Chromium browser). The whole thing hinges on
[Web Bluetooth](https://developer.mozilla.org/docs/Web/API/Web_Bluetooth_API),
which Safari and Firefox do not implement. No phone or tablet support.

**Node.js 20 or newer.**

**Optional: a single-sprocket setup** such as a Zwift Cog. Virtual shifting was
built for exactly that case — with one physical gear, the app's gears become
your only gears. A normal cassette works fine too; you just have real gears as
well.

**Optional: a keyboard on the handlebars.** Any cheap Bluetooth keyboard works
for shifting. (A Zwift Click was supported at one point and removed — its
firmware carries a daily hardware lock only the official Zwift app can clear.)

## Setup

```sh
git clone <this repo>
cd sisyphus
npm install --prefix backend
npm run add-user -- me --admin --password me   # once; locally any password works
npm run dev
```

Then open **http://localhost:7479** in Chrome and log in.

Web Bluetooth requires a secure context, and `localhost` counts as one — so no
HTTPS setup is needed to run it on the machine beside your bike. If you serve it
from elsewhere on your network, you will need HTTPS — see
[Running it on a home server](#running-it-on-a-home-server), or
[deploy/README.md](deploy/README.md) for the Docker setup with automatic
updates.

There is nothing else to configure. The SQLite file is created on first run
at `backend/data/sisyphus.db`. To change the port or database location, copy
`backend/.env.example` to `backend/.env`. More riders: `npm run add-user --
<name>`; forgotten password: `npm run reset-password -- <name>`. Both take
`--password <pw>`; outside production (the Docker image sets
`NODE_ENV=production`, which requires 8+ characters) any non-empty password
is accepted.

## First ride

1. **Profile** → set your **FTP** and weight. FTP drives the power zones, the
   `% FTP` labels on targets, the training-load figures, and the targets of
   library workouts (converted to watts when the ride starts). Workouts you
   build yourself stay exactly the watts you typed.
2. **Settings** → adjust the gear range if needed. The defaults are 12 gears
   across trainer resistance 0–8; raise the max if the top gears feel too easy.
3. **Workouts** → star a library workout, or **Build** your own.
4. Press **Connect trainer** beside the title, then on **Ride** pick **Virtual Gears** or **ERG**, and start a
   workout or a free ride.
5. Shift with **`+`** (or `=`) and **`−`** during the ride. Press **End Ride** to
   save the session — it then appears in the Chronicle and updates your Feats.

## How it works

```
frontend/   plain HTML/CSS/JS — no framework, no bundler, no build step
  js/ble/     Web Bluetooth: FTMS parsing and trainer control
  js/ui/      views, charts, pixel-art canvases
  js/...      gear model, power zones, workout runner, metrics, recording
backend/    Node.js + Express — serves the frontend, persists to SQLite
tests/      Node's built-in test runner
```

All Bluetooth happens **client-side**, because Web Bluetooth is a browser-only
API. The backend never talks to the trainer; it stores workouts, sessions and
settings, and serves the static files. That separation is why the server can
live on a home server while the browser beside the bike owns the Bluetooth
connection.

The frontend has **no dependencies and no build step**: it is ES modules loaded
directly by the browser. The backend has three (`express`, `better-sqlite3`,
`dotenv`).

## Running it on a home server

The browser does the Bluetooth, so it must run on the machine beside the bike.
The server only serves files and stores data — which makes it a good fit for a
home server: your training log lives somewhere backed up, while the laptop at
the bike is just a screen.

**One catch decides the whole setup: Web Bluetooth requires a secure context.**
`localhost` is exempt, which is why development works over plain HTTP. A LAN
address is not. Browse to `http://192.168.1.x:7479` and the app loads, the
Chronicle works — and *Connect Trainer* silently does nothing, because the
browser will not expose Bluetooth at all. So a home-server install needs HTTPS.

The server can terminate TLS itself; no nginx or Caddy required:

```sh
TLS_CERT=/path/to/cert.pem TLS_KEY=/path/to/key.pem npm start
```

It warns on startup if you are serving plain HTTP on a non-local address, so
this fails loudly rather than at the bike.

### Getting a certificate

| Approach | Good when |
| --- | --- |
| **[Tailscale](https://tailscale.com/kb/1153/enabling-https)** — `tailscale cert <host>.<tailnet>.ts.net` | Easiest. Real trusted certs, no domain, no port forwarding, works away from home too. |
| **[mkcert](https://github.com/FiloSottile/mkcert)** — a local CA trusted on your own machines | Fully offline, no accounts. You must install the CA on the bike machine. |
| **Let's Encrypt** via Caddy or certbot with a DNS-01 challenge | You already own a domain. Works for a LAN-only host since DNS-01 needs no inbound ports. |
| Chrome's `--unsafely-treat-insecure-origin-as-secure=http://192.168.1.x:7479` flag | A quick trial. Per-machine and easy to forget — not a real setup. |

A self-signed certificate you simply click through is the one option to avoid:
Chrome treats it as a broken secure context, and Web Bluetooth stays disabled.

### Running as a service

`deploy/sisyphus.service` is a systemd unit:

```sh
sudo cp deploy/sisyphus.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sisyphus
journalctl -u sisyphus -f
```

Edit `User`, `WorkingDirectory` and `ExecStart` first — the Node path varies
(`which node`), especially under nvm.

The unit puts the database at `/var/lib/sisyphus/sisyphus.db`, outside the repo,
so a `git pull` can never touch your training log. Back it up by copying that
one file; it is the entire history.

### Reaching it from outside your home

Every API route needs a login, so the server can be exposed — but only over
HTTPS. The Docker setup in [deploy/README.md](deploy/README.md) does this
with a Cloudflare Tunnel: real certificate, no port forwarding.

## Development

```sh
npm run dev     # start with auto-reload
npm start       # start normally
npm test        # run the test suite
```

### Branches and releases

Branch names say what kind of change they carry, and so which part of the
version the next release bumps. CI rejects a pull request from a branch
that doesn't follow this.

| Branch | Bumps | Example |
| --- | --- | --- |
| `feat/<name>` | minor: v1.0.0 → v1.1.0 | `feat/leaderboard` |
| `fix/<name>` | patch: v1.1.0 → v1.1.1 | `fix/virtual-gears` |
| `breaking/<name>` | major: v1.1.1 → v2.0.0 | a change the previous version can't run alongside, e.g. a migration that drops or renames columns, so rollback stops working |
| `chore/`, `docs/`, `ci/` | nothing on its own; ships with the next release | `ci/node-24-actions` |

`<name>` is short lowercase kebab-case. Version numbers are never in branch
names; they are decided at release time and live only in tags. To pick the
next tag, look at what merged since the last one (`git log --merges
<last-tag>..origin/main`): any `breaking/` means a major bump, otherwise any
`feat/` means minor, otherwise it's a patch. Merging to `main` publishes the
change but doesn't deploy it; pushing the tag releases it (see
[deploy/README.md](deploy/README.md#shipping-a-change)).

### Generating test rides

Filling the Chronicle by actually riding is slow, so there is a generator:

```sh
export SISYPHUS_USER=me SISYPHUS_PASSWORD=...   # the account to save it as
npm run fake-ride                        # the first workout in your list
npm run fake-ride -- "Aerobic 15's #1"   # by name (partial matches work)
npm run fake-ride -- "Sweet Spot" 3      # ...ridden 3 days ago
```

It simulates a rider following the workout — power approaches each target
with a lag, sprints are attacked then sag, cadence and speed derive from
power — and saves through the real API, so aggregates and records are
computed exactly as they would be for a genuine ride. The session is normal
data; delete it from the Chronicle when you are done with it.

### Tests

Tests use Node's built-in runner — no test framework to install. Coverage is
weighted toward the risky parts: the FTMS binary parser gets the most (its flags
field has an inverted bit that is very easy to get wrong), then the workout
runner, gear model, zones and recording pipeline, plus API integration tests
against a throwaway database. CI runs them on every push.

## Known limits

- **Desktop Chromium browsers only.** Web Bluetooth is not available elsewhere.
- **A handful of riders, not a service.** Accounts are made from the command
  line by the server's owner; there is no sign-up, email or password-reset
  flow, and login rate limits live in memory (a restart clears them).
- **Tested against one trainer.** The FTMS implementation follows the spec and is
  covered by tests, but only an Elite Rivo has actually been ridden with it.
- **Trainer accuracy is the trainer's.** The Rivo *calculates* power from brake
  state rather than measuring it with a strain gauge (±2.5% claimed), so treat
  absolute watts accordingly and calibrate it occasionally in the vendor app.
- **Training load is an approximation**, not TrainingPeaks TSS®, which needs
  normalised power the log doesn't retain.

See [PROMPT.md](PROMPT.md) for the full spec, the hardware protocol notes, and
the reasoning behind the design decisions.
