<div align="center">

# ◼ KALL DESKTOP

### Open-source remote desktop · GitHub Actions + Tailscale + React panel

[![Contributors](https://img.shields.io/github/contributors/xykalnotkel/rdp-tailscale?style=for-the-badge&labelColor=000000&color=ffffff&logo=github&logoColor=white)](https://github.com/xykalnotkel/rdp-tailscale/graphs/contributors)
[![License](https://img.shields.io/github/license/xykalnotkel/rdp-tailscale?style=for-the-badge&labelColor=000000&color=ffffff)](LICENSE)
[![Stars](https://img.shields.io/github/stars/xykalnotkel/rdp-tailscale?style=for-the-badge&labelColor=000000&color=ffffff&logo=star&logoColor=white)](https://github.com/xykalnotkel/rdp-tailscale/stargazers)
[![Forks](https://img.shields.io/github/forks/xykalnotkel/rdp-tailscale?style=for-the-badge&labelColor=000000&color=ffffff&logo=git&logoColor=white)](https://github.com/xykalnotkel/rdp-tailscale/network)
[![Issues](https://img.shields.io/github/issues/xykalnotkel/rdp-tailscale?style=for-the-badge&labelColor=000000&color=ffffff&logo=github&logoColor=white)](https://github.com/xykalnotkel/rdp-tailscale/issues)
[![Last commit](https://img.shields.io/github/last-commit/xykalnotkel/rdp-tailscale?style=for-the-badge&labelColor=000000&color=ffffff&logo=git&logoColor=white)](https://github.com/xykalnotkel/rdp-tailscale/commits/main)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-white?style=for-the-badge&labelColor=000000&color=ffffff&logo=github&logoColor=white)](CONTRIBUTING.md)
[![Workflow](https://img.shields.io/github/actions/workflow/status/xykalnotkel/rdp-tailscale/rdp-tailscale.yml?branch=main&style=for-the-badge&label=workflow&labelColor=000000&color=ffffff&logo=githubactions&logoColor=white)](https://github.com/xykalnotkel/rdp-tailscale/actions)

**Fork** · [**Contribute**](CONTRIBUTING.md) · [**Report**](https://github.com/xykalnotkel/rdp-tailscale/issues/new) · [**Security**](SECURITY.md)

</div>

---

Spin up an ephemeral **Windows Server** or **Linux (Ubuntu + XFCE)** desktop
on GitHub Actions runners, join it to **your Tailscale tailnet**
automatically, and drive everything from a minimal **black & white React
control panel**: start/stop, live IP + password, session logs, raw Actions
logs, and custom wallpaper uploads. No public IP, no VPS bill, no manual
"click link" every time — **bring your own keys**.

## Highlights

- 🖥️ **Two OS options** per session — Windows Server 2022/2025 or Linux Ubuntu (XFCE via xrdp)
- ⚡ **Cepat / Full modes** — Cepat = RDP-ready in ~4 minutes; Full = + Chrome,
  Firefox, VC++, DirectX, WebView2, TranslucentTB (transparent taskbar), Lightshot
- 🔑 **Your keys, your instance** — GitHub token, Tailscale auth key, and
  panel key are all supplied by you via secrets/env; nothing shared, nothing hardcoded
- 🔒 **Fixed or random password** — set `RDP_PASSWORD` for a permanent
  password, or leave empty for a fresh random one each session
- 🛰️ **Tailscale auto-login** — one *Reusable* auth key = zero click-link,
  zero device-approval (if you disable device approval)
- 🎛️ **React control panel** — B/W monochrome UI, no bloat, works on Vercel
  free tier or any Node host / Docker
- 📜 **Two logs** — *Session log* (panel events) and *Actions log* (live
  GitHub runner steps + raw output)
- 🖼️ **Wallpaper upload** — set any JPG/PNG/WebP as the session wallpaper
  (default: uploaded file; per-session override possible)
- 🌐 **Custom domain** — panel works behind any domain (e.g. `k.xyc.my.id`)
  since it's plain HTTPS

## How it works

```
┌────────────────┐  dispatch (Mulai)   ┌───────────────────────┐
│  React Panel   │ ──────────────────► │  GitHub Actions job   │
│  (Vercel/Node) │                     │  Windows / Ubuntu VM  │
│                │ ◄────────────────── │  + Tailscale auto-up  │
└────────────────┘   runtime/state.json│  + provisioning       │
        │               (AES-256 blob) │  + keep-alive ≤6h     │
        │                              └───────────────────────┘
        └──►  You connect with any RDP client:
              <tailscale-ip>:3389  or  kall.<tailnet>.ts.net
```

Session credentials are encrypted with `PANEL_KEY` before being written to
`runtime/state.json`, then the panel decrypts and displays them — no need to
open GitHub Actions at all.

## Quick start (2 minutes to your own instance)

1. **Fork** this repo to your account — or use the button
   [fork/network](https://github.com/xykalnotkel/rdp-tailscale/network/members).
2. In **your fork** add these repository secrets
   (Settings → Secrets and variables → Actions):

   | Secret | Required | Value |
   |---|---|---|
   | `PANEL_KEY` | ✅ | `openssl rand -hex 32` |
   | `RDP_PASSWORD` | optional | fixed desktop password (leave empty = random) |
   | `TS_AUTHKEY` | optional | your **Reusable** Tailscale auth key from https://login.tailscale.com/admin/settings/keys |

3. Run the panel (local, or free Vercel/Docker/Render):

   ```bash
   cd panel
   npm install && npm run build --prefix web
   GITHUB_REPO=<YOU>/rdp-tailscale \
   GITHUB_TOKEN=<YOUR_GITHUB_TOKEN> \
   PANEL_KEY=<YOUR_PANEL_KEY> \
   node server.js
   # open http://localhost:3000
   ```

   For Vercel: import this repo → set the same three env vars
   (`GITHUB_REPO`, `GITHUB_TOKEN`, `PANEL_KEY`) → deploy. Static `public/`
   is served and `/api/*` works serverless.

4. In the panel click **Mulai Desktop**, pick OS + mode, wait ~4 minutes →
   **PC HIDUP** shows IP + password + `.rdp` download button.

> Every dev runs on **their own keys & their own forks**. The upstream repo
> contains no credentials — only code. See [CONTRIBUTING.md](CONTRIBUTING.md)
> for the full dev/fork guide.

## Deployment options

| Target | Notes |
|---|---|
| Node (local/VPS) | `node server.js`, port 3000 |
| Docker | `docker build -t kall-panel panel && docker run -p 3000:3000 -e ...` |
| Vercel (free) | `panel/` is serverless-ready (`api/[slug].js`), static `public/` auto-served |
| Custom domain | Any plain HTTPS domain — e.g. point `k.xyc.my.id` CNAME at `cname.vercel-dns.com` |

Environment variables: `GITHUB_REPO` (required), `GITHUB_TOKEN` (required for
start/stop/uploads; read-only status works without it on public repos),
`PANEL_KEY`, `PANEL_ADMIN` (optional PIN), `BRANCH` (default `main`),
`PORT` (default 3000).

## Repository layout

```
.github/workflows/rdp-tailscale.yml   # the whole VM lifecycle (Windows/Linux)
provision.ps1                         # Windows provisioning (Cepat/Full)
provision-linux.sh                    # Ubuntu provisioning (XFCE + xrdp)
panel/core.js                         # backend API (Node + Vercel compatible)
panel/server.js                       # local server
panel/web/                            # React + Vite source (npm run build)
panel/public/                         # built app (generated)
runtime/state.json                    # encrypted live session state
LICENSE · SECURITY.md · CONTRIBUTING.md
```

## Roadmap / good first issues

- Web-RDP in the browser (Apache Guacamole) so no client app is needed
- Session countdown & auto-restart
- Light theme toggle
- Wallpaper auto-compression (fit 4 MB serverless limit)
- Multi-session manager

## Notes & limits (read before using heavily)

- GitHub Actions jobs are capped at **6 hours** per run; the panel shows the
  estimated expiry. Public repos get free minutes, private repos use the
  2,000 min/month free quota.
- Runners are ephemeral VM datacenter IPs — for Google/account logins use the
  **exit node** input in the panel with a device at your home IP.
- GitHub-hosted runners are meant for CI; treat this as a hobby/free tool.
  For production desktops, run `provision.ps1`/`provision-linux.sh` on your
  own VPS/PC — same result, full control.
- On public repos, Actions logs are public. Never print secrets in workflow
  output (the code already avoids it). See [SECURITY.md](SECURITY.md).

## Contributors

[![Contributors](https://contrib.rocks/image?repo=xykalnotkel/rdp-tailscale)](https://github.com/xykalnotkel/rdp-tailscale/graphs/contributors)

## License

[MIT](LICENSE) © xykalnotkel
