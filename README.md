# RDP gratis via GitHub Actions + Tailscale (Windows, tanpa API key)

Remote Desktop menggunakan runner **Windows Server** GitHub Actions, dihubungkan ke
jaringan Tailscale kamu **tanpa API key / OAuth client**. Cukup klik link login yang
muncul di log saat Actions berjalan.

> **Catatan OS**: GitHub Actions tidak menyediakan image "Windows 10". Runner
> `windows-latest` = **Windows Server 2022**. RDP native-nya sama persis, dan bisa
> diakses dari aplikasi Remote Desktop apa pun (Windows `mstsc`, Microsoft RD Client
> Android/iOS, Remmina di Linux, dsb).

## Cara pakai (sekali setup)

1. **Buat repo** (bisa private atau publik) dan taruh file workflow di
   `.github/workflows/rdp-tailscale.yml`.

2. **Push** ke GitHub.

3. Buka tab **Actions** → pilih workflow **"RDP via Tailscale (Windows, tanpa API key)"**
   → klik **Run workflow**.

4. Buka log run tersebut, cari step **"Login Tailscale (klik link di log)"**. Akan
   muncul link seperti:

   ```
   https://login.tailscale.com/a/xxxxxxxx
   ```

   **Klik link itu, login ke akun Tailscale kamu, lalu approve node-nya.**

5. Setelah approve, lihat step **"Tampilkan info koneksi RDP"** untuk IP, username,
   dan password.

6. Buka **Remote Desktop Connection** (`mstsc`) atau klien RDP lain, connect ke:
   ```
   IP-TAILSCALE:3389
   ```
   - Username: `runneradmin`
   - Password: (yang tampil di log)

## Catatan penting

- **Batas waktu**: job maksimal **6 jam** — ini batas mutlak runner GitHub-hosted
  (publik & private sama). Setelah itu runner mati otomatis.
- **Gratis?** Repo **publik** = menit Actions gratis unlimited (tapi tetap max 6 jam/job).
  Repo **private** (Free plan) = ~2000 menit/bulan gratis, sisanya bayar.
- **Link login kedaluwarsa** dalam beberapa menit — klik secepatnya. Kalau terlewat,
  re-run saja.
- **Node tersimpan permanen** di tailnet kamu (login interaktif). Hapus manual dari
  dashboard Tailscale kalau sudah tidak dipakai.
- **Password RDP**: otomatis random tiap run. Mau password tetap? Buat GitHub secret
  `RDP_PASSWORD`.
- **Tailscale SSH** ikut aktif (`--ssh`), jadi bisa `ssh runneradmin@IP` sebagai alternatif.

## Keamanan

- Semua data hanya lewat jaringan Tailscale (private mesh), tidak diekspos ke internet.
- Link login & password hanya terlihat di log run kamu sendiri.
