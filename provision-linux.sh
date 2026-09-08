#!/usr/bin/env bash
# ============================================================================
#  provision-linux.sh - provisioning Ubuntu runner (desktop + xrdp)
#  PROVISION_MODE = Cepat : xrdp + XFCE saja (nyala cepat)
#                   Full  : + Firefox
#  User remote: runner (password sudah di-set step sebelumnya)
# ============================================================================
set -e
MODE="${PROVISION_MODE:-Cepat}"
PC_NAME="${PC_NAME:-Kall}"
export DEBIAN_FRONTEND=noninteractive

echo "[+] Update apt"
sudo apt-get update -qq >/dev/null 2>&1 || true

echo "[+] Install xrdp + XFCE desktop"
sudo apt-get install -y -qq xrdp xfce4 xfce4-terminal dbus-x11 tzdata ca-certificates curl 2>&1 | tail -1

# sesi default XFCE untuk xrdp
echo "[+] Set sesi XFCE untuk xrdp"
sudo -u runner bash -c 'echo "xfce4-session" > ~/.xsession && chmod +x ~/.xsession'
sudo sed -i 's|^test .*xrdp-sesman.*|unset DBUS_SESSION_BUS_ADDRESS\nunset XDG_RUNTIME_DIR\ntest -x /etc/X11/Xsession \&\& exec /etc/X11/Xsession|' /etc/xrdp/startwm.sh 2>/dev/null || true

echo "[+] Nama host -> $PC_NAME"
sudo hostnamectl set-hostname "$(echo "$PC_NAME" | tr -cd 'A-Za-z0-9-' | cut -c1-15)" 2>/dev/null || true

echo "[+] Wallpaper"
WALL_URL="${WALLPAPER_URL:-$WALLPAPER_DEFAULT}"
WALL_PATH="/home/runner/.wallpaper.jpg"
if [ -n "$WALL_URL" ]; then
  if curl -fsSL --max-time 90 -o "$WALL_PATH" "$WALL_URL" && [ -s "$WALL_PATH" ]; then
    sudo chown runner:runner "$WALL_PATH"
    # coba set via xfconf (per monitor xfce4)
    for MON in monitor0 monitor1; do
      sudo -u runner DISPLAY=:10 xfconf-query -c xfce4-desktop -p "/backdrop/screen0/$MON/workspace0/last-image" -s "$WALL_PATH" 2>/dev/null || true
      sudo -u runner DISPLAY=:10 xfconf-query -c xfce4-desktop -p "/backdrop/screen0/$MON/workspace0/image-style" -s 5 2>/dev/null || true
    done
    echo "[OK] Wallpaper: $WALL_PATH"
  else
    echo "[!] Wallpaper gagal diunduh"
  fi
fi

if [ "$MODE" = "Full" ]; then
  echo "[+] Mode Full: install Firefox"
  sudo apt-get install -y -qq firefox 2>&1 | tail -1 || true
else
  echo "[i] MODE CEPAT - aplikasi tambahan dilewati"
fi

echo "[+] Optimasi + start xrdp"
sudo systemctl disable sleep.target suspend.target hibernate.target hybrid-sleep.target 2>/dev/null || true
sudo systemctl restart xrdp 2>/dev/null || sudo service xrdp restart
sudo systemctl enable xrdp 2>/dev/null || true
sleep 2
ss -tlnp 2>/dev/null | grep 3389 || echo "[!] port 3389 belum terbuka (cek service xrdp)"

echo ""
echo "======================================================"
echo " PROVISION LINUX SELESAI (mode: $MODE)"
echo "  Desktop : XFCE via xrdp (port 3389)"
echo "  User    : runner"
echo "======================================================"
