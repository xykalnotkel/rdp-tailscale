# Security Policy

## Reporting a vulnerability

Found a security issue? Please **do not** open a public issue for
vulnerabilities that expose credentials or allow unauthorized access.

Open a private report via
[GitHub Security Advisories](https://github.com/xykalnotkel/rdp-tailscale/security/advisories/new),
or email the maintainer privately. We aim to reply within 72 hours.

## Key rules of this project

1. **Never commit secrets.** GitHub tokens, Tailscale auth keys, panel keys,
   or passwords must only live in **GitHub Actions secrets** and **server
   environment variables** — never in code, logs, or state files.
2. **State files are encrypted.** `runtime/state.json` holds credentials in
   AES-256-CBC form (`PANEL_KEY` decrypts it). Anyone without `PANEL_KEY`
   cannot read it, but treat it as sensitive anyway — it is stored in the repo.
3. **Public repos expose Actions logs.** The RDP password and Tailscale
   details printed by the workflow are visible to anyone on public repos.
   Use a **private fork** if you want your sessions private, or keep secrets
   only as masked GitHub secrets (never echo them).
4. **If a token leaks** (e.g. it appears in a log, a commit, or a chat):
   revoke/rotate it immediately at the provider (GitHub, Tailscale, Vercel,
   Cloudflare), then update the secret or environment variable.
5. **No mining / no abuse.** This project is for interactive remote-desktop
   sessions. Do not use GitHub Actions runners for cryptocurrency mining or
   other prohibited workloads — it violates the GitHub Acceptable Use Policy
   and will get accounts flagged.

## Supported setup

The mainline is `main`. Fixes are expected to target the latest release of
the workflow + panel.
