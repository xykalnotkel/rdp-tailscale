# RDP gratis via GitHub Actions + Tailscale (tanpa API key)

Remote Desktop gratis menggunakan runner GitHub Actions, dihubungkan ke jaringan
Tailscale kamu **tanpa API key / OAuth client**. Cukup klik link login yang muncul
di log saat Actions berjalan.

## Cara pakai (sekali setup)

1. **Buat repo** (bisa private) dan taruh file workflow di
   `.github/workflows/rdp-tailscale.yml`.

2. **Push** ke GitHub.

3. Buka tab **Actions** → pilih workflow **"RDP via Tailscale (tanpa API key)"** →
   klik **Run workflow**.

4. Buka log run tersebut, cari step **"🔗 Login Tailscale"**. Akan muncul link
   seperti:

   ```
   https://login.tailscale.com/a/xxxxxxxx
   ```

   **Klik link itu, login ke akun Tailscale kamu, lalu approve node-nya.**
   (Kalau admin console kamu mengaktifkan *device approval*, node baru perlu
   di-approve dulu di dashboard Tailscale.)

5. Setelah approve, lanjut ke step **"Tampilkan info koneksi RDP"** untuk melihat
   IP Tailscale, username, dan password.

6. Buka aplikasi **Remote Desktop Connection** (Windows) atau klien RDP lain,
   lalu connect ke `IP-TAILSCALE:3389` dengan:
   - Username: `rdpuser`
   - Password: (yang tampil di log)

## Catatan penting

- **Batas waktu**: job berjalan maksimal **6 jam** (repo publik) atau **72 jam**
  (repo private). Sesuaikan nilai `timeout-minutes` kalau perlu.
- **Node tetap tersimpan**: karena login interaktif, node akan tersimpan di
  tailnet kamu. Hapus manual dari dashboard Tailscale kalau sudah tidak dipakai.
- **Link login kedaluwarsa** dalam beberapa menit — klik secepatnya. Kalau
  terlewat, tinggal re-run workflow.
- **Password RDP**: otomatis dibuat random tiap run. Kalau mau password tetap,
  buat GitHub secret bernama `RDP_PASSWORD`, dan workflow akan memakainya.
- **Tailscale SSH** ikut aktif (`--ssh`), jadi kamu juga bisa `ssh rdpuser@IP`
  sebagai alternatif.

## Keamanan

- Semua data hanya lewat jaringan Tailscale (private mesh), tidak diekspos ke
  internet publik.
- Link login dan password hanya terlihat di log run kamu sendiri.
