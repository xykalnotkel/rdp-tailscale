import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/* ================= util API ================= */
let PIN = sessionStorage.getItem('kall_pin') || ''

async function api(path, opts = {}) {
  const o = { ...opts, headers: { ...(opts.headers || {}) } }
  if (PIN) o.headers['X-Admin-Pin'] = PIN
  const r = await fetch(path, o)
  let d = null
  try { d = await r.json() } catch { /* noop */ }
  if (!r.ok && d && d.error) throw new Error(d.error)
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return d
}

const fmtHM = (s) => (s <= 0 ? 'habis' : Math.floor(s / 3600) + ' jam ' + Math.floor((s % 3600) / 60) + ' menit')
const nowStamp = () => {
  const d = new Date()
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':')
}
const shortWhen = (iso) => (iso || '').slice(0, 16).replace('T', ' ')

async function copyText(t) {
  try { await navigator.clipboard.writeText(t) } catch {
    const ta = document.createElement('textarea')
    ta.value = t; document.body.appendChild(ta); ta.select()
    document.execCommand('copy'); ta.remove()
  }
}

/* ================= ikon ================= */
const I = {
  monitor: <svg key="m" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="12" rx="2.4" /><path d="M8 20h8M12 16v4" /></svg>,
  list: <svg key="l" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4h16v13H4z" /><path d="M8 21h8M12 17v4" /></svg>,
  clock: <svg key="c" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>,
  chart: <svg key="g" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 17l6-6 4 4 6-8" /><path d="M14 7h6v6" /></svg>,
  image: <svg key="i" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.4" /><circle cx="8.5" cy="8.5" r="1.6" /><path d="M21 15l-5-5-9 9" /></svg>,
  shield: <svg key="s" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" /><path d="M9.5 12l1.8 1.8L15 10" /></svg>,
  power: <svg key="p" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>,
  down: <svg key="d" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" /></svg>
}


/* payload standar dari form (dibaca saat submit) */
function getLaunchConfig() {
  return {
    pcName: document.getElementById('pcName') ? document.getElementById('pcName').value || 'Kall' : 'Kall',
    exitNode: document.getElementById('exitNode') ? document.getElementById('exitNode').value || '' : '',
    os: document.getElementById('osSelect') ? document.getElementById('osSelect').value : 'Windows',
    provision: document.getElementById('modeSelect') ? document.getElementById('modeSelect').value : 'Cepat',
    wallpaperUrl: ''
  }
}

/* ================= App ================= */
export default function App() {
  const [cfg, setCfg] = useState(null)
  const [st, setSt] = useState(null)
  const [runs, setRuns] = useState([])
  const [runsErr, setRunsErr] = useState(false)
  const [wall, setWall] = useState(null)

  const cfgRef = useRef(cfg)
  useEffect(() => { cfgRef.current = cfg }, [cfg])

  const [logs, setLogs] = useState(() => loadLogs())
  const logsRef = useRef(logs)
  useEffect(() => { logsRef.current = logs }, [logs])
  const [logPaused, setLogPaused] = useState(false)
  const pausedRef = useRef(false)
  useEffect(() => { pausedRef.current = logPaused }, [logPaused])
  const logBoxRef = useRef(null)

  const logLine = useCallback((kind, msg) => {
    logsRef.current = [...logsRef.current.slice(-249), { t: nowStamp(), k: kind, m: msg }]
    try { localStorage.setItem('kall_logs', JSON.stringify(logsRef.current)) } catch { /* noop */ }
    if (!pausedRef.current) setLogs(logsRef.current)
  }, [])

  useEffect(() => {
    logLine('info', 'panel dimuat - siap dikontrol')
    const box = logBoxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [logLine, logs])

  /* ---------- polling status + info ---------- */
  const prevRunRef = useRef(null)
  useEffect(() => {
    let dead = false
    async function tick() {
      let d
      try { d = await api('/api/state') } catch { return }
      if (dead) return
      setSt(d)
      const isRunning = !!(d && d.ok && d.running && d.state)
      const wasRunning = !!(prevRunRef.current && prevRunRef.current.ok)
      if (isRunning && !wasRunning) logLine('up', 'PC HIDUP - sesi aktif (IP ' + (d.state.ip || '-') + ')')
      if (!isRunning && wasRunning) logLine('down', 'PC MATI - sesi berakhir')
      if (isRunning && d.state) {
        const p = prevRunRef.current
        if (p && p.state && (p.state.ip !== d.state.ip || p.state.pass !== d.state.pass)) {
          logLine('up', 'kredensial sesi baru diterima (IP ' + d.state.ip + ')')
        }
        prevRunRef.current = { ok: true, state: { ip: d.state.ip, pass: d.state.pass } }
      } else {
        prevRunRef.current = null
      }
      if (!cfgRef.current) {
        api('/api/info').then((i) => { if (!dead) setCfg(i) }).catch(() => {})
      }
    }
    tick()
    const id = setInterval(tick, 10000)
    return () => { dead = true; clearInterval(id) }
  }, [logLine])

  /* ---------- polling riwayat run ---------- */
  const seenRunsRef = useRef(new Set())
  useEffect(() => {
    let dead = false
    async function tick() {
      try {
        const d = await api('/api/runs')
        if (dead) return
        if (d.ok && Array.isArray(d.runs)) {
          setRuns(d.runs)
          setRunsErr(false)
          d.runs.slice().reverse().forEach((r) => {
            if (seenRunsRef.current.has(r.id)) return
            seenRunsRef.current.add(r.id)
            if (r.status === 'in_progress' || r.status === 'queued' || r.status === 'waiting') {
              logLine('wait', 'run #' + r.run_number + ' mulai - runner booting (3-6 menit)')
            } else if (r.status === 'completed') {
              logLine('info', 'run #' + r.run_number + ' selesai (' + (r.conclusion || '-') + ')')
            } else if (r.status === 'cancelled') {
              logLine('down', 'run #' + r.run_number + ' dibatalkan')
            }
          })
        } else {
          setRunsErr(true)
        }
      } catch { /* poll berikutnya */ }
    }
    tick()
    const id = setInterval(tick, 20000)
    return () => { dead = true; clearInterval(id) }
  }, [logLine])

  /* ---------- wallpaper aktif ---------- */
  useEffect(() => {
    api('/api/wallpaper').then((d) => { if (d && d.ok && d.url) setWall(d.url) }).catch(() => {})
  }, [])

  const status = !st ? 'wait'
    : (st.error || !st.ok) ? 'setup'
      : (st.running && st.state) ? 'on' : 'off'

  return (
    <>
      <div className="bg" />
      <div className="blob b1" /><div className="blob b2" /><div className="blob b3" />
      <div className="wrap">
        <Header cfg={cfg} />
        <div className="grid">
          <section>
            <StatusHero status={status} st={st} logLine={logLine} />
            <Card title="Log Sesi" icon={I.list}>
              <LogPanel logs={logs} logPaused={logPaused} setLogPaused={setLogPaused}
                clearAll={() => { logsRef.current = []; setLogs([]) }}
                copyAll={() => copyText(logs.map((l) => l.t + ' ' + l.k.toUpperCase() + ' ' + l.m).join('\n'))}
                logBoxRef={logBoxRef} />
            </Card>
            <Card title="Riwayat Run" icon={I.clock}>
              <ul className="ulist">
                {runsErr && <li className="dim">Token panel belum aktif untuk riwayat run (repo publik butuh login).</li>}
                {!runsErr && runs.length === 0 && <li className="dim">Belum ada run.</li>}
                {!runsErr && runs.slice(0, 6).map((r) => (
                  <li key={r.id}>
                    <span className={pillCls(r)}>{pillTxt(r)}</span>
                    <span className="t">{r.display_title || 'RDP run'}</span>
                    <span className="mono dim small">#{r.run_number} {shortWhen(r.created_at)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
          <section>
            <Card title="Konfigurasi Sesi" icon={I.chart}>
              <ConfigPanel cfg={cfg} logLine={logLine} />
            </Card>
            <Card title="Wallpaper Custom" icon={I.image}>
              <WallpaperPanel wall={wall} setWall={setWall} logLine={logLine} />
            </Card>
            <Card title="Status Panel" icon={I.shield}>
              <InfoPanel cfg={cfg} st={st} />
            </Card>
          </section>
        </div>
        <div className="footer">
          KALL DESKTOP - RDP via GitHub Actions + Tailscale
          <br />Sesi otomatis berakhir setelah 6 jam. Semua kontrol dari panel ini - tanpa buka GitHub Actions.
        </div>
      </div>
    </>
  )
}

/* ================= komponen ================= */
function Card({ title, icon, children }) {
  return (
    <div className="card">
      <h2>{icon}<span>{title}</span></h2>
      {children}
    </div>
  )
}

function Header({ cfg }) {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const id = setInterval(() => {
      fetch('/api/info').then((r) => setOnline(r.ok)).catch(() => setOnline(false))
    }, 15000)
    return () => clearInterval(id)
  }, [])
  const repo = cfg && cfg.config ? cfg.config.repo : null
  const dotCls = !online ? 'dot bad' : repo ? 'dot ok' : 'dot warn'
  const txt = !online ? 'server panel tidak terjangkau' : repo ? repo + ' - panel online' : 'menghubungkan...'
  return (
    <header>
      <div className="brand">
        <div className="logo">{I.monitor}</div>
        <div>
          <h1>KALL DESKTOP</h1>
          <p>Remote Control Suite</p>
        </div>
      </div>
      <div className="chip"><span className={dotCls} /><span>{txt}</span></div>
    </header>
  )
}

function StatusHero({ status, st, logLine }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [passShown, setPassShown] = useState(false)
  const cfg = null
  void cfg
  const pinNeeded = false
  void pinNeeded

  const labels = { on: 'PC HIDUP', off: 'PC OFF', wait: 'MENGHUBUNGI...', setup: 'SETUP' }
  const subs = {
    on: st && st.state ? 'Sesi berjalan - ' + fmtHM(st.state.remainingSeconds) + ' tersisa' : '',
    off: 'Tidak ada sesi berjalan', wait: 'Menunggu respons server', setup: 'panel butuh konfigurasi'
  }

  const doStart = async () => {
    setBusy('start'); setErr(null)
    try {
      const launch = getLaunchConfig()
      try { const w = await api('/api/wallpaper'); if (w.ok && w.url) launch.wallpaperUrl = w.url } catch { /* noop */ }
      await api('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(launch)
      })
      logLine('info', 'perintah MULAI dikirim ke GitHub Actions')
      logLine('wait', 'menunggu runner booting (3-6 menit) ...')
      setErr({ t: 'Workflow dijalankan. VM siap sekitar 3-6 menit.', ok: true })
    } catch (e) {
      logLine('down', 'MULAI gagal: ' + e.message)
      setErr({ t: e.message, ok: false })
    } finally { setBusy(null) }
  }

  const doStop = async () => {
    if (!confirm('Yakin mau stop PC sekarang? Semua sesi desktop akan ditutup.')) return
    setBusy('stop'); setErr(null)
    try {
      const d = await api('/api/cancel', { method: 'POST' })
      logLine('down', 'perintah STOP dikirim' + (d && d.message ? ' (' + d.message + ')' : ''))
      setErr({ t: (d && d.message) || 'Dimatikan.', ok: true })
    } catch (e) {
      logLine('down', 'STOP gagal: ' + e.message)
      setErr({ t: e.message, ok: false })
    } finally { setBusy(null) }
  }

  const copyConn = async () => {
    if (!st || !st.state) return
    await copyText('Alamat: ' + st.state.ip + '\nUser: ' + st.state.user + '\nPass: ' + st.state.pass)
    setErr({ t: 'Info koneksi disalin ke clipboard.', ok: true })
  }

  const dlRdp = () => {
    if (!st || !st.state) return
    const ip = st.state.ip || ''
    const user = st.state.user || 'runneradmin'
    const rdp = [
      'full address:s:' + ip, 'username:s:' + user, 'prompt for credentials:i:1',
      'authentication level:i:2', 'screen mode id:i:2', 'use multimon:i:0',
      'desktopwidth:i:1600', 'desktopheight:i:900', 'audiomode:i:0',
      'redirectclipboard:i:1', 'redirectprinters:i:0', 'redirectsmartcards:i:1',
      'drivestoredirect:s:*', 'networkautodetect:i:1', 'bandwidthautodetect:i:1'
    ].join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([rdp], { type: 'application/octet-stream' }))
    a.download = 'Kall.rdp'
    a.click()
  }

  const s = st && st.state ? st.state : null
  return (
    <div className={'card hero ' + status}>
      <div className="state-top">
        <span className="pulse" /><b>{labels[status]}</b><span>{subs[status]}</span>
      </div>

      {status === 'setup' && (
        <>
          <div className="big grad">Perlu setup</div>
          <div className="note warn" style={{ marginTop: 10 }}>{(st && (st.info || '')) || 'cek env server panel'}</div>
        </>
      )}

      {status === 'off' && (
        <>
          <div className="big grad">Desktop belum nyala</div>
          <div className="sub">Tekan Mulai Desktop untuk menyalakan sesi remote. Proses booting 3-6 menit.</div>
        </>
      )}

      {status === 'wait' && (
        <>
          <div className="big grad">Menghubungi server...</div>
          <div className="sub">Polling status berjalan otomatis tiap 10 detik.</div>
        </>
      )}

      {status === 'on' && s && (
        <>
          <div className="big grad">{s.machine || 'Kall'}</div>
          <div className="sub">Sesi aktif. Hubungkan lewat Remote Desktop (mstsc / RD Client) ke alamat di bawah.</div>
          <KRow label="Alamat" val={s.ip || '-'} copy={s.ip || '-'} />
          <KRow label="Hostname" val={s.dns || '-'} copy={s.dns || '-'} />
          <KRow label="Username" val={s.user || 'runneradmin'} copy={s.user || 'runneradmin'} />
          <KRow label="Password" val={passShown ? (s.pass || '-') : '••••••••••••••••'} copy={s.pass || '-'}
            extra={<button className="btn ghost" onClick={() => setPassShown(!passShown)}>{passShown ? 'Sembunyi' : 'Lihat'}</button>} />
          <div className="rowbtns">
            <button className="btn primary" onClick={dlRdp}>{I.down} Unduh file .rdp</button>
            <button className="btn" onClick={copyConn}>Salin info koneksi</button>
            <button className="btn danger" disabled={busy === 'stop'} onClick={doStop}>
              {busy === 'stop' && <span className="spin" />} Stop PC
            </button>
          </div>
          {s.expiresAt && (
            <div className="hint">Sesi otomatis berakhir sekitar {new Date(s.expiresAt).toLocaleTimeString('id-ID', { hour12: false })} (max 6 jam).</div>
          )}
        </>
      )}

      {(status === 'off' || status === 'wait') && !(st && st.error) && (
        <div className="rowbtns">
          <button className="btn primary" disabled={busy === 'start'} onClick={doStart}>
            {busy === 'start' ? <span className="spin" /> : I.power}
            {busy === 'start' ? ' Menyalakan...' : ' Mulai Desktop'}
          </button>
        </div>
      )}
      {err && <div className={'errbox' + (err.ok ? ' okbox' : '')} style={{ display: 'block' }}>{err.t}</div>}
    </div>
  )
}

function KRow({ label, val, copy, extra }) {
  return (
    <div className="krow">
      <span className="lbl">{label}</span>
      <code>{val}</code>
      {extra}
      <button className="btn ghost" onClick={() => copyText(copy)}>Salin</button>
    </div>
  )
}

function LogPanel({ logs, logPaused, setLogPaused, clearAll, copyAll, logBoxRef }) {
  const cls = { up: 'lup', down: 'ldown', wait: 'lwait', info: 'linfo', ev: 'lev' }
  return (
    <>
      <div className="loghead">
        <button className="btn ghost mini" onClick={() => setLogPaused(!logPaused)}>{logPaused ? 'Lanjut' : 'Jeda'}</button>
        <button className="btn ghost mini" onClick={clearAll}>Bersihkan</button>
        <button className="btn ghost mini" onClick={copyAll}>Salin</button>
        <span className="cnt">{logs.length} entri</span>
      </div>
      <div className="logbox" ref={logBoxRef}>
        {logs.length === 0 && <span className="logempty">Menunggu event pertama...</span>}
        {logs.map((l, i) => (
          <div className="logline" key={i}>
            <span className="lt">{l.t}</span>{' '}
            <span className={'lv ' + (cls[l.k] || 'linfo')}>{l.k.toUpperCase()}</span>{' '}
            <span>{l.m}</span>
          </div>
        ))}
      </div>
    </>
  )
}

function ConfigPanel({ cfg, logLine }) {
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const pinNeeded = !!(cfg && cfg.config && cfg.config.hasAdminPin)
  const [pin, setPin] = useState(PIN)

  const askPin = () => {
    if (!pinNeeded) return true
    if (!pin) { setMsg({ t: 'Masukkan PIN admin dulu.', ok: false }); return false }
    PIN = pin
    sessionStorage.setItem('kall_pin', pin)
    return true
  }

  const doStart = async () => {
    if (!askPin()) return
    setBusy('start'); setMsg(null)
    try {
      const launch = getLaunchConfig()
      try { const w = await api('/api/wallpaper'); if (w.ok && w.url) launch.wallpaperUrl = w.url } catch { /* noop */ }
      await api('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(launch)
      })
      logLine('info', 'perintah MULAI dikirim lewat kartu konfigurasi')
      logLine('wait', 'menunggu runner booting (3-6 menit) ...')
      setMsg({ t: 'Workflow dijalankan. VM siap sekitar 3-6 menit.', ok: true })
    } catch (e) {
      logLine('down', 'MULAI gagal: ' + e.message)
      setMsg({ t: e.message, ok: false })
    } finally { setBusy(null) }
  }

  const doStop = async () => {
    if (!askPin()) return
    if (!confirm('Yakin mau stop PC sekarang?')) return
    setBusy('stop'); setMsg(null)
    try {
      const d = await api('/api/cancel', { method: 'POST' })
      logLine('down', 'perintah STOP dikirim (' + ((d && d.message) || 'ok') + ')')
      setMsg({ t: (d && d.message) || 'Dimatikan.', ok: true })
    } catch (e) {
      logLine('down', 'STOP gagal: ' + e.message)
      setMsg({ t: e.message, ok: false })
    } finally { setBusy(null) }
  }

  return (
    <>
      {pinNeeded && <label className="lab">PIN ADMIN PANEL</label>}
      {pinNeeded && (
        <input type="password" placeholder="Masukkan PIN admin" autoComplete="off" value={pin}
          onChange={(e) => setPin(e.target.value)} />
      )}
      <label className="lab">NAMA PC (WINDOWS + TAILSCALE)</label>
      <input type="text" id="pcName" defaultValue="Kall" placeholder="Kall" />
      <details>
        <summary>Opsi lanjutan</summary>
        <label className="lab">EXIT NODE TAILSCALE (OPSIONAL)</label>
        <input type="text" id="exitNode" placeholder="contoh: 100.99.1.2 atau nama device" />
        <div className="hint">
          Isi IP perangkat Tailscale kamu (HP/PC rumah yang aktif exit node). Efeknya: IP yang dilihat website = IP rumah
          kamu, bukan IP datacenter. Krusial biar <b>login Google tidak kena verifikasi berulang</b>.
        </div>
      </details>
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <div style={{ flex: 1 }}>
          <label className="lab">SISTEM OPERASI VM</label>
          <select id="osSelect" className="sel" defaultValue="Windows">
            <option value="Windows">Windows (Server 2022)</option>
            <option value="Linux (Ubuntu)">Linux Ubuntu (XFCE)</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="lab">PROVISIONING</label>
          <select id="modeSelect" className="sel" defaultValue="Cepat">
            <option value="Cepat">Cepat (tanpa aplikasi)</option>
            <option value="Full">Full (browser &amp; tools)</option>
          </select>
        </div>
      </div>
      <div className="rowbtns">
        <button className="btn primary" disabled={busy !== null} onClick={doStart}>
          {busy === 'start' ? <span className="spin" /> : I.power}
          {busy === 'start' ? ' Menyalakan...' : ' Mulai'}
        </button>
        <button className="btn danger" disabled={busy !== null} onClick={doStop}>Stop</button>
      </div>
      {msg && <div className={'errbox' + (msg.ok ? ' okbox' : '')} style={{ display: 'block' }}>{msg.t}</div>}
      <div className="note" style={{ marginTop: 13 }}>
        <b>Password desktop: TETAP</b> - tidak ganti-ganti tiap sesi (dikunci lewat secret <span className="mono">RDP_PASSWORD</span>).
      </div>
    </>
  )
}

function WallpaperPanel({ wall, setWall, logLine }) {
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const fileRef = useRef(null)

  const upload = async (file) => {
    if (!file) return
    if (file.size > 4 * 1024 * 1024) { setMsg({ t: 'Ukuran maks 4 MB (batas serverless Vercel).', ok: false }); return }
    setBusy(true); setMsg(null)
    try {
      const d = await api('/api/wallpaper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file
      })
      setWall(d.url + '?t=' + Date.now())
      logLine('info', 'wallpaper baru diupload ke repo')
      setMsg({ t: 'Berhasil. Wallpaper ini dipakai otomatis di sesi berikutnya.', ok: true })
    } catch (e) {
      logLine('down', 'upload wallpaper gagal: ' + e.message)
      setMsg({ t: 'Gagal: ' + e.message, ok: false })
    } finally { setBusy(false) }
  }

  return (
    <>
      <div className="hint">Upload gambar kamu - otomatis dipakai sebagai wallpaper sesi berikutnya. Maks 4 MB (JPG/PNG/WebP).</div>
      <div className={'drop' + (drag ? ' over' : '')}
        onClick={() => fileRef.current && fileRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files && e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]) }}>
        <b>Pilih / tarik gambar</b> ke sini
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files && e.target.files[0]) upload(e.target.files[0]) }} />
      {wall && <div className="thumb"><img src={wall} alt="wallpaper aktif" /></div>}
      {busy && <div className="hint">Mengupload ke repo...</div>}
      {msg && <div className={'errbox' + (msg.ok ? ' okbox' : '')} style={{ display: 'block' }}>{msg.t}</div>}
    </>
  )
}

function InfoPanel({ cfg, st }) {
  const c = cfg && cfg.config
  const row = (label, val, ok) => (
    <div className="cfgrow">{label}<b className={ok ? 'yes' : 'no'}>{val}</b></div>
  )
  return (
    <>
      {row('Repo GitHub', (c && c.repo) || 'belum diset', !!(c && c.repo))}
      {row('Token kontrol', c && c.hasToken ? 'terpasang' : 'tidak', !!(c && c.hasToken))}
      {row('Kunci panel', c && c.hasPanelKey ? 'terpasang' : 'tidak', !!(c && c.hasPanelKey))}
      {row('Login Tailscale', c && c.hasTsAuth ? 'otomatis' : 'klik link di log', !!(c && c.hasTsAuth))}
      <div className="note" style={{ marginTop: 13 }}>
        Panel berjalan di <b>hosting gratis (Vercel)</b> dan bisa diakses lewat <b>domain sendiri</b> - bukan IP.
        Koneksi RDP tetap lewat jaringan Tailscale (<span className="mono">IP:3389</span> atau hostname
        <span className="mono"> kall.&lt;tailnet&gt;.ts.net</span>).
      </div>
      {st && st.state && (
        <div className="note ok" style={{ marginTop: 10 }}>
          Sesi dilaporkan {new Date(st.state.provisionedAt).toLocaleString('id-ID')}
        </div>
      )}
    </>
  )
}

/* ================= helper ================= */
function loadLogs() {
  try {
    const raw = localStorage.getItem('kall_logs')
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.slice(-250) : []
  } catch { return [] }
}

function pillCls(r) {
  const map = { completed: 'pill ok', cancelled: 'pill bad', in_progress: 'pill run', queued: 'pill run', waiting: 'pill run' }
  return map[r.status] || 'pill gray'
}
function pillTxt(r) {
  if (r.status === 'completed') return 'selesai' + (r.conclusion && r.conclusion !== 'success' ? ' (' + r.conclusion + ')' : '')
  if (r.status === 'in_progress' || r.status === 'queued' || r.status === 'waiting') return 'berjalan'
  if (r.status === 'cancelled') return 'dibatalkan'
  return r.status
}
