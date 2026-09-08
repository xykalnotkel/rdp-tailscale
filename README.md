# Kall Desktop Control - RDP via GitHub Actions + Tailscale

Versi 2 dari repo `rdp-tailscale` kamu: **semua dikontrol dari web panel** -
tidak perlu lagi buka GitHub Actions untuk start/stop, lihat password, atau
ganti wallpaper.

---

## Fitur

| Fitur | Keterangan |
|---|---|
| Password otomatis | Acak 16 karakter tiap sesi, dikirim **terenkripsi** ke panel |
| Web panel interaktif | Start / Stop / status hidup-mati / kredensial / riwayat run / tombol unduh `.rdp` |
| Wallpaper custom | Upload gambar langsung dari panel (JPG/PNG/WebP, max 15 MB), jadi default sesi berikutnya |
| Wallpaper default | Gambar XyCloudStore (rental pc morphing) yang kamu minta |
| Nama PC | `Kall` (Windows + nama device Tailscale), bisa diganti per-sesi dari panel |
| Admin tertinggi | `runneradmin` di Administrators + Remote Desktop Users, UAC off, auto-login |
| Taskbar transparan | TranslucentTB (portable) + autostart |
| Lightshot | Terinstall + autostart (tombol `PrtSc`) |
| Chrome + Firefox | Install silent, first-run dimatikan, siap dipakai |
| "Semua driver" | Yang bisa dipasang di runner virtual: VC++ Redist x64/x86, DirectX End-User Runtime, WebView2. Catatan: runner GitHub adalah **Windows Server 2022 virtual tanpa GPU fisik** - driver kartu grafis tidak mungkin dipasang di lingkungan ini. |
| Optimasi | Power plan High Performance, sleep/hibernate/monitor mati, screensaver & sticky-keys off, SmartScreen off |
| Security longgar | UAC mati, auto-login tanpa PIN, NLA tetap aktif (dibutuhkan klien RDP modern) |
| Login Google | Tidak bisa 100% otomatis (verifikasi Google memang wajib), tapi: browser siap pakai + dukungan **exit node** supaya IP-mu tidak dianggap aneh. Login sekali, sesi tersimpan. |
| Custom domain | Panel sudah ter-deploy ke **https://kall-panel.vercel.app** (Vercel gratis, HTTPS otomatis). Tinggal arahkan subdomain Cloudflare kamu ke situ kalau mau domain sendiri. |

Struktur repo:

```
.github/workflows/rdp-tailscale.yml   # workflow v2
provision.ps1                         # provisioning lengkap di dalam VM
panel/server.js                       # backend panel (zero dependency)
panel/public/index.html               # frontend panel (single file)
panel/Dockerfile                      # deploy opsi Docker
runtime/                              # state.json terenkripsi (diisi runner)
README.md
```

---

## Cara pasang (sekali doang, ~10 menit)

### 1. Salin file ke repo kamu

Push semua file ini ke repo GitHub kamu (repo yang sama dengan workflow-nya).
Bisa repo publik maupun private.

### 2. Generate kunci panel

Kunci ini dipakai workflow untuk **mengenkripsi** IP + password sebelum
menyimpannya di repo, dan dipakai panel untuk **mendekripsi**:

```bash
openssl rand -hex 32
```

Simpan hasilnya (contoh: `9f3a...64 hex karakter`).

### 3. Set secrets di repo GitHub

Buka repo > Settings > Secrets and variables > Actions > New repository secret:

| Secret | Wajib? | Isi |
|---|---|---|
| `PANEL_KEY` | **Ya** | Hex 64 karakter dari langkah 2 |
| `RDP_PASSWORD` | Opsional | **Password desktop TETAP** - kalau diisi, password tidak berubah tiap sesi. Kalau kosong, dibuat acak 16 karakter tiap run. |
| `TS_AUTHKEY` | Opsional | Auth key Tailscale (buat di https://login.tailscale.com/admin/settings/keys). **Kalau diisi: login Tailscale otomatis.** Kalau auth key gagal/invalid, run otomatis fallback ke mode klik-link. Kosongkan = mode klik link seperti biasa. |

### 4. Jalankan panel

Panel = 1 file Node tanpa dependency. Pilih salah satu:

**a) Lokal (untuk coba-coba):**
```bash
cd panel
GITHUB_REPO=user/repo-kamu \
GITHUB_TOKEN=ghp_xxx \
PANEL_KEY=9f3a... \
node server.js
# buka http://localhost:3000
```

**b) Docker:**
```bash
docker build -t kall-panel panel
docker run -p 3000:3000 \
  -e GITHUB_REPO=user/repo-kamu \
  -e GITHUB_TOKEN=ghp_xxx \
  -e PANEL_KEY=9f3a... \
  kall-panel
```

**c) Render / Fly / Railway / VPS** - env vars yang sama, port `3000`.

Environment variables panel:

| Env | Keterangan |
|---|---|
| `GITHUB_REPO` | `user/repo` (wajib) |
| `GITHUB_TOKEN` | Token GitHub: classic PAT scope `repo` + `workflow`, atau fine-grained dengan izin **Actions: read/write** + **Contents: read/write**. Tanpa ini panel tetap bisa baca status (repo publik) tapi tidak bisa Start/Stop/upload. |
| `PANEL_KEY` | Hex 64 (sama dengan secret di repo) |
| `PANEL_ADMIN` | Opsional. PIN (teks bebas) untuk mengunci tombol Start/Stop/upload di panel |
| `PANEL_TS_AUTHKEY` | Opsional. Cermin secret `TS_AUTHKEY` - hanya untuk indikator "login otomatis" di UI panel |
| `PORT` | Default 3000 |
| `BRANCH` | Default `main` |

> Panel sudah live di **https://kall-panel.vercel.app** (Vercel, gratis).
> Kalau mau deploy sendiri: `panel/` berisi `api/[slug].js` khusus Vercel serverless.

> Jangan pernah commit token / PIN ke repo. Semua lewat environment / secret.

### 5. Akses via custom domain (tanpa IP)

Karena panel cuma butuh HTTPS biasa, kamu bebas pasang di belakang domain:

- Deploy panel di platform yang kasih URL (mis. Render: `https://kall.onrender.com`)
- Di Cloudflare / DNS kamu: buat `CNAME` dari subdomain (mis. `panel.domainmu.com`)
  ke host panel, aktifkan proxy, kasih SSL/TLS mode Full.
- Selesai - buka panel lewat domain, bukan IP.

Catatan: yang bisa dikasih domain itu **panel**-nya. Koneksi RDP tetap lewat
jaringan Tailscale (`IP:3389` atau `nama-pc.user.tailnet.ts.net:3389` - ini
malah lebih aman, tidak terbuka ke internet umum).

---

## Cara pakai sehari-hari

1. Buka panel (web).
2. Tekan **Mulai Desktop**. Opsional: isi exit node biar IP internetmu bersih.
3. Tunggu 3-6 menit sampai card berubah jadi **PC HIDUP**.
4. Panel otomatis menampilkan IP, username, password (klik Lihat), plus tombol
   **Unduh file .rdp** - tinggal klik, file terbuka di Remote Desktop.
5. Mau matiin lebih awal? Tekan **Stop PC**.
6. Mau ganti wallpaper? Upload di card Wallpaper - berlaku untuk sesi berikutnya.

Alur teknis status otomatis:

```
runner (Windows)                  repo GitHub                       panel
  ├─ provision.ps1 jalankan        runtime/state.json (AES-256)       ├─ GET /api/state  -> dekripsi -> status
  └─ enkripsi {ip,user,pass}  -->  ditulis via Contents API      <--- └─ POST /api/start -> workflow_dispatch
```

`state.json` di repo berisi **blob terenkripsi** saja - IP dan password tidak
pernah tampil sebagai teks di repo, dan tidak perlu buka log Actions lagi.

---

## Catatan penting

- **Batas waktu**: runner GitHub-hosted maksimal **6 jam** per job, lalu mati
  otomatis. Panel menampilkan perkiraan waktu berakhir.
- **Quota gratis**: repo publik = menit Actions gratis tanpa batas (tetap max
  6 jam/job). Repo private pakai kuota 2.000 menit/bulan di plan Free.
- **Sifat penggunaan**: remote desktop di runner GitHub-hosted adalah
  penggunaan non-standar infrastruktur CI yang bisa dihentikan GitHub kapan
  saja. Untuk kebutuhan kontinyu/garansi, deploy ke VPS/PC sendiri pakai
  provision.ps1 yang sama (jalan di Windows 10/11/Server).
- **Tailscale node tersimpan** di tailnet kamu. Hapus manual dari dashboard
  Tailscale kalau sudah tidak dipakai.
- **Login Tailscale**: tanpa `TS_AUTHKEY`, tiap sesi pertama harus klik link
  login di log Actions sekali. Dengan `TS_AUTHKEY` (ephemeral/reusable),
  semuanya otomatis.
- **Login Google**: Google mewajibkan verifikasi saat login dari IP baru.
  Tips paling efektif: pakai **exit node** (IP rumah kamu). Browser sudah
  disiapkan; setelah verifikasi sekali, sesi login tersimpan selama browser
  dipakai.
- **"Support all driver"**: yang realistis di runner ini adalah runtime
  (VC++, DirectX, WebView2) - sudah otomatis. Driver GPU fisik tidak tersedia
  karena VM tanpa GPU.

## Keamanan

- IP + password dikirim ke repo dalam keadaan **terenkripsi AES-256-CBC**;
  kunci (`PANEL_KEY`) hanya ada di: secret repo kamu + env server panel.
- Password acak baru dibuat tiap sesi (16 karakter, tanpa karakter ambigu).
- Aksi Start/Stop bisa dikunci PIN (`PANEL_ADMIN`).
- Kalau salah satu token di bawah pernah terlihat orang lain, **rotate
  sekarang juga** (GitHub > Settings > Developer settings > Tokens):
  hapus token lama, bikin baru, update env panel + secret repo.

## FAQ

**Kenapa panel bilang "Belum ada run yang melapor"?**
Run terakhir tidak mengirim state (mis. `PANEL_KEY` belum diset saat run
jalan, atau runner belum dapat IP Tailscale). Cek log Actions run terakhir.

**Start gagal dengan pesan 409?**
Masih ada run berjalan. Stop dulu lewat panel, atau tunggu sampai 6 jam
berakhir otomatis.

**Upload wallpaper gagal padahal repo publik?**
Panel butuh token dengan izin Contents:write untuk upload. Set `GITHUB_TOKEN`.

**Tema/transparansi belum kelihatan?**
Restart sesi RDP sekali (logoff-login), atau jalankan ulang TranslucentTB dari
system tray. Di sesi baru semua sudah aktif sejak awal.
