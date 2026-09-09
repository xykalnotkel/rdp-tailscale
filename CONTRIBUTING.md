# Contributing to Kall Desktop

Awesome — you want to help build this! Every contributor brings their own
GitHub/Tailscale keys, so there is **zero shared infrastructure** to set up:
fork it, plug in *your* keys, and you are a fully independent dev instance.

## Ground rules

- **Your keys, your instance.** Never use, ask for, or commit another
  person's token/auth key. Everything is designed to run with your own
  secrets + environment variables.
- **No secrets in code.** If a PR would print or store a secret, it will be
  rejected. Use `${{ secrets.* }}` in workflows and `process.env.*` in the
  panel.
- **Keep it free-tier friendly.** Defaults must work on GitHub public repos
  and free hosting tiers.
- **English or Indonesian** in code/commits is fine; keep README/UI strings
  clear.

## Quick start: run your own instance (fork flow)

1. **Fork** the repo: click the *Fork* button (top-right on GitHub), or use
   the API:
   ```bash
   curl -X POST https://api.github.com/repos/xykalnotkel/rdp-tailscale/forks \
     -H "Authorization: Bearer <YOUR_GITHUB_TOKEN>"
   ```
2. **Clone your fork**:
   ```bash
   git clone https://github.com/<YOUR_USERNAME>/rdp-tailscale.git
   cd rdp-tailscale
   git remote add upstream https://github.com/xykalnotkel/rdp-tailscale.git
   ```
3. **Add repository secrets** (Settings → Secrets and variables → Actions)
   on **your fork**:

   | Secret | Needed | What it does |
   |---|---|---|
   | `PANEL_KEY` | yes | `openssl rand -hex 32` — encrypt/decrypt session state |
   | `RDP_PASSWORD` | optional | fixed desktop password (empty = random each session) |
   | `TS_AUTHKEY` | optional | your **Reusable** Tailscale auth key → automatic login |

4. **Run the panel locally** with your own env:
   ```bash
   cd panel
   npm install            # install web deps first
   npm run build --prefix web   # build React -> public/
   GITHUB_REPO=<YOU>/rdp-tailscale \
   GITHUB_TOKEN=<YOUR_GITHUB_TOKEN> \
   PANEL_KEY=<YOUR_PANEL_KEY> \
   node server.js         # open http://localhost:3000
   ```
5. **Start a session** from the panel (or Actions → Run workflow):
   choose OS (Windows / Linux Ubuntu) + mode (Cepat/Full), then wait ~4-5
   minutes. Approve the new device in your Tailscale dashboard if device
   approval is on.

## Project layout

```
.github/workflows/rdp-tailscale.yml   # CI: dispatches a Windows/Linux VM
provision.ps1                         # Windows provisioning (Cepat/Full)
provision-linux.sh                    # Linux Ubuntu provisioning (xrdp+XFCE)
panel/
  core.js             # backend API (works in Node & Vercel serverless)
  server.js           # local Node server
  api/[slug].js       # Vercel serverless entry
  public/             # built React app (generated — don't edit by hand)
  web/                # React + Vite source  (npm run build here)
runtime/state.json    # encrypted session state, written by the workflow
```

## Panel API (for frontend contributors)

| Endpoint | Method | Description |
|---|---|---|
| `/api/state` | GET | decrypted live session (IP/user/pass/expiry) |
| `/api/runs` | GET | recent workflow runs |
| `/api/logs?run=<n>` | GET | GitHub Actions steps + raw log tail |
| `/api/wallpaper` | GET | current default wallpaper URL |
| `/api/wallpaper` | POST | upload new wallpaper (JPG/PNG/WebP, ≤4 MB) |
| `/api/start` | POST | dispatch workflow (OS, mode, PC name, exit node, wallpaper) |
| `/api/cancel` | POST | cancel running workflow |

## Development loop

```bash
cd panel/web
npm run dev        # Vite dev server with HMR (proxy /api to your server)
```
Build before commit so the preview stays usable:
```bash
npm run build      # outputs to ../public
```

## Opening a pull request

1. Create a branch: `git checkout -b feat/my-idea`
2. Make changes, build the web app, test against **your** instance.
3. Commit with a clear message, push, and open the PR against `main`.
4. In the PR description, note what you tested and include a screenshot
   if the change touches UI.
5. Small, focused PRs review fastest. Ideas for first PRs:
   - macOS runner? (GitHub has no macOS RDP — maybe WebRDP via Guacamole)
   - session auto-renew / countdown notifications
   - dark/light theme toggle
   - multi-session management
   - better upload compression to fit the 4 MB serverless limit

Thanks for contributing!
