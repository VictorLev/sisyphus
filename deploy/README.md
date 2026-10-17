# Running Sisyphus on the homelab

```
pull request ──> CI: tests + build the image and smoke-test it ──> merge
                                                                     │
merge to main ──> CI publishes :latest ──> STAGING follows it (every 5 min,
                                           on a nightly copy of prod's data)
                                                                     │
git tag v1.2.3 ──> CI promotes that exact image to :stable ──> PROD deploys
                                           it at 03:45 (backup first, health
                                           check after, automatic rollback)
```

**Merging is not releasing.** A merge reaches staging within five minutes.
Prod only moves when you push a version tag, and then only in the 03:45
window (or when you deploy it by hand). Prod runs the exact image bytes
staging ran: a release re-tags, it never rebuilds.

Both instances run on the homelab VM (`ssh victor@10.10.10.10`) from the same
compose file, each in its own folder:

| | Prod | Staging |
| --- | --- | --- |
| Folder | `/mnt/storage/docker/sisyphus/` | `/mnt/storage/docker/sisyphus-staging/` |
| Image | `:stable` (last `v*` tag) | `:latest` (main) |
| Container / port | `sisyphus` on `127.0.0.1:3010` | `sisyphus-staging` on `127.0.0.1:3011` |
| Database | volume `sisyphus_sisyphus-data` | volume `sisyphus-staging_sisyphus-data`, replaced nightly with a copy of prod's |
| Deploys | nightly 03:45 (`sisyphus-update.timer`) | every 5 min (`sisyphus-staging-update.timer`) |
| Reached at | `https://sisyphus.home` (shared Caddy) and the Cloudflare Tunnel | an SSH tunnel to `localhost:3011`; LAN only |

Both databases sit in volumes on the VM's **local** disk (SQLite locks and
corrupts on NFS). Backups go to each folder's `backups/`, on the NFS share.

Web Bluetooth needs HTTPS or `localhost`:
- **At home**, prod is `https://sisyphus.home`. The VM's shared Caddy (`tls internal`) proxies it to `127.0.0.1:3010`. That Caddy also serves Homepage, Pi-hole and the rest, and is not part of this compose file.
- **From anywhere**, prod is a public hostname on a **Cloudflare Tunnel**. The `sisyphus-tunnel` container dials *out* to Cloudflare, so nothing is port-forwarded, and Cloudflare's certificate is real.
- **Staging** is reached through `localhost` over SSH, which counts as secure, so you can even ride it.

Nothing connects *to* the VM from GitHub: it only pulls. The repo is public,
and GitHub advises against self-hosted runners on public repositories.

## Shipping a change

1. **Open a pull request** from a branch named by the convention in the main
   README (`feat/…`, `fix/…`, `breaking/…`, `chore/…`, `docs/…`, `ci/…`). CI checks the name, runs the tests and builds the Docker image,
   then smoke-tests it (`scripts/smoke-image.sh`). The smoke test upgrades a
   pre-accounts database, logs in, checks the 401s, runs `add-user` and a
   backup inside the container, and checks that a stop and restart are
   clean. Merge when it's green.
2. **Try it on staging** five minutes later. From your PC:
   ```sh
   ssh -L 3011:127.0.0.1:3011 victor@10.10.10.10
   ```
   Then open `http://localhost:3011` in Chrome and log in with your prod
   account. (Add `-J root@192.168.0.38` if your PC can't reach `10.10.10.x`
   directly.) It's last night's prod data, so you're testing the migration
   on real rides. Anything you do there is wiped at 03:40.
3. **Release it** when you're happy. The branches merged since the last tag
   pick the number: any `breaking/` → major, else any `feat/` → minor, else patch.
   ```sh
   git log --merges --oneline "$(git describe --tags --abbrev=0)"..origin/main
   git tag v1.2.3 origin/main      # or a specific commit that has been on main
   git push origin v1.2.3
   ```
   CI promotes that commit's image to `:stable`. Prod deploys it at 03:45.
   To deploy now instead: `sudo systemctl start sisyphus-update@sisyphus.service`,
   or `sh update.sh` in the prod folder.

Every prod deploy:
- **Backs up first** (tag `pre-update`). If the backup fails, nothing restarts.
- **Then checks health.** The new version must answer `/api/health` within about 90 seconds. If it doesn't, `update.sh` **puts the previous image back** and writes the failed image's ID to `.bad-image`, so it isn't redeployed every run. The timer run is then marked failed. To see what happened: `systemctl status sisyphus-update@sisyphus` and `journalctl -u sisyphus-update@sisyphus`.
- **Leaves the database alone on rollback.** Migrations only ever add, so the previous version still runs on it.

Staging deploys the same way, every five minutes.

## Secrets

They live only in each folder's `.env` (see `.env.example`):

| Variable | Where | What it is |
| --- | --- | --- |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | prod, staging | Creates the first account on a database with none; ignored after that |
| `TUNNEL_TOKEN` | prod | The Cloudflare Tunnel token |
| `COMPOSE_PROFILES=tunnel` | prod | Not a secret, but it is the switch that exposes the app |
| `IMAGE_TAG` | both | Prod: unset (= `stable`), or a pin for rollback. Staging: `latest` |
| `SISYPHUS_ROLE=staging`, `CONTAINER_NAME`, `HOST_PORT` | staging | Make the second instance a staging one |

The folders are on the NFS share, which Samba also exports, so keep `.env` at
`chmod 600`. There is no session secret: login tokens are random, and only
their SHA-256 is stored.

## Rolling out accounts and this pipeline (one time, in this order)

The order matters for two reasons:
- Prod must not pick up the change before its backup-first `update.sh` is in place.
- The tunnel must not open before a build with logins is running. Before that, anyone with the URL could read and delete the log.

**1. Prod folder, before merging.** On the VM, from a checkout of the branch:

```sh
cd /mnt/storage/docker/sisyphus
cp docker-compose.yml docker-compose.yml.bak-accounts
# Copy in from deploy/: compose.yaml (as docker-compose.yml), update.sh,
# restore.sh, .env.example. Diff the compose file against the .bak first:
# the volume key must stay `sisyphus-data`, or Compose creates a new,
# empty volume.
mkdir -p backups
cp .env.example .env && chmod 600 .env
nano .env
#   ADMIN_USERNAME, ADMIN_PASSWORD
#   IMAGE_TAG=79bb74e75d5dc5f3ce9d82af249f80b45fc2de37   <- what prod runs today;
#                                                           :stable doesn't exist yet
sh update.sh            # same image as now: just applies the new compose config
```

Then the units. The new `sisyphus-update.timer` is nightly and starts the
template service, so remove the old 5-minute service first:

```sh
sudo systemctl disable --now sisyphus-update.timer
sudo rm /etc/systemd/system/sisyphus-update.service
# from deploy/:
sudo cp sisyphus-update@.service sisyphus-update.timer \
        sisyphus-backup.service sisyphus-backup.timer \
        sisyphus-staging-update.timer \
        sisyphus-staging-refresh.service sisyphus-staging-refresh.timer \
        /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sisyphus-update.timer sisyphus-backup.timer
```

**2. Merge the PR.** CI publishes `:latest`. Prod is pinned and doesn't move.

**3. Staging folder.**

```sh
mkdir -p /mnt/storage/docker/sisyphus-staging/backups
cd /mnt/storage/docker/sisyphus-staging
# Copy in the same files: compose.yaml (as docker-compose.yml), update.sh,
# restore.sh, refresh-staging.sh.
nano .env && chmod 600 .env
#   SISYPHUS_ROLE=staging
#   ADMIN_USERNAME=victor   ADMIN_PASSWORD=...   (same as prod)
#   IMAGE_TAG=latest
#   CONTAINER_NAME=sisyphus-staging
#   HOST_PORT=3011
sh refresh-staging.sh   # copies prod's live database and starts staging on it
sh update.sh            # health check
sudo systemctl enable --now sisyphus-staging-update.timer sisyphus-staging-refresh.timer
```

Open staging through the SSH tunnel (see "Shipping a change") and check that
your rides, workouts and settings are all there.

**4. First release.** On your PC: `git tag v1.0.0 origin/main && git push origin v1.0.0`.
Once CI's `release` job is green, on the VM:

```sh
cd /mnt/storage/docker/sisyphus
nano .env               # delete the IMAGE_TAG line: prod now follows :stable
sh update.sh            # pre-update backup, migration, health check
```

Log in at `https://sisyphus.home`.

**5. Open the tunnel.** In the Cloudflare dashboard (you need a domain on
Cloudflare; the free plan is enough):

1. **Zero Trust → Networks → Tunnels → Create a tunnel** → **Cloudflared**,
   named `sisyphus`.
2. On the install screen choose **Docker** and copy the token after
   `--token`. Don't run the command; compose runs cloudflared.
3. **Public hostname**: e.g. `sisyphus.<your domain>`, type **HTTP**, URL
   **`sisyphus:3000`**.

Then in prod's `.env`, uncomment `COMPOSE_PROFILES=tunnel` and set
`TUNNEL_TOKEN`, and run `sh update.sh`. Open the public URL and log in.

**6. Add your friends** (next section).

## Adding riders

```sh
docker exec sisyphus npm run add-user -- alice --name "Alice"
```

It prints a temporary password. Send the rider the public URL, their
username and that password; they can change it under **Settings →
Account**. Accounts are made on prod, and staging picks them up at the next
nightly refresh.

| To... | Run on the VM (victor is in the `docker` group) |
| --- | --- |
| Add a rider | `docker exec sisyphus npm run add-user -- <name> [--name "Shown Name"]` |
| Reset a forgotten password | `docker exec sisyphus npm run reset-password -- <name>` (also logs them out everywhere) |
| List accounts | `docker exec sisyphus npm run list-users` |

Usernames are case-insensitive. After 10 failed logins for one username, or
20 from one IP address, logins are refused for 15 minutes.

## Backups

Backups use SQLite's online backup (`db.backup()`), so they're consistent
even mid-ride. Each is built and checked on local disk, then copied into
`backups/` as one finished `.db` file. That folder is on the NFS share, so a
backup survives losing the VM's disk.

- **Before every prod deploy** (tag `pre-update`). If it fails, the deploy
  stops. The last 14 are kept.
- **Nightly at 03:30** (tag `nightly`), via `sisyphus-backup.timer`. The last 14 are kept.
- **By hand:** `docker exec sisyphus npm run backup -- --tag manual`

Check with `ls -lt /mnt/storage/docker/sisyphus/backups` and `journalctl -u sisyphus-backup`.

## Restore

```sh
cd /mnt/storage/docker/sisyphus
ls -lt backups/
sh restore.sh backups/sisyphus-nightly-20261018T033012.345Z.db
```

`restore.sh` stops the app and backs up the current database first (tag
`pre-restore`, so a restore can be undone). Then it swaps the backup in and
starts the app, holding the same lock as `update.sh`.

## Rollback

A failed health check rolls back by itself (see "Shipping a change"). To go
back by choice, pin a release in prod's `.env` and deploy:

```sh
cd /mnt/storage/docker/sisyphus
nano .env          # IMAGE_TAG=v1.1.0   (or a full commit SHA)
sh update.sh
```

Delete the line to follow `:stable` again. Or move `stable` itself: tag the
fix as a new version.

A rollback does not undo database changes. Migrations only ever *add*
columns and tables, so an older version usually runs on a newer database.
If it doesn't, restore the `pre-update` backup taken just before the bad
version started.

> **Never roll back to a build from before accounts were added (anything
> before v1.0.0) while the tunnel is on.** Those builds have no login.
> Comment out `COMPOSE_PROFILES=tunnel` and run `update.sh` first.

## Day to day

| To... | Do this |
| --- | --- |
| Ship to staging | Merge to `main`, wait about 5 minutes |
| Release to prod | `git tag vX.Y.Z origin/main && git push origin vX.Y.Z`; prod deploys at 03:45 |
| Deploy prod right away | `sudo systemctl start sisyphus-update@sisyphus.service` |
| See prod deploys | `journalctl -u sisyphus-update@sisyphus` |
| See staging deploys | `journalctl -u sisyphus-update@sisyphus-staging` |
| App logs | `docker logs -f sisyphus` / `docker logs -f sisyphus-staging` |
| Tunnel logs | `docker logs -f sisyphus-tunnel` |
| Retry an image that failed its health check | `rm /mnt/storage/docker/sisyphus/.bad-image && sh update.sh` |
| Take prod off the internet | Comment out `COMPOSE_PROFILES=tunnel`, then `sh update.sh` |
| Refresh staging now | `sh /mnt/storage/docker/sisyphus-staging/refresh-staging.sh` |

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
again, plus the image smoke test, and won't publish a broken build.
