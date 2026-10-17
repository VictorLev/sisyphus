# Running Sisyphus on a home server

```
your PC (WSL2)  --git push-->  GitHub  --tests, build-->  ghcr.io image
                                                              |
home server  <--every 5 min: git pull + docker compose pull---+
     |
     +-- cloudflared --outbound tunnel--> Cloudflare <--HTTPS-- riders' Chrome
```

You push to `main`. GitHub Actions runs the tests and, if they pass, publishes
a Docker image to `ghcr.io/victorlev/sisyphus`. The home server checks for a
new image every five minutes, backs up the database, and restarts the app,
but only when the image actually changed.

Riders reach the app at a public hostname (say `https://sisyphus.example.com`)
through a **Cloudflare Tunnel**. The `cloudflared` container dials *out* to
Cloudflare; nothing is port-forwarded, and no port is published on the
server. Cloudflare serves a real certificate, which matters because Chrome
only allows Web Bluetooth on `localhost` or HTTPS.

Nothing connects *to* the server from GitHub either: it only pulls. The
repository is public, and GitHub advises against self-hosted runners on
public repositories.

Every rider logs in. Accounts are created by you from the command line;
there is no sign-up page.

## Secrets

All secrets live in `deploy/.env` on the server, and nowhere else:

| Variable | What it is |
| --- | --- |
| `TUNNEL_TOKEN` | The Cloudflare Tunnel token |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Your account, created on the very first start |
| `IMAGE_TAG` (optional) | A commit SHA to pin, for rollback |

`.env` is gitignored and excluded from the image. There is no session
secret: login tokens are random and only their SHA-256 is stored.

## One-time server setup

These steps assume a Debian or Ubuntu VM with Docker (for example a Proxmox
VM or LXC). Run them on the server.

**1. Install Docker** (skip if it is already installed):

```sh
curl -fsSL https://get.docker.com | sudo sh
```

**2. Clone the repo:**

```sh
sudo git clone https://github.com/VictorLev/sisyphus /opt/sisyphus
```

**3. Create the tunnel.** You need a domain on Cloudflare (the free plan is
enough). In the Cloudflare dashboard:

1. **Zero Trust → Networks → Tunnels → Create a tunnel** → type
   **Cloudflared** → name it `sisyphus`.
2. On the install screen, choose **Docker** and copy the long token after
   `--token` in the command shown. That is `TUNNEL_TOKEN`. Don't run the
   command; compose runs cloudflared for you.
3. **Public hostname**: subdomain `sisyphus`, your domain, service type
   **HTTP**, URL **`app:3000`**. (`app` is the compose service name;
   cloudflared reaches it over the compose network.)

**4. Fill in `.env`:**

```sh
cd /opt/sisyphus/deploy
sudo cp .env.example .env
sudo chmod 600 .env
sudo nano .env      # TUNNEL_TOKEN, ADMIN_USERNAME, ADMIN_PASSWORD
```

Pick a long `ADMIN_PASSWORD` (at least 8 characters; wrap it in single
quotes if it contains `$`). It is only read the first time the app starts
with no accounts. After that, change your password in the app.

**5. Start it and turn on automatic updates and nightly backups:**

```sh
sudo ./update.sh
sudo cp sisyphus-update.service sisyphus-update.timer \
        sisyphus-backup.service sisyphus-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sisyphus-update.timer sisyphus-backup.timer
```

If the first pull fails with `unauthorized` or `denied`, the image is still
private. On GitHub go to your profile → **Packages** → **sisyphus** →
**Package settings** → **Change visibility** → **Public**. The code is public
already, so this exposes nothing new.

**6. Log in** at `https://sisyphus.<your domain>` with `ADMIN_USERNAME` and
`ADMIN_PASSWORD`. *Connect Trainer* should work straight away: the
certificate is real, so there is nothing to trust or install.

## Adding riders

```sh
cd /opt/sisyphus/deploy
sudo docker compose exec app npm run add-user -- alice --name "Alice"
```

It prints a temporary password. Send the rider the URL, their username and
that password; they can change it under **Settings → Account**. Add
`--admin` to make another admin (admins have no extra powers in the app
yet).

| To... | Run (in `/opt/sisyphus/deploy`) |
| --- | --- |
| Add a rider | `sudo docker compose exec app npm run add-user -- <name> [--name "Shown Name"]` |
| Reset a forgotten password | `sudo docker compose exec app npm run reset-password -- <name>` (also logs them out everywhere) |
| List accounts | `sudo docker compose exec app npm run list-users` |

Usernames are case-insensitive. After 10 failed logins for one username, or
20 from one IP address, logins are refused for 15 minutes.

## Backups

Backups are SQLite online backups (`db.backup()`), so they are consistent
even while someone is riding. They land in `/opt/sisyphus/deploy/backups/`
on the host, outside the Docker volume, so you can copy them off the
machine.

- **Before every update.** When `update.sh` sees a new image, it backs up
  (tag `pre-update`) *before* restarting. If the backup fails, the update
  stops and the old version keeps running; the next run five minutes later
  tries again. The last 14 are kept.
- **Nightly** at 03:30 (tag `nightly`), via `sisyphus-backup.timer`. The last
  14 are kept.
- **By hand:** `sudo docker compose exec app npm run backup -- --tag manual`

Check them with `ls -lt /opt/sisyphus/deploy/backups` and
`journalctl -u sisyphus-backup`. Each backup is a single `.db` file; copying
one to another machine is a complete copy of every rider's history.

## Restore

```sh
cd /opt/sisyphus/deploy
ls -lt backups/                                   # pick one
sudo ./restore.sh backups/sisyphus-nightly-20261018T033012.345Z.db
```

`restore.sh` stops the app, backs up the current database first (tag
`pre-restore`, so a restore can be undone), swaps the backup in, and starts
the app. It holds the deploy lock, so the update timer can't interfere.

## Rollback

Every build is published twice: as `latest` and as the full commit SHA. To
go back to a known-good build:

```sh
cd /opt/sisyphus/deploy
sudo nano .env       # IMAGE_TAG=<full commit sha>
sudo ./update.sh
```

To follow `main` again, remove the line and run `update.sh`. (Or
`git revert` the bad commit and push; the server follows `main`.)

A rollback does not undo database changes. Migrations only ever *add*
columns and tables, so an older build usually runs fine on a newer database.
If it doesn't, restore the `pre-update` backup taken just before the bad
version started.

> **Never roll back to a build from before accounts were added** while the
> tunnel is up. Those builds have no login, so anyone with the URL could
> read and delete every rider's history.

## Day to day

| To... | Do this |
| --- | --- |
| Ship a change | Push to `main` and wait about 5 minutes |
| Deploy right away | `sudo /opt/sisyphus/deploy/update.sh` |
| See deploy runs | `journalctl -u sisyphus-update` |
| See app logs | `cd /opt/sisyphus/deploy && sudo docker compose logs -f app` |
| See tunnel logs | `cd /opt/sisyphus/deploy && sudo docker compose logs -f cloudflared` |

The database itself is in the `sisyphus-data` Docker volume. Backing up the
whole VM (on Proxmox: **Datacenter → Backup**) covers it too.

## Upgrading from the LAN-only (Caddy) setup

Do this once, **before** merging the accounts change into `main`:

1. Create the tunnel (step 3 above) and add `TUNNEL_TOKEN`,
   `ADMIN_USERNAME` and `ADMIN_PASSWORD` to `/opt/sisyphus/deploy/.env`. The
   old `SITE_ADDRESS`, `HTTP_PORT` and `HTTPS_PORT` lines can go. Without
   `TUNNEL_TOKEN` the new compose file refuses to start, and the old
   version keeps running.
2. Take a manual backup. The first update after the merge is run by the
   *old* `update.sh`, which doesn't know how to back up:
   ```sh
   cd /opt/sisyphus/deploy
   sudo docker compose stop app
   sudo docker compose cp app:/data ./pre-accounts-data
   sudo docker compose start app
   ```
3. Merge. Within five minutes the server pulls, the Caddy container is
   removed, cloudflared starts, and your admin account is created. Every
   existing ride, workout, setting and star becomes yours.
4. Install the nightly backup timer (the `sisyphus-backup.*` lines in
   step 5).
5. Optionally clean up: `sudo docker volume rm deploy_caddy-data deploy_caddy-config`,
   and remove the old Caddy root certificate from the riding PC
   (`certmgr.msc` → Trusted Root Certification Authorities → "Caddy Local
   Authority").

## Developing on Windows with WSL2

Keep the code inside WSL (`~/code/sisyphus`), not under `C:\`. File access is
much faster and the tooling matches the server.

```sh
git clone git@github.com:VictorLev/sisyphus.git ~/code/sisyphus
cd ~/code/sisyphus
npm install --prefix backend
npm run add-user -- me --admin     # once; prints a password
npm run dev       # then open http://localhost:7479 in Chrome on Windows
```

WSL2 forwards `localhost` to Windows, and `localhost` counts as a secure
context, so Bluetooth works during development with no HTTPS or tunnel. The
login cookie is only marked `Secure` when the request came over HTTPS, so
plain `http://localhost` logins work. Run `npm test` before pushing; CI runs
it again and will not publish a broken build.
