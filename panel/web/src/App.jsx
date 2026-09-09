import React, { useCallback, useEffect, useRef, useState } from 'react'

/* ============================================================
   KALL DESKTOP - kontrol panel (React)
   Log Sesi   : kejadian dari sisi panel (start/stop/up/down)
   Log Actions: log mentah GitHub Actions + daftar step
   ============================================================ */

let PIN = sessionStorage.getItem('kall_pin') || ''
const MAXLOG = 200

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

const fmtHM = (s) => (s <= 0 ? 'habis' : Math.floor(s / 3600) + 'j ' + Math.floor((s % 3600) / 60) + 'm')
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

/* ---------- ikon (stroke saja) ---------- */
const I = {
  monitor: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>,
  list: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4h16v13H4z" /><path d="M8 21h8M12 17v4" /></svg>,
  clock: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>,
  chart: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 17l6-6 4 4 6-8" /><path d="M14 7h6v6" /></svg>,
  image: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.6" /><path d="M21 15l-5-5-9 9" /></svg>,
  shield: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" /><path d="M9.5 12l1.8 1.8L15 10" /></svg>,
  power: <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>,
  down: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" /></svg>
}

/* ============================================================ App */
export default function App() {
  const [cfg, setCfg] = useState(null)
  const [st, setSt] = useState(null)
  const [runs, setRuns] = useState([])
  const [runsErr, setRunsErr] = useState(false)

  /* ----- log sesi ----- */
  const [logs, setLogs] = useState(() => loadLogs())
  const logsRef = useRef(logs)
  useEffect(() => { logsRef.current = logs }, [logs])
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  useEffect(() => { pausedRef.current = paused }, [paused])
  const logBoxRef = useRef(null)

  const logLine = useCallback((kind, msg) => {
    logsRef.current = [...logsRef.current.slice(-(MAXLOG - 1)), { t: nowStamp(), k: kind, m: msg }]
    if (!pausedRef.current) setLogs(logsRef.current)
  }, [])

  // simpan ke localStorage (throttle 2.5s biar hemat)
  useEffect(() => {
    const id = setTimeout(() => {
      try { localStorage.setItem('kall_logs', JSON.stringify(logsRef.current)) } catch { /* noop */ }
    }, 2500)
    return () => clearTimeout(id)
  }, [logs])

  useEffect(() => {
    const box = logBoxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [logs])
  useEffect(() => { logLine('info', 'panel dimuat - siap dikontrol') }, [logLine]) // eslint-disable-line

  /* ----- polling state + status akurat (state & run digabung, anti-basi) ----- */
  const cfgRef = useRef(cfg)
  useEffect(() => { cfgRef.current = cfg }, [cfg])
  const runsRef = useRef([])
  const phaseRef = useRef('wait')
  const [phase, setPhase] = useState('wait')
  useEffect(() => {
    let dead = false
    async function tick() {
      let d
      try { d = await api('/api/state') } catch { return }
      if (dead) return
      setSt(d)
      const live = !!(d && d.ok && d.running && d.state)
      const stObj = live || (d && d.ok && d.state) ? (d.state || {}) : null
      const starting = !!(stObj && stObj.starting)
      const runsArr = runsRef.current || []
      const inProg = runsArr.some((r) => r.status === 'in_progress' || r.status === 'queued' || r.status === 'waiting')
      const latest = runsArr[0]
      // state basi: state mengaku running tapi run terbaru sudah selesai/gagal/cancel SETELAH state dibuat
      let stale = false
      if (live && latest && !inProg && ['completed', 'cancelled', 'failure', 'timed_out', 'skipped'].includes(latest.status)) {
        if (new Date(latest.created_at).getTime() > new Date(stObj.provisionedAt || 0).getTime()) stale = true
      }
      let next = 'off'
      if (d && (d.error || !d.ok)) next = 'setup'
      else if (starting || (inProg && !live)) next = 'booting'
      else if (live && !stale) next = 'on'
      else next = 'off'

      const prev = phaseRef.current
      if (next !== prev) {
        if (next === 'on') logLine('up', 'PC HIDUP - sesi aktif (IP ' + ((stObj && stObj.ip) || '-') + ')')
        else if (next === 'booting') logLine('wait', 'BOOTING - runner menyala, tunggu laporan kredensial')
        else if (next === 'off' && prev === 'on') logLine('down', 'PC MATI - sesi berakhir / dibatalkan')
        else if (next === 'off' && prev === 'booting') logLine('down', 'BOOTING GAGAL - run berhenti sebelum melapor')
        else if (next === 'setup') logLine('down', 'panel butuh konfigurasi')
        phaseRef.current = next
        setPhase(next)
      } else if (next === 'on' && stObj) {
        // deteksi ganti sesi saat sama-sama hidup
        if (lastIpRef.current && lastIpRef.current !== stObj.ip) {
          logLine('up', 'sesi baru terdeteksi (IP ' + stObj.ip + ')')
        }
        lastIpRef.current = stObj.ip
      }
      if (!cfgRef.current) api('/api/info').then((i) => { if (!dead) setCfg(i) }).catch(() => {})
    }
    tick()
    const id = setInterval(tick, 10000)
    return () => { dead = true; clearInterval(id) }
  }, [logLine])
  const lastIpRef = useRef(null)

  /* ----- polling run + deteksi event baru ----- */
  const seenRunsRef = useRef(new Set())
  useEffect(() => {
    let dead = false
    async function tick() {
      try {
        const d = await api('/api/runs')
        if (dead) return
        if (d.ok && Array.isArray(d.runs)) {
          setRuns(d.runs); runsRef.current = d.runs; setRunsErr(false)
          d.runs.slice().reverse().forEach((r) => {
            if (seenRunsRef.current.has(r.id)) return
            seenRunsRef.current.add(r.id)
            if (r.status === 'in_progress' || r.status === 'queued' || r.status === 'waiting') logLine('wait', 'run #' + r.run_number + ' mulai - runner booting')
            else if (r.status === 'completed') logLine('info', 'run #' + r.run_number + ' selesai (' + (r.conclusion || '-') + ')')
            else if (r.status === 'cancelled') logLine('down', 'run #' + r.run_number + ' dibatalkan')
          })
        } else setRunsErr(true)
      } catch { /* next */ }
    }
    tick()
    const id = setInterval(tick, 20000)
    return () => { dead = true; clearInterval(id) }
  }, [logLine])

  /* ----- wallpaper aktif ----- */
  const [wall, setWall] = useState(null)
  useEffect(() => {
    api('/api/wallpaper').then((d) => { if (d && d.ok && d.url) setWall(d.url) }).catch(() => {})
  }, [])

  const [selRun, setSelRun] = useState(null)
  // status tunggu selama belum ada data apa pun
  const status = !st && phase === 'wait' ? 'wait' : phase

  return (
    <>
      <div className="bg" />
      <div className="wrap">
        <Header cfg={cfg} />
        <div className="grid">
          <section>
            <Hero status={status} st={st} logLine={logLine} cfg={cfg} />
            <Card title="Log Sesi" icon={I.list} subtitle="kejadian dari sisi panel - mulai / berhenti / status">
              <SessionLog logs={logs} paused={paused} setPaused={setPaused}
                clear={() => { logsRef.current = []; setLogs([]) }}
                copy={() => copyText(logs.map((l) => l.t + '  ' + l.k.toUpperCase() + '  ' + l.m).join('\n'))}
                logBoxRef={logBoxRef} />
            </Card>
            <ActionsLogCard selRun={selRun} />
            <Card title="Riwayat Run" icon={I.clock}>
              <RunsList runs={runs} runsErr={runsErr} onLog={setSelRun} />
            </Card>
          </section>
          <section>
            <Card title="Konfigurasi Sesi" icon={I.chart}>
              <Config cfg={cfg} logLine={logLine} />
            </Card>
            <Card title="Wallpaper" icon={I.image}>
              <Wallpaper wall={wall} setWall={setWall} logLine={logLine} />
            </Card>
            <Card title="Status Panel" icon={I.shield}>
              <Info cfg={cfg} st={st} />
            </Card>
          </section>
        </div>
        <div className="footer">KALL DESKTOP - GitHub Actions + Tailscale - sesi maks 6 jam</div>
      </div>
    </>
  )
}

/* ============================================================ komponen */
function Card({ title, icon, subtitle, children }) {
  return (
    <div className="card">
      <h2>{icon}<span>{title}</span></h2>
      {subtitle && <div className="subtitle">{subtitle}</div>}
      {children}
    </div>
  )
}

function Header({ cfg }) {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const id = setInterval(() => { fetch('/api/info').then((r) => setOnline(r.ok)).catch(() => setOnline(false)) }, 20000)
    return () => clearInterval(id)
  }, [])
  const repo = cfg && cfg.config ? cfg.config.repo : null
  const cls = !online ? 'dot bad' : repo ? 'dot ok' : 'dot warn'
  const txt = !online ? 'offline' : repo ? repo : 'menghubungkan...'
  return (
    <header>
      <div className="brand">
        <div className="logo">{I.monitor}</div>
        <div>
          <h1>KALL<span>DESKTOP</span></h1>
          <p>Remote Control</p>
        </div>
      </div>
      <div className="chip"><span className={cls} /><span className="mono">{txt}</span></div>
    </header>
  )
}

/* ---------------- hero ---------------- */
function Hero({ status, st, logLine, cfg }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [showPass, setShowPass] = useState(false)
  const pinNeeded = !!(cfg && cfg.config && cfg.config.hasAdminPin)
  const labels = { on: 'PC HIDUP', off: 'PC MATI', wait: 'MENGHUBUNGI...', booting: 'BOOTING...', setup: 'SETUP' }
  const subs = {
    on: st && st.state ? 'sisa ' + fmtHM(st.state.remainingSeconds) : '',
    off: 'tidak ada sesi berjalan', wait: 'menunggu respons server',
    booting: 'runner GitHub menyala - tunggu 3-6 menit', setup: 'panel butuh konfigurasi'
  }

  const askPin = () => {
    if (!pinNeeded) return true
    const v = prompt('PIN admin:')
    if (!v) return false
    PIN = v; sessionStorage.setItem('kall_pin', v); return true
  }

  const launch = async (src) => {
    if (!askPin()) return
    setBusy(src); setErr(null)
    try {
      const body = {
        pcName: (document.getElementById('pcName') || {}).value || 'Kall',
        exitNode: (document.getElementById('exitNode') || {}).value || '',
        os: (document.getElementById('osSel') || {}).value || 'Windows',
        provision: (document.getElementById('modeSel') || {}).value || 'Cepat',
        wallpaperUrl: ''
      }
      try { const w = await api('/api/wallpaper'); if (w.ok && w.url) body.wallpaperUrl = w.url } catch { /* noop */ }
      await api('/api/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      logLine('info', 'MULAI dikirim (' + body.os + ' / ' + body.provision + ')')
      logLine('wait', 'runner booting 3-6 menit - pantau Log Actions')
      setErr({ t: 'Workflow dijalankan. PC siap ~4-5 menit.', ok: true })
    } catch (e) {
      logLine('down', 'MULAI gagal: ' + e.message)
      setErr({ t: e.message, ok: false })
    } finally { setBusy(null) }
  }
  const stop = async () => {
    if (!confirm('Stop PC sekarang? Semua sesi desktop ditutup.')) return
    if (!askPin()) return
    setBusy('stop'); setErr(null)
    try {
      const d = await api('/api/cancel', { method: 'POST' })
      logLine('down', 'STOP dikirim' + (d && d.message ? ' (' + d.message + ')' : ''))
      setErr({ t: (d && d.message) || 'Dimatikan.', ok: true })
    } catch (e) {
      logLine('down', 'STOP gagal: ' + e.message)
      setErr({ t: e.message, ok: false })
    } finally { setBusy(null) }
  }
  const dlRdp = () => {
    const s = st && st.state
    if (!s) return
    const rdp = ['full address:s:' + (s.ip || ''), 'username:s:' + (s.user || 'runneradmin'), 'prompt for credentials:i:1',
      'authentication level:i:2', 'screen mode id:i:2', 'desktopwidth:i:1600', 'desktopheight:i:900',
      'redirectclipboard:i:1', 'drivestoredirect:s:*', 'networkautodetect:i:1'].join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([rdp], { type: 'application/octet-stream' }))
    a.download = 'Kall.rdp'; a.click()
  }

  const s = st && st.state
  return (
    <div className={'card hero ' + status}>
      <div className="state-top"><span className="pulse" /><b>{labels[status]}</b><span>{subs[status]}</span></div>
      {status === 'setup' && (
        <div className="note warn" style={{ marginTop: 8 }}>{(st && st.info) || 'cek env server panel'}</div>
      )}
      {status === 'booting' && (
        <>
          <div className="big">PC SEDANG BOOTING</div>
          <div className="sub">Runner GitHub sedang menyala - kredensial akan muncul otomatis begitu sesi siap (3-6 menit). Pantau Log Actions untuk progres step.</div>
        </>
      )}
      {status === 'off' && (
        <>
          <div className="big">PC MATI</div>
          <div className="sub">Tekan Mulai untuk menyalakan PC remote. Booting 3-6 menit.</div>
        </>
      )}
      {status === 'wait' && (
        <>
          <div className="big">MENGHUBUNGI...</div>
          <div className="sub">polling status tiap 10 detik.</div>
        </>
      )}
      {status === 'on' && s && (
        <>
          <div className="big">{s.machine || 'KALL'} — HIDUP</div>
          <div className="sub">Remote Desktop siap. Hubungkan ke alamat di bawah (port 3389).</div>
          <KRow label="Alamat" v={s.ip || '-'} />
          <KRow label="Hostname" v={s.dns || '-'} />
          <KRow label="User" v={s.user || 'runneradmin'} />
          <KRow label="Password" v={showPass ? (s.pass || '-') : '••••••••••••••••'}
            extra={<button className="btn ghost mini" onClick={() => setShowPass(!showPass)}>{showPass ? 'Sembunyi' : 'Lihat'}</button>} />
          <div className="rowbtns">
            <button className="btn primary" onClick={dlRdp}>{I.down} File .rdp</button>
            <button className="btn" onClick={() => copyText('IP: ' + s.ip + '\nUser: ' + s.user + '\nPass: ' + s.pass).then(() => setErr({ t: 'Info koneksi disalin.', ok: true }))}>Salin info</button>
            <button className="btn danger" disabled={busy === 'stop'} onClick={stop}>{busy === 'stop' ? <span className="spin" /> : null} Stop PC</button>
          </div>
          {s.expiresAt && <div className="hint">sesi berakhir otomatis ±{new Date(s.expiresAt).toLocaleTimeString('id-ID', { hour12: false })}</div>}
        </>
      )}
      {(status === 'off' || status === 'wait') && !(st && st.error) && (
        <div className="rowbtns">
          <button className="btn primary" disabled={busy === 'start'} onClick={() => launch('start')}>
            {busy === 'start' ? <span className="spin" /> : I.power} {busy === 'start' ? ' Menyalakan...' : ' Mulai Desktop'}
          </button>
        </div>
      )}
      {err && <div className={'errbox show' + (err.ok ? ' okbox' : '')}>{err.t}</div>}
    </div>
  )
}

function KRow({ label, v, extra }) {
  return (
    <div className="krow"><span className="lbl">{label}</span><code>{v}</code>{extra}
      <button className="btn ghost mini" onClick={() => copyText(v)}>salin</button>
    </div>
  )
}

/* ---------------- Log Sesi ---------------- */
function SessionLog({ logs, paused, setPaused, clear, copy, logBoxRef }) {
  return (
    <>
      <div className="loghead">
        <button className="btn mini" onClick={() => setPaused(!paused)}>{paused ? 'Lanjut' : 'Jeda'}</button>
        <button className="btn mini" onClick={clear}>Hapus</button>
        <button className="btn mini" onClick={copy}>Salin</button>
        <span className="cnt">{logs.length} baris</span>
      </div>
      <div className="logbox" ref={logBoxRef}>
        {logs.length === 0 && <span className="logempty">Belum ada event...</span>}
        {logs.map((l, i) => {
          const lb = { up: 'PC HIDUP', down: 'PC MATI', wait: 'BOOTING', info: 'INFO', ev: 'EVENT' }[l.k] || 'INFO'
          const cl = { up: 'lup', down: 'ldown', wait: 'lwait', info: 'linfo', ev: 'lev' }[l.k] || 'linfo'
          return (
            <div className="logline" key={i}>
              <span className="lt">{l.t}</span>{'  '}
              <span className={'lv ' + cl}>{lb}</span>{'  '}
              <span>{l.m}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}

/* ---------------- Log Actions ---------------- */
function ActionsLogCard({ selRun }) {
  const [act, setAct] = useState(null)
  const [err, setErr] = useState('')
  const [tick, setTick] = useState(0)
  const boxRef = useRef(null)

  useEffect(() => {
    let dead = false
    async function load() {
      try {
        const q = selRun ? '?run=' + selRun : ''
        const d = await api('/api/logs' + q)
        if (dead) return
        setAct(d); setErr('')
      } catch (e) { if (!dead) setErr(e.message) }
    }
    load()
    const id = setInterval(load, 12000)
    return () => { dead = true; clearInterval(id) }
  }, [selRun, tick])

  useEffect(() => {
    const box = boxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [act && act.tail])

  const run = act && act.run
  const stCls = (s) => {
    if (s.status === 'in_progress') return 'run'
    if (s.status === 'completed') return s.conclusion === 'success' ? 'ok' : 'bad'
    return 'skip'
  }
  const stTxt = (s) => {
    if (s.status === 'completed') return s.conclusion === 'success' ? '✓' : '✗'
    if (s.status === 'in_progress') return '▶'
    return '–'
  }

  return (
    <Card title="Log Actions" icon={I.clock} subtitle="log mentah runner GitHub Actions - step &amp; output">
      <div className="loghead">
        <button className="btn mini" onClick={() => setTick(tick + 1)}>Muat ulang</button>
        {selRun && <button className="btn mini" onClick={() => window.dispatchEvent(new CustomEvent('kall:log-run', { detail: null }))}>Run terbaru</button>}
        {run && <span className="cnt mono">run #{run.number} · {run.status}{run.conclusion ? ' · ' + run.conclusion : ''}</span>}
      </div>
      {err && <div className="note bad" style={{ marginBottom: 8 }}>Log Actions butuh GITHUB_TOKEN di server panel ({err})</div>}
      {act && act.steps && act.steps.length > 0 && (
        <div className="asteps">
          {act.steps.map((s, i) => (
            <span key={i} className={'astep ' + stCls(s)} title={s.name}>
              {stTxt(s)} {s.name.length > 34 ? s.name.slice(0, 34) + '…' : s.name}
            </span>
          ))}
        </div>
      )}
      <div className="logbox tall" ref={boxRef}>
        {!act && <span className="logempty">memuat log...</span>}
        {act && !act.tail && !err && <span className="logempty">(belum ada output)</span>}
        {act && act.tail && (
          <div className="logact-tail">{formatTail(act.tail)}</div>
        )}
      </div>
    </Card>
  )
}

/* warnai marker penting di log actions (grup/error/warning) dengan pendekatan teks */
function formatTail(tail) {
  const lines = tail.split('\n')
  return lines.map((ln, i) => {
    let cls = ''
    let txt = ln
    if (/^##\[group\]/.test(ln)) { cls = 'ghb'; txt = ln.replace(/^##\[group\]/, '') }
    else if (/^##\[error\]/.test(ln)) { cls = 'gh'; txt = '! ' + ln.replace(/^##\[error\]/, '') }
    else if (/^##\[warning\]/.test(ln)) { cls = 'gh'; txt = '? ' + ln.replace(/^##\[warning\]/, '') }
    else if (/^##\[endgroup\]/.test(ln)) { cls = 'gh'; txt = '— end —' }
    return <div key={i} className={cls}>{txt || '\u00A0'}</div>
  })
}

/* ---------------- Riwayat Run ---------------- */
function RunsList({ runs, runsErr, onLog }) {
  return (
    <ul className="ulist" id="logActionsCard">
      {runsErr && <li className="dim">butuh GITHUB_TOKEN di server panel untuk riwayat</li>}
      {!runsErr && runs.length === 0 && <li className="dim">Belum ada run.</li>}
      {!runsErr && runs.slice(0, 7).map((r) => (
        <li key={r.id}>
          <span className={pillCls(r)}>{pillTxt(r)}</span>
          <span className="t mono">#{r.run_number} · {shortWhen(r.created_at)}</span>
          <button className="act" onClick={() => { onLog(r.run_number); const el = document.getElementById('logActionsCard'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>log</button>
        </li>
      ))}
    </ul>
  )
}

function pillCls(r) {
  const m = { completed: 'pill ok', cancelled: 'pill bad', in_progress: 'pill run', queued: 'pill run', waiting: 'pill run' }
  return m[r.status] || 'pill gray'
}
function pillTxt(r) {
  if (r.status === 'completed') return r.conclusion === 'success' ? 'ok' : r.conclusion || 'selesai'
  if (r.status === 'in_progress' || r.status === 'queued' || r.status === 'waiting') return 'jalan'
  if (r.status === 'cancelled') return 'stop'
  return r.status
}

/* ---------------- Konfigurasi ---------------- */
function Config({ cfg, logLine }) {
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [pin, setPin] = useState(PIN)
  const pinNeeded = !!(cfg && cfg.config && cfg.config.hasAdminPin)

  const askPin = () => {
    if (!pinNeeded) return true
    if (!pin) { setMsg({ t: 'Masukkan PIN admin.', ok: false }); return false }
    PIN = pin; sessionStorage.setItem('kall_pin', pin); return true
  }
  const start = async () => {
    if (!askPin()) return
    setBusy('s'); setMsg(null)
    try {
      const body = {
        pcName: (document.getElementById('pcName') || {}).value || 'Kall',
        exitNode: (document.getElementById('exitNode') || {}).value || '',
        os: (document.getElementById('osSel') || {}).value || 'Windows',
        provision: (document.getElementById('modeSel') || {}).value || 'Cepat',
        wallpaperUrl: ''
      }
      try { const w = await api('/api/wallpaper'); if (w.ok && w.url) body.wallpaperUrl = w.url } catch { /* noop */ }
      await api('/api/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      logLine('info', 'MULAI (' + body.os + ' / ' + body.provision + ')')
      logLine('wait', 'menunggu runner booting')
      setMsg({ t: 'Dijalankan. PC siap ~4-5 menit.', ok: true })
    } catch (e) {
      logLine('down', 'MULAI gagal: ' + e.message)
      setMsg({ t: e.message, ok: false })
    } finally { setBusy(null) }
  }
  const stop = async () => {
    if (!confirm('Stop PC?')) return
    if (!askPin()) return
    setBusy('t'); setMsg(null)
    try {
      const d = await api('/api/cancel', { method: 'POST' })
      logLine('down', 'STOP (' + ((d && d.message) || 'ok') + ')')
      setMsg({ t: (d && d.message) || 'Dimatikan.', ok: true })
    } catch (e) { setMsg({ t: e.message, ok: false }) } finally { setBusy(null) }
  }
  return (
    <>
      {pinNeeded && <label className="lab">PIN ADMIN</label>}
      {pinNeeded && <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN admin" />}
      <label className="lab">Nama PC</label>
      <input type="text" id="pcName" defaultValue="Kall" />
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <div style={{ flex: 1 }}>
          <label className="lab">Sistem Operasi</label>
          <select id="osSel" className="sel" defaultValue="Windows">
            <option value="Windows">Windows Server</option>
            <option value="Linux (Ubuntu)">Linux Ubuntu</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="lab">Mode</label>
          <select id="modeSel" className="sel" defaultValue="Cepat">
            <option value="Cepat">Cepat</option>
            <option value="Full">Full</option>
          </select>
        </div>
      </div>
      <details>
        <summary>Opsi lanjutan</summary>
        <label className="lab">Exit Node Tailscale</label>
        <input type="text" id="exitNode" placeholder="100.x.x.x / nama device" />
        <div className="hint">
          IP internet akan terlihat sebagai IP perangkat ini (bantu login Google / akun lain).
          Penting: di dashboard Tailscale, device ini WAJIB sudah di-enable <b>"Use as exit node"</b>
          (menu &hellip; pada device). Kalau belum, sesi tetap jalan tapi tanpa exit node.
        </div>
      </details>
      <div className="rowbtns">
        <button className="btn primary" disabled={busy} onClick={start}>{busy === 's' ? <span className="spin" /> : I.power} Mulai</button>
        <button className="btn danger" disabled={busy} onClick={stop}>Stop</button>
      </div>
      {msg && <div className={'errbox show' + (msg.ok ? ' okbox' : '')}>{msg.t}</div>}
      <div className="note" style={{ marginTop: 12 }}>Password desktop <b>tetap</b> (secret RDP_PASSWORD).</div>
    </>
  )
}

/* ---------------- Wallpaper ---------------- */
function Wallpaper({ wall, setWall, logLine }) {
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const ref = useRef(null)
  const up = async (file) => {
    if (!file) return
    if (file.size > 4 * 1024 * 1024) { setMsg({ t: 'Maks 4 MB.', ok: false }); return }
    setBusy(true); setMsg(null)
    try {
      const d = await api('/api/wallpaper', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file })
      setWall(d.url + '?t=' + Date.now()); logLine('info', 'wallpaper baru diupload'); setMsg({ t: 'Berhasil - dipakai sesi berikutnya.', ok: true })
    } catch (e) { setMsg({ t: 'Gagal: ' + e.message, ok: false }) } finally { setBusy(false) }
  }
  return (
    <>
      <div className="hint">JPG/PNG/WebP max 4 MB. Efek sesi berikutnya.</div>
      <div className={'drop' + (drag ? ' over' : '')} onClick={() => ref.current && ref.current.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); up(e.dataTransfer.files && e.dataTransfer.files[0]) }}>
        <b>Upload / tarik gambar</b>
      </div>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
        onChange={(e) => up(e.target.files && e.target.files[0])} />
      {wall && <div className="thumb"><img src={wall} alt="wallpaper" /></div>}
      {busy && <div className="hint">mengupload...</div>}
      {msg && <div className={'errbox show' + (msg.ok ? ' okbox' : '')}>{msg.t}</div>}
    </>
  )
}

/* ---------------- Info panel ---------------- */
function Info({ cfg, st }) {
  const c = cfg && cfg.config
  const row = (l, v, ok) => <div className="cfgrow">{l}<b className={ok ? 'yes' : 'no'}>{v}</b></div>
  return (
    <>
      {row('REPO', (c && c.repo) || '—', !!(c && c.repo))}
      {row('TOKEN', c && c.hasToken ? 'OK' : '—', !!(c && c.hasToken))}
      {row('PANEL KEY', c && c.hasPanelKey ? 'OK' : '—', !!(c && c.hasPanelKey))}
      {row('LOG ACTIONS', c && c.hasToken ? 'aktif' : 'mati (butuh token)', !!(c && c.hasToken))}
      {st && st.state && <div className="hint">session dilaporkan {new Date(st.state.provisionedAt).toLocaleString('id-ID')}</div>}
    </>
  )
}

/* ============================================================ helpers */
function loadLogs() {
  try {
    const raw = localStorage.getItem('kall_logs')
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.slice(-MAXLOG) : []
  } catch { return [] }
}
