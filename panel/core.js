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


// enkripsi payload -> blob v1.iv.ct (AES-256-CBC)
function encryptPayload(obj) {
  if (!PANEL_KEY) throw new Error('PANEL_KEY_NOT_SET');
  const key = Buffer.from(PANEL_KEY, 'hex');
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return 'v1.' + iv.toString('base64') + '.' + ct.toString('base64');
}

// tulis state ke repo (dipakai untuk kosongkan state saat start/cancel)
async function writeState(obj) {
  if (!PANEL_KEY || !TOKEN) return;
  const blob = encryptPayload(obj);
  await putRepoFile('runtime/state.json', Buffer.from(blob).toString('base64'), 'update state (panel)');
}
async function clearState({ starting = false } = {}) {
  const past = new Date(Date.now() - 1000);
  await writeState({
    v: 1, ip: '', dns: '', user: '', pass: '', machine: '',
    starting, provisionedAt: new Date().toISOString(), expiresAt: past.toISOString(),
  });
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
        starting: !!st.starting,
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
    // kosongkan state lama biar panel tidak nampilkan sesi basi
    try { await clearState({ starting: true }) } catch (e) { /* non-fatal */ }
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
    const r = await gh(`${GH_API}/repos/${REPO}/actions/runs?per_page=10&status=in_progress`);
    const runs = r.workflow_runs || [];
    if (!runs.length) {
      try { await clearState({ starting: false }) } catch { /* non-fatal */ }
      return json(res, 200, { ok: true, message: 'Tidak ada run berjalan.' });
    }
    const failed = [];
    for (const run of runs) {
      let doneRun = false;
      for (let attempt = 1; attempt <= 3 && !doneRun; attempt++) {
        try {
          await gh(`${GH_API}/repos/${REPO}/actions/runs/${run.id}/cancel`, { method: 'POST' });
          doneRun = true;
        } catch (e) {
          if (attempt === 3) failed.push('#' + run.run_number + ': ' + (e.message || 'gagal'));
          else await new Promise((rr) => setTimeout(rr, 4000 * attempt));
        }
      }
    }
    if (failed.length === runs.length) {
      return json(res, 200, { ok: false, error: 'Stop GAGAL: ' + failed.join('; ') });
    }
    // bersihkan state biar panel tidak nampilkan sesi basi
    try { await clearState({ starting: false }) } catch (e) { /* non-fatal */ }
    const stopped = runs.filter((x) => !failed.some((fn) => fn.startsWith('#' + x.run_number + ':'))).map((x) => '#' + x.run_number);
    const msg = 'Stop dikirim untuk run ' + stopped.join(', ') + ' - VM mati total dalam 1-2 menit.' + (failed.length ? ' | GAGAL: ' + failed.join('; ') : '');
    return json(res, 200, { ok: true, message: msg });
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


// ---------------------------------------------------------------------------
// Konfigurasi default panel (disimpan di repo: config/panel.json)
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = { pcName: 'Kall', os: 'Windows', provision: 'Cepat', exitNode: 'xykel' };

async function handleConfigGet(req, res) {
  let cfg = null;
  const raw = await fetchRepoFile('config/panel.json');
  if (raw) { try { cfg = JSON.parse(raw); } catch {} }
  return json(res, 200, { ok: true, config: Object.assign({}, DEFAULT_CONFIG, cfg || {}) });
}

async function handleConfigSet(req, res) {
  if (!TOKEN) return json(res, 400, { ok: false, error: 'GITHUB_TOKEN belum diset - tidak bisa simpan.' });
  if (ADMIN_PIN && (req.headers['x-admin-pin'] || '').trim() !== ADMIN_PIN) {
    return json(res, 401, { ok: false, error: 'PIN admin salah.' });
  }
  const body = await readBody(req, 32 * 1024);
  let input = {};
  try { input = JSON.parse(body.toString('utf8') || '{}'); } catch { return json(res, 400, { ok: false, error: 'body bukan JSON' }); }
  const cur = { pcName: 'Kall', os: 'Windows', provision: 'Cepat', exitNode: '' };
  try {
    const raw = await fetchRepoFile('config/panel.json');
    if (raw) Object.assign(cur, JSON.parse(raw));
  } catch {}
  const merged = {
    pcName: String(input.pcName || cur.pcName || 'Kall').trim().slice(0, 15) || 'Kall',
    os: String(input.os || cur.os || 'Windows').startsWith('Linux') ? 'Linux (Ubuntu)' : 'Windows',
    provision: String(input.provision || cur.provision || 'Cepat') === 'Full' ? 'Full' : 'Cepat',
    exitNode: String(input.exitNode !== undefined ? input.exitNode : (cur.exitNode || '')).trim().slice(0, 60),
  };
  await putRepoFile('config/panel.json', Buffer.from(JSON.stringify(merged, null, 2)).toString('base64'), 'simpan default panel');
  return json(res, 200, { ok: true, config: merged, message: 'Default tersimpan.' });
}

// ---------------------------------------------------------------------------
// Log Actions: ambil step + log mentah dari GitHub Actions (run terbaru)
// ?run=<nomor|id> untuk run tertentu
// ---------------------------------------------------------------------------
async function handleLogs(req, res) {
  try {
    const u = new URL(req.url, 'http://x');
    const want = (u.searchParams.get('run') || '').trim();
    if (!REPO) return json(res, 200, { ok: false, error: 'GITHUB_REPO belum diset.', run: null, steps: [], tail: '' });

    const rr = await gh(`${GH_API}/repos/${REPO}/actions/runs?per_page=6`);
    const runs = rr.workflow_runs || [];
    let target = null;
    if (want) target = runs.find((x) => String(x.run_number) === want || String(x.id) === want);
    if (!target) target = runs[0];
    if (!target) return json(res, 200, { ok: true, run: null, steps: [], tail: 'Belum ada run.' });

    const jr = await gh(`${GH_API}/repos/${REPO}/actions/runs/${target.id}/jobs`);
    const job = (jr.jobs || [])[0];
    let steps = [];
    let tail = '';
    if (job) {
      steps = (job.steps || []).map((s) => ({
        name: s.name || 'step', status: s.status || 'unknown', conclusion: s.conclusion || null,
      }));
      try {
        const r = await fetch(`${GH_API}/repos/${REPO}/actions/jobs/${job.id}/logs`, {
          headers: { ...H, Accept: 'application/vnd.github+json' },
        });
        if (r.ok) {
          const txt = await r.text();
          const lines = txt.split(/\r?\n/).filter(Boolean);
          const last = lines.slice(-400).map((l) =>
            l.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z\s*/, ''));
          tail = last.join('\n');
        } else {
          tail = '(log belum dirilis GitHub untuk run yang masih jalan - beberapa step harus selesai dulu)';
        }
      } catch (e) {
        tail = '(gagal membaca log: ' + e.message + ')';
      }
    }
    return json(res, 200, {
      ok: true,
      run: { id: target.id, number: target.run_number, status: target.status, conclusion: target.conclusion || null },
      steps, tail,
    });
  } catch (e) {
    return json(res, 200, { ok: false, error: e.message, run: null, steps: [], tail: '' });
  }
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
// SSE - push state realtime (works on Node; Vercel memutus koneksi tiap
// beberapa puluh detik tapi EventSource reconnect otomatis)
// ---------------------------------------------------------------------------
async function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  let closed = false;
  req.on('close', () => { closed = true; });
  const timer = setInterval(async () => {
    if (closed) { clearInterval(timer); return; }
    try {
      const raw = await fetchRepoFile('runtime/state.json');
      let out = { ok: true, running: false, state: null, ts: Date.now() };
      if (!raw) out.info = REPO ? 'Belum ada run yang melapor.' : 'GITHUB_REPO belum diset.';
      else if (!PANEL_KEY) { out.ok = false; out.error = 'PANEL_KEY_NOT_SET'; out.info = 'PANEL_KEY belum diset.'; }
      else {
        try {
          const st = decryptBlob(raw.trim());
          const exp = new Date(st.expiresAt).getTime();
          out.running = Date.now() < exp;
          out.state = {
            ip: st.ip || '', dns: st.dns || '', user: st.user || 'runneradmin',
            pass: st.pass || '', machine: st.machine || '', starting: !!st.starting,
            provisionedAt: st.provisionedAt || null, expiresAt: st.expiresAt || null,
            remainingSeconds: Math.max(0, Math.floor((exp - Date.now()) / 1000)),
          };
        } catch (e) { out.ok = false; out.error = 'BAD_STATE'; out.info = String(e.message); }
      }
      res.write('data: ' + JSON.stringify(out) + '\n\n');
    } catch (e) { /* keep alive */ }
  }, 4000);
  // heartbeat
  const hb = setInterval(() => { if (closed) { clearInterval(hb); return; } res.write(': ping\n\n'); }, 25000);
  res.on('close', () => { closed = true; clearInterval(timer); clearInterval(hb); });
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
    if (req.method === 'GET' && p === '/api/logs') return handleLogs(req, res);
    if (req.method === 'GET' && p === '/api/events') return handleEvents(req, res);
    if (req.method === 'GET' && p === '/api/config') return handleConfigGet(req, res);
    if (req.method === 'POST' && p === '/api/config') return handleConfigSet(req, res);
    if (req.method === 'POST' && p === '/api/start') return handleStart(req, res);
    if (req.method === 'POST' && p === '/api/cancel') return handleCancel(req, res);
    if (req.method === 'POST' && p === '/api/wallpaper') return handleWallpaperUpload(req, res);
    json(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    json(res, e.status || 500, { ok: false, error: e.message || 'internal error' });
  }
}

module.exports = { handler, REPO, BRANCH, TOKEN, PANEL_KEY };
