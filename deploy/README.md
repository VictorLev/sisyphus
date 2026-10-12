# Running Sisyphus on a home server

```
your PC (WSL2)  --git push-->  GitHub  --tests, build-->  ghcr.io image
                                                              |
home server  <--every 5 min: git pull + docker compose pull---+
```

You push to `main`. GitHub Actions runs the tests and, if they pass, publishes
a Docker image to `ghcr.io/victorlev/sisyphus`. The home server checks for a
new image every five minutes and restarts the app only if something changed.

Nothing ever connects *to* the server: it only pulls. That matters because this
repository is public, and GitHub advises against self-hosted runners on public
repositories (a pull request from a fork could run code on the runner's
machine).

## Why HTTPS

Chrome only allows Web Bluetooth on `localhost` or HTTPS. Once the app is
served from another machine, plain `http://` silently breaks the trainer
connection. Caddy terminates HTTPS with a certificate from its own local
authority, so no domain or internet exposure is needed. You trust that
authority once on the PC beside the bike (step 5).

**Keep it on your LAN.** The app has no login. Never port-forward it.

## One-time server setup

These steps assume a Debian or Ubuntu VM (for example a Proxmox VM or LXC with
Docker). Run them on the server.

**1. Install Docker** (skip if it is already installed):

```sh
curl -fsSL https://get.docker.com | sudo sh
```

**2. Clone the repo:**

```sh
sudo git clone https://github.com/VictorLev/sisyphus /opt/sisyphus
```

**3. Set the address** you will type in Chrome (the server's LAN IP):

```sh
cd /opt/sisyphus/deploy
sudo cp .env.example .env
sudo nano .env        # SITE_ADDRESS=<server IP>
```

If ports 80 or 443 are already taken on that server, change `HTTP_PORT` and
`HTTPS_PORT`. Leave `SITE_ADDRESS` as the bare IP, and put the port in the
URL instead, e.g. `https://192.168.2.50:8443`.

**4. Start it and turn on automatic updates:**

```sh
sudo ./update.sh
sudo cp sisyphus-update.service sisyphus-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sisyphus-update.timer
```

If the first pull fails with `unauthorized` or `denied`, the image is still
private. On GitHub go to your profile → **Packages** → **sisyphus** →
**Package settings** → **Change visibility** → **Public**. The code is public
already, so this exposes nothing new.

**5. Trust Caddy's certificate on the riding PC.** On the server:

```sh
sudo docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

Copy `caddy-root.crt` to the Windows PC (for example with `scp` from WSL),
double-click it → **Install Certificate** → **Local Machine** → **Place all
certificates in the following store** → **Trusted Root Certification
Authorities**. Restart Chrome, then open `https://<server IP>`. There should be
no warning, and *Connect Trainer* should work.

This is a one-time step. The root stays valid for years, and Caddy renews the
site certificate by itself.

## Day to day

| To... | Do this |
| --- | --- |
| Ship a change | Push to `main` and wait about 5 minutes |
| Deploy right away | `sudo /opt/sisyphus/deploy/update.sh` |
| Roll back | `git revert` the bad commit and push; the server follows `main` |
| See deploy runs | `journalctl -u sisyphus-update` |
| See app logs | `cd /opt/sisyphus/deploy && sudo docker compose logs -f app` |

Your ride history is in the `sisyphus-data` Docker volume on the server. Back up
the whole VM (on Proxmox: **Datacenter → Backup**) and the history is included.

## Developing on Windows with WSL2

Keep the code inside WSL (`~/code/sisyphus`), not under `C:\`. File access is
much faster and the tooling matches the server.

```sh
git clone git@github.com:VictorLev/sisyphus.git ~/code/sisyphus
cd ~/code/sisyphus
npm install --prefix backend
code .            # opens VS Code attached to WSL
npm run dev       # then open http://localhost:3000 in Chrome on Windows
```

WSL2 forwards `localhost` to Windows, and `localhost` counts as a secure
context, so Bluetooth works during development with no HTTPS setup. Run
`npm test` before pushing; CI runs it again and will not publish a broken build.
