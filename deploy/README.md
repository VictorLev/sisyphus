# Running Sisyphus on the homelab

```
pull request ──> CI: tests + build the image and smoke-test it ──> merge
merge to main ──> CI publishes :latest and :<sha>   (nothing deploys it)
git tag v1.2.3 ──> CI promotes that commit's image to :stable
                    └─> the homelab deploys it at 03:45: backup first,
                        health check after, automatic rollback
```

**Merging is not releasing.** You can merge as often as you like; the
homelab only moves when you push a version tag, and then in the 03:45 window
(or right away if you deploy it by hand). A release never rebuilds: it
re-tags the image CI already built and smoke-tested for that commit.

The app runs on the homelab VM (`ssh victor@10.10.10.10`):

| What | Where |
| --- | --- |
| Compose file | `/mnt/storage/docker/sisyphus/docker-compose.yml` (this folder's `compose.yaml`) |
| Secrets | `/mnt/storage/docker/sisyphus/.env` (`chmod 600`; see `.env.example`) |
| Scripts | `update.sh` and `restore.sh` beside the compose file |
| Database | Docker volume `sisyphus_sisyphus-data`, on the VM's **local** disk (SQLite locks and corrupts on NFS) |
| Backups | `/mnt/storage/docker/sisyphus/backups/`, on the NFS share, off the VM's disk |
| Timers | `sisyphus-backup.timer` 03:30, `sisyphus-update.timer` 03:45 |

Containers: `sisyphus` (the app, `127.0.0.1:3010`) and `sisyphus-tunnel`
(cloudflared, only with `COMPOSE_PROFILES=tunnel`).

Two ways in, both HTTPS, because Chrome only allows Web Bluetooth on HTTPS or
`localhost`:
- **At home:** `https://sisyphus.home`. The VM's shared Caddy (`tls internal`) proxies it to `127.0.0.1:3010`. That Caddy also serves Homepage, Pi-hole and the rest, and is not part of this compose file.
- **From anywhere:** a public hostname on a **Cloudflare Tunnel**. The `cloudflared` container dials *out* to Cloudflare, so nothing is port-forwarded, and the certificate is real.

Nothing connects *to* the VM from GitHub: it only pulls. The repo is public,
and GitHub advises against self-hosted runners on public repositories.

## Shipping a change

1. **Branch and open a pull request.** Name the branch by the convention in
   the main README (`feat/…`, `fix/…`, `breaking/…`, `chore/…`, `docs/…`,
   `ci/…`). CI checks the name and runs the tests. It also builds the Docker
   image and smoke-tests it (`scripts/smoke-image.sh`): it upgrades a
   pre-accounts database, logs in, checks the 401s, runs `add-user` and a
   backup inside the container, and checks a clean stop and restart.
2. **Try it locally** before releasing: `npm run dev`, then open
   `http://localhost:7479`. Merge when you're happy and CI is green.
3. **Release it.** The branches merged since the last tag pick the number:
   any `breaking/` → major, else any `feat/` → minor, else patch.
   ```sh
   git log --merges --oneline "$(git describe --tags --abbrev=0)"..origin/main
   git tag v1.2.3 origin/main
   git push origin v1.2.3
   ```
   CI promotes that commit's image to `:stable`, and the homelab deploys it
   at 03:45. To deploy right away: `sudo systemctl start sisyphus-update.service`,
   or `sh update.sh` in the compose folder.

Every deploy does three things:
- **Backs up first** (tag `pre-update`). If the backup fails, nothing restarts.
- **Then checks health.** The new version must answer `/api/health` within about 90 seconds. If it doesn't, `update.sh` **puts the previous image back** and records the failed image in `.bad-image`, so it isn't redeployed every night. The run shows as failed in `systemctl status sisyphus-update`, and `journalctl -u sisyphus-update` has the details.
- **Leaves the database alone on rollback.** Migrations only ever add, so the previous version still runs on it.

## Secrets

They live only in `/mnt/storage/docker/sisyphus/.env`:

| Variable | What it is |
| --- | --- |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Creates the first account on a database with none; ignored after that |
| `TUNNEL_TOKEN` | The Cloudflare Tunnel token |
| `COMPOSE_PROFILES=tunnel` | Not a secret, but it is the switch that exposes the app |
| `IMAGE_TAG` | Unset = `stable`; a version or commit SHA pins it (rollback) |

The folder is on the NFS share, which Samba also exports, so keep `.env` at
`chmod 600`. There is no session secret: login tokens are random, and only
their SHA-256 is stored.

## Setting it up from scratch

On the VM, as victor (victor is in the `docker` group):

```sh
git clone --depth 1 https://github.com/VictorLev/sisyphus ~/sisyphus-src
sudo mkdir -p /mnt/storage/docker/sisyphus/backups
sudo chown -R victor:victor /mnt/storage/docker/sisyphus
cd /mnt/storage/docker/sisyphus
S=~/sisyphus-src/deploy
cp "$S/compose.yaml" docker-compose.yml
cp "$S/update.sh" "$S/restore.sh" "$S/.env.example" .
cp .env.example .env && chmod 600 .env
nano .env                  # ADMIN_USERNAME, ADMIN_PASSWORD; tunnel lines stay commented
sh update.sh

sudo cp "$S/sisyphus-update.service" "$S/sisyphus-update.timer" \
        "$S/sisyphus-backup.service" "$S/sisyphus-backup.timer" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sisyphus-update.timer sisyphus-backup.timer
```

Then add the `sisyphus.home` site to Caddy, and open the tunnel:

1. In the Cloudflare dashboard (you need a domain on Cloudflare; the free plan
   is enough), go to **Zero Trust → Networks → Tunnels → Create a tunnel** →
   **Cloudflared**.
2. Choose **Docker** and copy the token after `--token`. Don't run the
   command; compose runs cloudflared.
3. **Public hostname**: e.g. `sisyphus.<your domain>`, type **HTTP**, URL
   **`sisyphus:3000`**.
4. In `.env`, uncomment `COMPOSE_PROFILES=tunnel`, set `TUNNEL_TOKEN`, and run
   `sh update.sh`.

**Only open the tunnel on a build with logins** (v1.0.0 or later).

When this folder's files change in the repo, `git -C ~/sisyphus-src pull` and
copy them again; the compose folder is not a checkout.

## Adding riders

```sh
docker exec sisyphus npm run add-user -- alice --name "Alice"
```

It prints a temporary password. Send the rider the public URL, their
username and that password; they can change it under **Settings →
Account**.

| To... | Run on the VM |
| --- | --- |
| Add a rider | `docker exec sisyphus npm run add-user -- <name> [--name "Shown Name"]` |
| Reset a forgotten password | `docker exec sisyphus npm run reset-password -- <name>` (also logs them out everywhere) |
| List accounts | `docker exec sisyphus npm run list-users` |
| Delete an account and all its data | `docker exec sisyphus npm run delete-user -- <name>` shows what would go; add `--yes` to delete. The last admin can't be deleted. |

Usernames are case-insensitive. After 10 failed logins for one username, or
20 from one IP address, logins are refused for 15 minutes.

## Routes

**Routes** are rides along a filmed road. The video plays at your speed,
and the road's grade sets the resistance. The admin imports them from the
Routes page, with two files: the route file (JSON: `geometry` with distance
and altitude, plus `video_points` mapping distance to video time) and the
video (MP4).

- The videos live in `routes/<id>/video.mp4` beside the compose file, on
  the NFS share. The compose file mounts it as `/routes`. Before the first
  import, create it with `mkdir routes` and `chown 1000:1000 routes`.
- Uploads go in 32 MB pieces and resume where they stopped if interrupted.
  That's because Cloudflare refuses requests over 100 MB.
- Videos aren't in the database backups (too big). They're only on the
  share.
- **Make videos smaller before importing.** A 1080p route video can run at
  20+ Mbit/s, and everyone outside the house streams it from the home
  connection through Cloudflare. 720p at a moderate quality is plenty
  behind a dashboard:
  ```sh
  ffmpeg -i video.mp4 -vf scale=-2:720 -c:v libx264 -preset slow -crf 26 -an -movflags +faststart route-720p.mp4
  ```
  `-an` drops the sound, and `+faststart` lets playback start before the
  whole file has loaded.

## Backups

Backups use SQLite's online backup (`db.backup()`), so they're consistent
even mid-ride. Each is built and checked on local disk, then copied into
`backups/` as one finished `.db` file. That folder is on the NFS share, so a
backup survives losing the VM's disk.

- **Before every deploy** (tag `pre-update`). If it fails, the deploy stops. The last 14 are kept.
- **Nightly at 03:30** (tag `nightly`). The last 14 are kept.
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

A failed health check rolls back by itself. To go back by choice, pin a
release in `.env` and deploy:

```sh
cd /mnt/storage/docker/sisyphus
nano .env          # IMAGE_TAG=v1.1.0   (or a full commit SHA)
sh update.sh
```

Delete the line to follow `:stable` again, or release a fix as a new version.

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
| Release | `git tag vX.Y.Z origin/main && git push origin vX.Y.Z`; deploys at 03:45 |
| Deploy right away | `sudo systemctl start sisyphus-update.service` |
| See deploys | `journalctl -u sisyphus-update` |
| App logs | `docker logs -f sisyphus` |
| Tunnel logs | `docker logs -f sisyphus-tunnel` |
| Retry an image that failed its health check | `rm /mnt/storage/docker/sisyphus/.bad-image && sh update.sh` |
| Take the app off the internet | Comment out `COMPOSE_PROFILES=tunnel`, then `sh update.sh` |

## Developing on Windows with WSL2

Keep the code inside WSL (`~/projects/sisyphus`), not under `C:\`. File
access is much faster and the tooling matches the server.

```sh
cd ~/projects/sisyphus
npm install --prefix backend
npm run add-user -- me --admin --password me   # once; locally any password works
npm run dev       # then open http://localhost:7479 in Chrome on Windows
```

WSL2 forwards `localhost` to Windows, and `localhost` counts as a secure
context, so Bluetooth works in development with no HTTPS or tunnel. The
login cookie is only marked `Secure` over HTTPS, so plain
`http://localhost` logins work. Run `npm test` before pushing; CI runs it
again, plus the image smoke test, and won't publish a broken build.
