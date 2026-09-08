/*
 * Kall Desktop Control - core router
 * Dipakai oleh server.js (Node biasa) dan api/* Vercel serverless.
 * Zero dependency (Node 18+).
 *
 * Environment:
 *   GITHUB_REPO     contoh: xykalnotkel/rdp-tailscale   (WAJIB)
 *   GITHUB_TOKEN    token GitHub (classic PAT repo+workflow / fine-grained
 *                   Actions:write + Contents:write). Tanpa ini panel tetap
 *                   bisa baca status repo publik, tapi Start/Stop/upload mati.
 *   PANEL_KEY       hex 64 (32 byte) - kunci AES-256 state.json.
 *   PANEL_ADMIN     PIN opsional untuk aksi start/stop/upload.
 *   PANEL_TS_AUTHKEY  opsional - cermin secret TS_AUTHKEY cuma buat indikator UI.
 *   BRANCH          default 'main'
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = (process.env.GITHUB_REPO || '').trim().replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\/$/, '');
const TOKEN = (process.env.GITHUB_TOKEN || '').trim();
const PANEL_KEY = (process.env.PANEL_KEY || '').trim().toLowerCase();
const ADMIN_PIN = (process.env.PANEL_ADMIN || '').trim();
const PANEL_TS = (process.env.PANEL_TS_AUTHKEY || '').trim();
const BRANCH = (process.env.BRANCH || 'main').trim();

const GH_API = 'https://api.github.com';
const H = TOKEN
  ? { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'kall-panel', Accept: 'application/vnd.github+json' }
  : { 'User-Agent': 'kall-panel', Accept: 'application/vnd.github+json' };

// ---------------------------------------------------------------------------
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

async function gh(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) {
    const err = new Error((data && data.message) || `GitHub API ${r.status}`);
    err.status = r.status; err.data = data;
    throw err;
  }
  return data;
}

function decryptBlob(blob) {
  if (!PANEL_KEY) throw new Error('PANEL_KEY_NOT_SET');
  if (!blob || !blob.startsWith('v1.')) throw new Error('BAD_BLOB');
  const key = Buffer.from(PANEL_KEY, 'hex');
  if (key.length !== 32) throw new Error('PANEL_KEY harus 32 byte (64 hex)');
  const [ivB64, ctB64] = blob.slice(3).split('.');
  const iv = Buffer.from(ivB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const d = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const pt = Buffer.concat([d.update(ct), d.final()]);
  return JSON.parse(pt.toString('utf8'));
}

async function fetchRepoFile(p) {
  try {
    if (TOKEN) {
      const f = await gh(`${GH_API}/repos/${REPO}/contents/${p}?ref=${encodeURIComponent(BRANCH)}`);
      return Buffer.from(f.content, 'base64').toString('utf8');
    }
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${p}`, { headers: { 'User-Agent': 'kall-panel' } });
    if (!r.ok) throw new Error(`raw ${r.status}`);
    return await r.text();
  } catch { return null; }
}

async function putRepoFile(p, contentB64, msg) {
  if (!TOKEN) throw new Error('NO_TOKEN');
  let sha = null;
  try { sha = (await gh(`${GH_API}/repos/${REPO}/contents/${p}?ref=${encodeURIComponent(BRANCH)}`)).sha; } catch {}
  const body = { message: msg, content: contentB64, branch: BRANCH };
  if (sha) body.sha = sha;
  await gh(`${GH_API}/repos/${REPO}/contents/${p}`, { method: 'PUT', body: JSON.stringify(body) });
}

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('TOO_LARGE')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function magicOf(buf) {
  if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8) return '.jpg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return '.png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return '.webp';
  return null;
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------
async function handleState(req, res) {
  const raw = await fetchRepoFile('runtime/state.json');
  if (!raw) {
    return json(res, 200, { ok: true, running: false, info: REPO ? 'Belum ada run yang melapor. Jalankan workflow dari panel ini.' : 'GITHUB_REPO belum diset di server.' });
  }
  if (!PANEL_KEY) {
    return json(res, 200, { ok: false, running: false, error: 'PANEL_KEY_NOT_SET', info: 'PANEL_KEY belum diset - state tidak bisa didekripsi.' });
  }
  try {
    const st = decryptBlob(raw.trim());
    const exp = new Date(st.expiresAt).getTime();
    const active = Date.now() < exp;
    return json(res, 200, {
      ok: true, running: active,
      state: {
        ip: st.ip || '', dns: st.dns || '', user: st.user || 'runneradmin',
        pass: st.pass || '', machine: st.machine || '',
        provisionedAt: st.provisionedAt || null, expiresAt: st.expiresAt || null,
        remainingSeconds: Math.max(0, Math.floor((exp - Date.now()) / 1000)),
      },
    });
  } catch (e) {
    return json(res, 200, { ok: false, running: false, error: 'BAD_STATE', info: `State tidak bisa dibaca: ${e.message}` });
  }
}

async function handleRuns(req, res) {
  try {
    const r = await gh(`${GH_API}/repos/${REPO}/actions/runs?per_page=8`);
    const runs = (r.workflow_runs || []).map((x) => ({
      id: x.id, run_number: x.run_number, status: x.status, conclusion: x.conclusion,
      createdAt: x.created_at, updatedAt: x.updated_at, htmlUrl: x.html_url,
      displayTitle: x.display_title || x.name,
    }));
    return json(res, 200, { ok: true, runs });
  } catch (e) {
    return json(res, 200, { ok: false, runs: [], error: e.message });
  }
}

async function handleStart(req, res) {
  if (!TOKEN) return json(res, 400, { ok: false, error: 'GITHUB_TOKEN belum diset - tidak bisa start.' });
  if (ADMIN_PIN && (req.headers['x-admin-pin'] || '').trim() !== ADMIN_PIN) {
    return json(res, 401, { ok: false, error: 'PIN admin salah.' });
  }
  const body = await readBody(req, 100 * 1024);
  let input = {};
  try { input = JSON.parse(body.toString('utf8') || '{}'); } catch { return json(res, 400, { ok: false, error: 'body bukan JSON' }); }

  const inputs = {};
  inputs.OS = String(input.os || 'Windows').trim().startsWith('Linux') ? 'Linux (Ubuntu)' : 'Windows';
  inputs.PROVISION_MODE = String(input.provision || 'Cepat').trim() === 'Full' ? 'Full' : 'Cepat';
  inputs.PC_NAME = String(input.pcName || 'Kall').trim().slice(0, 15) || 'Kall';
  if (input.exitNode && String(input.exitNode).trim()) inputs.EXIT_NODE = String(input.exitNode).trim();
  if (input.wallpaperUrl && String(input.wallpaperUrl).trim()) inputs.WALLPAPER_URL = String(input.wallpaperUrl).trim();

  try {
    const r = await gh(`${GH_API}/repos/${REPO}/actions/runs?per_page=5&status=in_progress`);
    if ((r.workflow_runs || []).length > 0) {
      return json(res, 409, { ok: false, error: 'Masih ada run berjalan. Stop dulu lewat panel.' });
    }
  } catch {}

  try {
    await gh(`${GH_API}/repos/${REPO}/actions/workflows/rdp-tailscale.yml/dispatches`, {
      method: 'POST', body: JSON.stringify({ ref: BRANCH, inputs }),
    });
    return json(res, 200, { ok: true, message: 'Workflow dijalankan. VM siap sekitar 3-6 menit.' });
  } catch (e) {
    return json(res, 500, { ok: false, error: `Gagal trigger workflow: ${e.message}` });
  }
}

async function handleCancel(req, res) {
  if (!TOKEN) return json(res, 400, { ok: false, error: 'GITHUB_TOKEN belum diset - tidak bisa stop.' });
  if (ADMIN_PIN && (req.headers['x-admin-pin'] || '').trim() !== ADMIN_PIN) {
    return json(res, 401, { ok: false, error: 'PIN admin salah.' });
  }
  try {
    const r = await gh(`${GH_API}/repos/${REPO}/actions/runs?per_page=5&status=in_progress`);
    const runs = r.workflow_runs || [];
    if (!runs.length) return json(res, 200, { ok: true, message: 'Tidak ada run berjalan.' });
    for (const run of runs) {
      try { await gh(`${GH_API}/repos/${REPO}/actions/runs/${run.id}/cancel`, { method: 'POST' }); } catch {}
    }
    return json(res, 200, { ok: true, message: `Run ${runs.map((x) => '#' + x.run_number).join(', ')} di-stop.` });
  } catch (e) {
    return json(res, 200, { ok: false, error: `Gagal stop: ${e.message}` });
  }
}

async function handleWallpaperUpload(req, res) {
  if (!TOKEN) return json(res, 400, { ok: false, error: 'GITHUB_TOKEN belum diset - upload tidak bisa.' });
  if (ADMIN_PIN && (req.headers['x-admin-pin'] || '').trim() !== ADMIN_PIN) {
    return json(res, 401, { ok: false, error: 'PIN admin salah.' });
  }
  const buf = await readBody(req, 6 * 1024 * 1024);
  const ext = magicOf(buf);
  if (!ext) return json(res, 400, { ok: false, error: 'File harus gambar JPEG / PNG / WebP.' });
  const name = `wallpapers/${Date.now()}${ext}`;
  try {
    await putRepoFile(name, buf.toString('base64'), 'upload wallpaper via panel');
    const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${name}`;
    await putRepoFile('wallpapers/last.txt', Buffer.from(url).toString('base64'), 'set default wallpaper');
    return json(res, 200, { ok: true, url, name });
  } catch (e) {
    return json(res, 500, { ok: false, error: `Upload gagal: ${e.message}` });
  }
}

async function handleWallpaperCurrent(req, res) {
  const txt = await fetchRepoFile('wallpapers/last.txt');
  return json(res, 200, { ok: true, url: txt ? txt.trim() : null });
}

async function handleInfo(req, res) {
  return json(res, 200, {
    ok: true,
    config: {
      repo: REPO || null, branch: BRANCH,
      hasToken: !!TOKEN, hasPanelKey: !!PANEL_KEY,
      hasAdminPin: !!ADMIN_PIN, hasTsAuth: !!PANEL_TS,
    },
  });
}

// ---------------------------------------------------------------------------
// router utama (dipakai server.js & Vercel api/[slug].js)
// ---------------------------------------------------------------------------
const STATIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json'
};

function serveStatic(res, p) {
  let rel = decodeURIComponent(p);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.normalize(path.join(STATIC_DIR, rel));
  if (!full.startsWith(STATIC_DIR)) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
  try {
    const data = fs.readFileSync(full);
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    json(res, 404, { ok: false, error: 'not found' });
  }
}

async function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  try {
    if (req.method === 'GET' && !p.startsWith('/api/')) { serveStatic(res, p); return; }
    if (req.method === 'GET' && p === '/api/state') return handleState(req, res);
    if (req.method === 'GET' && p === '/api/runs') return handleRuns(req, res);
    if (req.method === 'GET' && p === '/api/info') return handleInfo(req, res);
    if (req.method === 'GET' && p === '/api/wallpaper') return handleWallpaperCurrent(req, res);
    if (req.method === 'POST' && p === '/api/start') return handleStart(req, res);
    if (req.method === 'POST' && p === '/api/cancel') return handleCancel(req, res);
    if (req.method === 'POST' && p === '/api/wallpaper') return handleWallpaperUpload(req, res);
    json(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    json(res, e.status || 500, { ok: false, error: e.message || 'internal error' });
  }
}

module.exports = { handler, REPO, BRANCH, TOKEN, PANEL_KEY };
