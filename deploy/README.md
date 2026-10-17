# Running Sisyphus on the homelab

```
your PC (WSL2)  --git push-->  GitHub  --tests, build-->  ghcr.io image
                                                              |
homelab VM  <--every 5 min: update.sh (pull, back up, restart)+
   |
   +-- Caddy (shared) ----- https://sisyphus.home ----- Chrome at home
   +-- cloudflared --tunnel--> Cloudflare <--HTTPS----- riders' Chrome anywhere
```

You push to `main`. GitHub Actions runs the tests and, if they pass,
publishes `ghcr.io/victorlev/sisyphus:latest` (and `:<commit sha>`). On the
homelab VM, `sisyphus-update.timer` runs `update.sh` every five minutes. When
the image changed, it backs up the database first, then restarts the app.

The app is reachable two ways, both HTTPS, because Chrome only allows Web
Bluetooth on `localhost` or a secure origin:

- **At home:** `https://sisyphus.home`, served by the VM's shared Caddy
  (`tls internal`) and proxied to `127.0.0.1:3010`. That Caddy also serves
  Homepage, Pi-hole and the rest, so it has its own compose file and is not
  touched here.
- **From anywhere:** a public hostname through a **Cloudflare Tunnel**. The
  `cloudflared` container dials *out* to Cloudflare; nothing is
  port-forwarded. Cloudflare's certificate is real, so riders install
  nothing.

Nothing connects *to* the VM from GitHub: it only pulls. The repo is public,
and GitHub advises against self-hosted runners on public repositories.

Every rider logs in. You create the accounts; there is no sign-up page.

## Where things are

| What | Where |
| --- | --- |
| Compose file | `/mnt/storage/docker/sisyphus/docker-compose.yml` (this folder's `compose.yaml`) |
| Secrets | `/mnt/storage/docker/sisyphus/.env` (`chmod 600`; see `.env.example`) |
| Update script | `/mnt/storage/docker/sisyphus/update.sh` |
| Restore script | `/mnt/storage/docker/sisyphus/restore.sh` |
| Database | Docker volume `sisyphus_sisyphus-data`, on the VM's **local** disk (SQLite locks and corrupts on NFS) |
| Backups | `/mnt/storage/docker/sisyphus/backups/`, on the NFS share, off the VM's disk |
| Timers | `sisyphus-update.timer` (every 5 min), `sisyphus-backup.timer` (nightly) |

Containers: `sisyphus` (the app) and `sisyphus-tunnel` (cloudflared, only
with `COMPOSE_PROFILES=tunnel`).

## Secrets

All of them live only in `.env` beside the compose file:

| Variable | What it is |
| --- | --- |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Your account, created the first time the app starts with no accounts |
| `TUNNEL_TOKEN` | The Cloudflare Tunnel token |
| `COMPOSE_PROFILES=tunnel` | Not a secret, but it is the switch that exposes the app |
| `IMAGE_TAG` (optional) | A commit SHA to pin, for rollback |

The compose folder is on the NFS share, which Samba also exports, so keep
`.env` at `chmod 600`. There is no session secret: login tokens are random,
and only their SHA-256 is stored.

## Rolling out accounts (one time, in this order)

The order matters. The tunnel must only open once a build with logins is
running: before that, anyone with the URL could read and delete the log.

**1. Before merging**, on the VM (`ssh victor@10.10.10.10`):

```sh
cd /mnt/storage/docker/sisyphus
cp docker-compose.yml docker-compose.yml.bak-accounts
# From a checkout of the multi-user branch, copy in everything from deploy/:
# compose.yaml (as docker-compose.yml), update.sh, restore.sh, .env.example
# and the three sisyphus-*.service/.timer files. Diff the compose file
# against the .bak first: service, container and volume names must match.
mkdir -p backups                 # as victor, so uid 1000 can write to it
cp .env.example .env && chmod 600 .env
nano .env                        # ADMIN_USERNAME, ADMIN_PASSWORD; leave the tunnel lines commented
sudo cp sisyphus-update.service sisyphus-backup.service sisyphus-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sisyphus-backup.timer
sh update.sh                     # still the old image: no backup, just applies the new compose config
```

`sisyphus-update.service` replaces the old unit, which ran
`docker compose pull && up -d` with no backup. The timer itself is
unchanged.

**2. Merge the PR.** Within five minutes `update.sh` sees the new image and
takes a `pre-update` backup (using the new image's backup script). Then it
restarts the app, which creates your admin account and hands it every
existing ride, workout, star and setting. Check it:

```sh
journalctl -u sisyphus-update -n 30
ls -l /mnt/storage/docker/sisyphus/backups/
```

Then log in at `https://sisyphus.home`.

**3. Open the tunnel.** In the Cloudflare dashboard (you need a domain on
Cloudflare; the free plan is enough):

1. **Zero Trust → Networks → Tunnels → Create a tunnel** → **Cloudflared** →
   name it `sisyphus`.
2. On the install screen choose **Docker** and copy the token after
   `--token`. Don't run the command; compose runs cloudflared.
3. **Public hostname**: e.g. `sisyphus.<your domain>`, type **HTTP**, URL
   **`sisyphus:3000`** (the compose service name, reached over the compose
   network).

Then on the VM, uncomment `COMPOSE_PROFILES=tunnel` and set `TUNNEL_TOKEN`
in `.env`, and run `sh update.sh`. Open the public URL, log in, and *Connect
Trainer* should work: the certificate is real.

**4. Add your friends** (next section).

## Adding riders

```sh
docker exec sisyphus npm run add-user -- alice --name "Alice"
```

It prints a temporary password. Send the rider the public URL, their
username and that password; they can change it under **Settings →
Account**. `--admin` makes another admin (admins have no extra powers in the
app yet).

| To... | Run on the VM (victor is in the `docker` group) |
| --- | --- |
| Add a rider | `docker exec sisyphus npm run add-user -- <name> [--name "Shown Name"]` |
| Reset a forgotten password | `docker exec sisyphus npm run reset-password -- <name>` (also logs them out everywhere) |
| List accounts | `docker exec sisyphus npm run list-users` |

Usernames are case-insensitive. After 10 failed logins for one username, or
20 from one IP address, logins are refused for 15 minutes.

## Backups

Backups use SQLite's online backup (`db.backup()`), so they're consistent
even mid-ride. Each one is built and checked on local disk, then copied into
`backups/` as a single finished `.db` file. That folder is on the NFS share,
so a backup survives losing the VM's disk.

- **Before every update.** When `update.sh` sees a new image it backs up
  (tag `pre-update`) *before* restarting. If the backup fails, the update
  stops and the old version keeps running; the next run five minutes later
  tries again. The last 14 are kept.
- **Nightly** at 03:30 (tag `nightly`), via `sisyphus-backup.timer`. The last
  14 are kept.
- **By hand:** `docker exec sisyphus npm run backup -- --tag manual`

Check with `ls -lt /mnt/storage/docker/sisyphus/backups` and
`journalctl -u sisyphus-backup`.

## Restore

```sh
cd /mnt/storage/docker/sisyphus
ls -lt backups/                                   # pick one
sh restore.sh backups/sisyphus-nightly-20261018T033012.345Z.db
```

`restore.sh` stops the app and backs up the current database first (tag
`pre-restore`, so a restore can be undone). Then it swaps the backup in and
starts the app. It holds the same lock as `update.sh`, so the timer can't
restart the app halfway through.

## Rollback

Every build is published as `latest` and as its full commit SHA:

```sh
cd /mnt/storage/docker/sisyphus
nano .env          # IMAGE_TAG=<full commit sha>
sh update.sh
```

Delete the line and run `update.sh` again to follow `main`. (Or
`git revert` the bad commit and push.)

A rollback does not undo database changes. Migrations only ever *add*
columns and tables, so an older build usually runs on a newer database. If
it doesn't, restore the `pre-update` backup taken just before the bad
version started.

> **Never roll back to a build from before accounts were added while the
> tunnel is on.** Those builds have no login. Comment out
> `COMPOSE_PROFILES=tunnel` and run `update.sh` first.

## Day to day

| To... | Do this |
| --- | --- |
| Ship a change | Push to `main` and wait about 5 minutes |
| Deploy right away | `sudo systemctl start sisyphus-update.service` |
| See deploy runs | `journalctl -u sisyphus-update` |
| See app logs | `docker logs -f sisyphus` |
| See tunnel logs | `docker logs -f sisyphus-tunnel` |
| Take the app off the internet | Comment out `COMPOSE_PROFILES=tunnel`, then `sh update.sh` |

When this folder's files change in the repo, copy them to the VM again; the
VM has no checkout of the repo.

## Developing on Windows with WSL2

Keep the code inside WSL (`~/projects/sisyphus`), not under `C:\`. File
access is much faster and the tooling matches the server.

```sh
cd ~/projects/sisyphus
npm install --prefix backend
npm run add-user -- me --admin     # once; prints a password
npm run dev       # then open http://localhost:7479 in Chrome on Windows
```

WSL2 forwards `localhost` to Windows, and `localhost` counts as a secure
context, so Bluetooth works in development with no HTTPS or tunnel. The
login cookie is only marked `Secure` over HTTPS, so plain
`http://localhost` logins work. Run `npm test` before pushing; CI runs it
again and will not publish a broken build.
