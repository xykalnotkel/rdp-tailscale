# ============================================================================
#  provision.ps1 - RDP provisioning lengkap (dijalankan dari GitHub Actions)
#  Windows Server 2022 runner. Semua output = ASCII-safe.
# ============================================================================
$ErrorActionPreference = 'Continue'
$ProgressPreference     = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$script:Failures = 0
function Log($msg)   { Write-Host "[+] $msg" }
function Warn($msg)  { Write-Host "[!] $msg" }
function Done($ok, $what) {
  if ($ok) { Write-Host "[OK] $what" } else { Write-Host "[XX] $what"; $script:Failures++ }
}

# ---------------------------------------------------------------------------
# 0. Bantuan unduh: pakai auth header kalau GH_TOKEN ada (untuk repo private)
# ---------------------------------------------------------------------------
function Get-FileRobust {
  param([string]$Url, [string]$Out, [int]$Tries = 3)
  for ($i = 1; $i -le $Tries; $i++) {
    try {
      $args = @{ Uri = $Url; OutFile = $Out; UseBasicParsing = $true; TimeoutSec = 120 }
      if ($env:GH_TOKEN) { $args.Headers = @{ Authorization = "Bearer $env:GH_TOKEN" } }
      Invoke-WebRequest @args
      if ((Test-Path $Out) -and (Get-Item $Out).Length -gt 0) { return $true }
    } catch { Warn "unduh gagal (coba $i): $Url -> $($_.Exception.Message)" }
    Start-Sleep -Seconds 3
  }
  return $false
}

# ============================================================================
# 1. NAMA PC = "Kall"
# ============================================================================
Log '1. Set nama PC'
$pcName = ($env:PC_NAME -replace '[^A-Za-z0-9\-]', '')
if (-not $pcName) { $pcName = 'Kall' }
try {
  Rename-Computer -NewName $pcName -Force
  Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\ComputerName\ActiveComputerName' -Name 'ComputerName' -Value $pcName -Force
  Done $true "Nama PC diatur ke '$pcName' (efek penuh setelah reboot, RDP tetap jalan)"
} catch { Done $false "gagal set nama PC: $($_.Exception.Message)" }

# ============================================================================
# 2. WALLPAPER (URL input > default)
# ============================================================================
Log '2. Wallpaper'
$wallDest = "$env:USERPROFILE\wallpaper.jpg"
$wallUrl = $env:WALLPAPER_URL
if (-not $wallUrl) { $wallUrl = $env:WALLPAPER_DEFAULT }
$wallOk = $false
if ($wallUrl) {
  $tmpWall = "$env:TEMP\wall.jpg"
  $wallOk = Get-FileRobust -Url $wallUrl -Out $tmpWall
  if ($wallOk -and (Get-Item $tmpWall).Length -gt 10000) {
    Copy-Item $tmpWall $wallDest -Force
    # pastikan format .jpg benar-benar gambar (cek magic bytes JPEG/PNG)
    $bytes = [System.IO.File]::ReadAllBytes($wallDest)[0..7]
    $jpeg = ($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xD8)
    $png  = ($bytes[0] -eq 0x89 -and $bytes[1] -eq 0x50)
    if ($jpeg -or $png) {
      try {
        Add-Type -AssemblyName System.Drawing
        $img = [System.Drawing.Image]::FromFile($wallDest)
        $img.Dispose()
      } catch { Warn 'wallpaper bukan gambar valid, lanjut default registry' }
    }
  }
}
if ($wallOk) {
  Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name 'Wallpaper' -Value $wallDest
  Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name 'WallpaperStyle' -Value '10'  # Fill
  Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name 'TileWallpaper' -Value '0'
  Done $true 'Wallpaper custom dipasang'
} else {
  Warn 'Wallpaper gagal diunduh - pakai wallpaper bawaan'
}

# ============================================================================
# 3. TEMA: dark + transparansi + aksen, taskbar
# ============================================================================
Log '3. Tema dark + aksen + transparansi'
$pers = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
New-Item -Path $pers -Force | Out-Null
Set-ItemProperty -Path $pers -Name 'AppsUseLightTheme'    -Value 0 -Type DWord
Set-ItemProperty -Path $pers -Name 'SystemUsesLightTheme' -Value 0 -Type DWord
Set-ItemProperty -Path $pers -Name 'ColorPrevalence'      -Value 1 -Type DWord
Set-ItemProperty -Path $pers -Name 'EnableTransparency'   -Value 1 -Type DWord   # transparansi nyala

# Aksen ungu (#8B5CF6) -> ABGR 0xFFF65C8B
$dwm = 'HKCU:\Software\Microsoft\Windows\DWM'
New-Item -Path $dwm -Force | Out-Null
Set-ItemProperty -Path $dwm -Name 'AccentColor'           -Value 4294335627 -Type DWord
Set-ItemProperty -Path $dwm -Name 'ColorizationColor'     -Value 3304479883 -Type DWord
Set-ItemProperty -Path $dwm -Name 'ColorizationAfterglow' -Value 3304479883 -Type DWord
Set-ItemProperty -Path $dwm -Name 'ColorizationColorBalance' -Value 90 -Type DWord
Set-ItemProperty -Path $dwm -Name 'EnableAeroPeek'        -Value 1 -Type DWord
Done $true 'Tema dark + transparansi aktif'

# Taskbar: kecil & warna gelap bawaan biar kontras dengan wallpaper
Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced' -Name 'TaskbarSmallIcons' -Value 0 -Type DWord

# ============================================================================
# 4. Security: longgar tapi tetap wajar (sesuai permintaan "jangan terlalu ketat")
# ============================================================================
Log '4. Longgarkan security (UAC, lock, SmartScreen, screensaver)'
try {
  Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'EnableLUA' -Value 0 -Type DWord
  Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'ConsentPromptBehaviorAdmin' -Value 0 -Type DWord
  Done $true 'UAC dimatikan (semua proses admin tanpa prompt)'
} catch { Done $false 'UAC: gagal' }

# Screensaver & lock mati biar sesi tidak terkunci
Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name 'ScreenSaveActive' -Value '0'
Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name 'ScreenSaverIsSecure' -Value '0'
Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name 'SCRNSAVE.EXE' -Value ''
try {
  powercfg /change standby-timeout-ac 0 | Out-Null
  powercfg /change monitor-timeout-ac 0 | Out-Null
  powercfg /hibernate off | Out-Null
  Done $true 'Sleep/hibernate/monitor mati'
} catch { Done $false 'powercfg gagal' }

# SmartScreen off + tips Windows off
try {
  Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced' -Name 'SmartScreenEnabled' -Value 'Off'
  Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer' -Name 'SmartScreenEnabled' -Value 'Off'
} catch {}
$cdm = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager'
New-Item -Path $cdm -Force | Out-Null
Set-ItemProperty -Path $cdm -Name 'SoftLandingEnabled' -Value 0 -Type DWord
Set-ItemProperty -Path $cdm -Name 'SystemPaneSuggestionsEnabled' -Value 0 -Type DWord
Set-ItemProperty -Path $cdm -Name 'SubscribedContent-338389Enabled' -Value 0 -Type DWord

# Auto-login: restart sesi RDP berikutnya langsung masuk tanpa PIN
try {
  $wl = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
  Set-ItemProperty -Path $wl -Name 'AutoAdminLogon' -Value '1'
  Set-ItemProperty -Path $wl -Name 'DefaultUserName' -Value 'runneradmin'
  Set-ItemProperty -Path $wl -Name 'DefaultPassword' -Value $env:RDP_PASS
  Done $true 'Auto-login diaktifkan'
} catch { Done $false 'Auto-login gagal' }

# Akses RDP untuk semua grup admin
try {
  Add-LocalGroupMember -Group 'Remote Desktop Users' -Member 'runneradmin' -ErrorAction SilentlyContinue
  Done $true 'runneradmin di grup Administrators + Remote Desktop Users'
} catch { Done $false 'grup RDP gagal' }

# ============================================================================
# 5. EXPLORER: tampilkan This PC, Control Panel, dsb
# ============================================================================
Log '5. Explorer: This PC di desktop'
$cls = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Desktop\NameSpace'
$g = '{20D04FE0-3AEA-1069-A2D8-08002B30309D}'   # This PC
if (-not (Test-Path "$cls\$g")) { New-Item -Path "$cls\$g" -Force | Out-Null }
$cp = '{5399E694-6CE5-4D6C-8FCE-1D8870FDCBA0}'  # Control Panel
if (-not (Test-Path "$cls\$cp")) { New-Item -Path "$cls\$cp" -Force | Out-Null }
$cmd = '{1fcf7450-e2a1-4d8d-9f8f-6b3e4e5c5a1c}'  # Command Prompt
if (-not (Test-Path "$cls\$cmd")) { New-Item -Path "$cls\$cmd" -Force | Out-Null }

# ============================================================================
# 6. INSTALL: runtime & "driver support" (DirectX + VC++ + WebView2)
#    Catatan: runner adalah Windows Server 2022 - tidak bisa pasang driver
#    GPU fisik, tapi runtime grafis/game lengkap dipasang di sini.
# ============================================================================
Log '6. Install runtime (VC++, DirectX, WebView2, Chrome, Firefox)'
$dl = "$env:TEMP\dl"
New-Item -ItemType Directory -Path $dl -Force | Out-Null

# VC++ Redist 2015-2022 (x64 + x86) - banyak game & aplikasi butuh ini
$vc = "$dl\vc_redist.x64.exe"
if ((Get-FileRobust -Url 'https://aka.ms/vs/17/release/vc_redist.x64.exe' -Out $vc) -and (Test-Path $vc)) {
  Start-Process -Wait -FilePath $vc -ArgumentList '/install','/quiet','/norestart'
  Done $true 'VC++ Redist x64 terinstall'
} else { Done $false 'VC++ x64 gagal diunduh' }
$vc86 = "$dl\vc_redist.x86.exe"
if ((Get-FileRobust -Url 'https://aka.ms/vs/17/release/vc_redist.x86.exe' -Out $vc86) -and (Test-Path $vc86)) {
  Start-Process -Wait -FilePath $vc86 -ArgumentList '/install','/quiet','/norestart'
  Done $true 'VC++ Redist x86 terinstall'
} else { Done $false 'VC++ x86 gagal diunduh' }

# DirectX End-User Runtime (kompatibilitas game lama)
$dx = "$dl\dxwebsetup.exe"
if ((Get-FileRobust -Url 'https://download.microsoft.com/download/1/7/1/1718ccc4-6315-4d8e-9543-8e28a4e18c4c/dxwebsetup.exe' -Out $dx) -and (Test-Path $dx)) {
  Start-Process -Wait -FilePath $dx -ArgumentList '/Q'
  Done $true 'DirectX Runtime terinstall'
} else { Done $false 'DirectX gagal diunduh' }

# WebView2 Runtime (banyak aplikasi modern butuh ini)
$wv = "$dl\webview2.exe"
if ((Get-FileRobust -Url 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -Out $wv) -and (Test-Path $wv)) {
  Start-Process -Wait -FilePath $wv -ArgumentList '/silent','/install'
  Done $true 'WebView2 Runtime terinstall'
} else { Done $false 'WebView2 gagal diunduh' }

# ============================================================================
# 7. BROWSER: Chrome + Firefox (silent) - siap login Google
#    Catatan: login Google OTOMATIS tidak bisa diprogram dari luar tanpa
#    interaksi verifikasi akun (keamanan Google). Browser disiapkan penuh:
#    first-run dimatikan, siap dipakai login 1x lalu tersimpan.
# ============================================================================
$chromeOk = $false
$chromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path $chromePath)) {
  $ch = "$dl\chrome.exe"
  if ((Get-FileRobust -Url 'https://dl.google.com/chrome/install/standalonesetup64.exe' -Out $ch) -and (Test-Path $ch)) {
    Start-Process -Wait -FilePath $ch -ArgumentList '/silent','/install'
    if (Test-Path $chromePath) { $chromeOk = $true }
  }
} else { $chromeOk = $true }
Done $chromeOk 'Google Chrome siap'

# Chrome: matikan first-run prompt
if ($chromeOk) {
  try {
    $chLocal = 'HKCU:\Software\Policies\Google\Chrome'
    New-Item -Path $chLocal -Force | Out-Null
    Set-ItemProperty -Path $chLocal -Name 'HideFirstRunExperience' -Value 1 -Type DWord
    Set-ItemProperty -Path $chLocal -Name 'BrowserSignin' -Value 1 -Type DWord
    Set-ItemProperty -Path $chLocal -Name 'PasswordManagerEnabled' -Value $true -Type DWord
    Set-ItemProperty -Path $chLocal -Name 'AutofillCreditCardEnabled' -Value $true -Type DWord
    Done $true 'Chrome first-run off + autofill aktif'
  } catch { Warn 'policy Chrome gagal' }
}

$ffPath = 'C:\Program Files\Mozilla Firefox\firefox.exe'
$ffOk = $false
if (-not (Test-Path $ffPath)) {
  $ff = "$dl\firefox.exe"
  if ((Get-FileRobust -Url 'https://download.mozilla.org/?product=firefox-latest-ssl&os=win64&lang=en-US' -Out $ff) -and (Test-Path $ff)) {
    Start-Process -Wait -FilePath $ff -ArgumentList '-ms'
    if (Test-Path $ffPath) { $ffOk = $true }
  }
} else { $ffOk = $true }
Done $ffOk 'Mozilla Firefox siap'

# ============================================================================
# 8. TASKBAR TRANSPARAN - TranslucentTB (portable, autostart)
# ============================================================================
Log '8. Taskbar transparan (TranslucentTB)'
$ttbDir = 'C:\Tools\TranslucentTB'
$ttbExe = "$ttbDir\TranslucentTB.exe"
if (-not (Test-Path $ttbExe)) {
  try {
    $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/TranslucentTB/TranslucentTB/releases/latest' -Headers @{ 'User-Agent' = 'rdp-kall' }
    $asset = $rel.assets | Where-Object { $_.name -like '*portable-x64*.zip' } | Select-Object -First 1
    if ($asset) {
      $zip = "$dl\ttb.zip"
      if (Get-FileRobust -Url $asset.browser_download_url -Out $zip) {
        New-Item -ItemType Directory -Path $ttbDir -Force | Out-Null
        Expand-Archive -Path $zip -DestinationPath $ttbDir -Force
      }
    }
  } catch { Warn "TranslucentTB gagal: $($_.Exception.Message)" }
}

if (Test-Path $ttbExe) {
  # Konfigurasi: taskbar CLEAR (transparan penuh), start menu transparan
  try {
    $clean = @{
      'desktop_appearance'          = @{ accent = 'clear' }
      'start_opened_appearance'     = @{ accent = 'clear' }
      'search_opened_appearance'    = @{ accent = 'clear' }
      'task_view_opened_appearance' = @{ accent = 'clear' }
      'hide_tray'                   = $false
    } | ConvertTo-Json -Depth 5
    Set-Content -Path "$ttbDir\settings.json" -Value $clean -Encoding Ascii
  } catch { Warn 'config TTB gagal ditulis, pakai default' }

  # Jalankan + autostart
  Start-Process -FilePath $ttbExe -WorkingDirectory $ttbDir
  $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  Set-ItemProperty -Path $runKey -Name 'TranslucentTB' -Value "`"$ttbExe`"" 
  Done $true 'TranslucentTB aktif: taskbar transparan + autostart'
} else { Done $false 'TranslucentTB tidak terpasang' }

# ============================================================================
# 9. LIGHTSHOT (screenshot) + autostart
# ============================================================================
Log '9. Lightshot'
$lsPath = 'C:\Program Files (x86)\Lightshot\Lightshot.exe'
if (-not (Test-Path $lsPath)) {
  $ls = "$dl\lightshot.exe"
  if ((Get-FileRobust -Url 'https://app.prntscr.com/build/setup-lightshot.exe' -Out $ls) -and (Test-Path $ls)) {
    Start-Process -Wait -FilePath $ls -ArgumentList '/VERYSILENT','/NORESTART'
  }
}
if (Test-Path $lsPath) {
  $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  Set-ItemProperty -Path $runKey -Name 'Lightshot' -Value "`"$lsPath`""
  Done $true 'Lightshot terinstall + autostart (hotkey: PrtSc)'
} else { Done $false 'Lightshot tidak terpasang' }

# ============================================================================
# 10. OPTIMASI tambahan
# ============================================================================
Log '10. Optimasi'
try {
  powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c | Out-Null   # High performance
  Done $true 'Power plan: High Performance'
} catch { Warn 'power plan default' }

# Nonaktifkan animasi berlebihan biar RDP terasa ringan
try {
  $ui = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects'
  Set-ItemProperty -Path $ui -Name 'VisualFXSetting' -Value 2 -Type DWord
} catch {}

# Matikan sticky keys & filter keys prompt
try {
  $acc = 'HKCU:\Control Panel\Accessibility\StickyKeys'
  Set-ItemProperty -Path $acc -Name 'Flags' -Value '506'
  Done $true 'Sticky keys prompt off'
} catch {}

# Wallpaper diterapkan penuh
& RUNDLL32.EXE user32.dll,UpdatePerUserSystemParameters 1, True

# Restart explorer biar semua registry theme/desktop kepakai
try {
  Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Start-Process explorer
  Done $true 'Explorer di-restart, tema aktif'
} catch { Warn 'explorer restart gagal (tidak fatal)' }

# ============================================================================
# 11. Ringkasan
# ============================================================================
Write-Host ''
Write-Host '======================================================'
Write-Host ' PROVISION SELESAI'
Write-Host "  PC Name     : $pcName"
Write-Host "  Wallpaper   : custom ($wallOk)"
Write-Host "  Taskbar     : transparan (TranslucentTB)"
Write-Host "  Lightshot   : PrtSc untuk screenshot"
Write-Host "  Chrome/FF   : siap dipakai"
Write-Host "  UAC/sleep   : off (security longgar)"
Write-Host '======================================================'
Write-Host "Total masalah: $script:Failures (0 = semua beres)"
