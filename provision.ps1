# ============================================================================
#  provision.ps1 - provisioning Windows (Windows Server 2022 runner)
#  PROVISION_MODE = Cepat : tanpa install aplikasi (langsung siap ~1-2 mnt)
#                   Full  : + VC++, DirectX, WebView2, Chrome, Firefox,
#                           TranslucentTB (taskbar transparan), Lightshot
#  Semua installer punya watchdog 5 menit -> tidak akan pernah hang.
# ============================================================================
$ErrorActionPreference = 'Continue'
$ProgressPreference     = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$script:Mode    = if ($env:PROVISION_MODE -eq 'Full') { 'Full' } else { 'Cepat' }
$script:Failures = 0

function Log($msg)  { Write-Host "[+] $msg" }
function Warn($msg) { Write-Host "[!] $msg" }
function Done($ok, $what) {
  if ($ok) { Write-Host "[OK] $what" } else { Write-Host "[XX] $what"; $script:Failures++ }
}

# unduh dengan retry + header GH (buat repo private)
function Get-FileRobust {
  param([string]$Url, [string]$Out, [int]$Tries = 3)
  for ($i = 1; $i -le $Tries; $i++) {
    try {
      $a = @{ Uri = $Url; OutFile = $Out; UseBasicParsing = $true; TimeoutSec = 120 }
      if ($env:GH_TOKEN) { $a.Headers = @{ Authorization = "Bearer $env:GH_TOKEN" } }
      Invoke-WebRequest @a
      if ((Test-Path $Out) -and (Get-Item $Out).Length -gt 0) { return $true }
    } catch { Warn "unduh gagal (coba $i): $Url" }
    Start-Sleep -Seconds 3
  }
  return $false
}

# installer dengan watchdog: mati otomatis kalau lebih dari 5 menit
function Invoke-Setup {
  param([string]$File, [string[]]$ArgsList, [string]$Name)
  if (-not (Test-Path $File)) { return $false }
  try {
    $p = Start-Process -FilePath $File -ArgumentList $ArgsList -PassThru
    if (-not $p.WaitForExit(300000)) {
      Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
      Warn "$Name di-skip (installer menggantung >5 menit)"
      return $false
    }
    return $true
  } catch { Warn "$Name gagal: $($_.Exception.Message)"; return $false }
}

# ============================================================================
# 1. NAMA PC
# ============================================================================
Log '1. Set nama PC'
$pcName = ($env:PC_NAME -replace '[^A-Za-z0-9\-]', '')
if (-not $pcName) { $pcName = 'Kall' }
try {
  Rename-Computer -NewName $pcName -Force
  Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\ComputerName\ActiveComputerName' -Name 'ComputerName' -Value $pcName -Force
  Done $true "Nama PC -> $pcName"
} catch { Done $false 'gagal set nama PC' }

# ============================================================================
# 2. WALLPAPER (URL input > default upload panel)
# ============================================================================
Log '2. Wallpaper'
$wallDest = "$env:USERPROFILE\wallpaper.jpg"
$wallUrl = if ($env:WALLPAPER_URL) { $env:WALLPAPER_URL } else { $env:WALLPAPER_DEFAULT }
$wallOk = $false
if ($wallUrl) {
  $tmpWall = "$env:TEMP\wall.jpg"
  $wallOk = Get-FileRobust -Url $wallUrl -Out $tmpWall
  if ($wallOk -and (Get-Item $tmpWall).Length -gt 10000) {
    Copy-Item $tmpWall $wallDest -Force
    try {
      Add-Type -AssemblyName System.Drawing
      $img = [System.Drawing.Image]::FromFile($wallDest)
      $img.Dispose()
      $wallOk = $true
    } catch { Warn 'file bukan gambar valid'; $wallOk = $false }
  }
}
if ($wallOk) {
  Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name 'Wallpaper' -Value $wallDest
  Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name 'WallpaperStyle' -Value '10'
  Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name 'TileWallpaper' -Value '0'
  Done $true 'Wallpaper terpasang'
} else { Warn 'wallpaper gagal diunduh - pakai bawaan' }

# ============================================================================
# 3. TEMA dark + aksen ungu + transparansi + taskbar
# ============================================================================
Log '3. Tema + taskbar'
$pers = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
New-Item -Path $pers -Force | Out-Null
Set-ItemProperty -Path $pers -Name 'AppsUseLightTheme'    -Value 0 -Type DWord
Set-ItemProperty -Path $pers -Name 'SystemUsesLightTheme' -Value 0 -Type DWord
Set-ItemProperty -Path $pers -Name 'ColorPrevalence'      -Value 1 -Type DWord
Set-ItemProperty -Path $pers -Name 'EnableTransparency'   -Value 1 -Type DWord
$dwm = 'HKCU:\Software\Microsoft\Windows\DWM'
New-Item -Path $dwm -Force | Out-Null
Set-ItemProperty -Path $dwm -Name 'AccentColor'           -Value 4294335627 -Type DWord  # ungu #8B5CF6
Set-ItemProperty -Path $dwm -Name 'ColorizationColor'     -Value 3304479883 -Type DWord
Set-ItemProperty -Path $dwm -Name 'ColorizationAfterglow' -Value 3304479883 -Type DWord
Done $true 'Dark + transparansi aktif'

# ============================================================================
# 4. Security longgar + auto-login
# ============================================================================
Log '4. Security longgar'
try {
  Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'EnableLUA' -Value 0 -Type DWord
  Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'ConsentPromptBehaviorAdmin' -Value 0 -Type DWord
  Done $true 'UAC off'
} catch { Done $false 'UAC gagal' }
Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name 'ScreenSaveActive' -Value '0'
Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name 'ScreenSaverIsSecure' -Value '0'
try {
  powercfg /change standby-timeout-ac 0 | Out-Null
  powercfg /change monitor-timeout-ac 0 | Out-Null
  Done $true 'sleep/monitor off'
} catch { Warn 'powercfg gagal' }
try {
  $wl = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
  Set-ItemProperty -Path $wl -Name 'AutoAdminLogon' -Value '1'
  Set-ItemProperty -Path $wl -Name 'DefaultUserName' -Value 'runneradmin'
  Set-ItemProperty -Path $wl -Name 'DefaultPassword' -Value $env:RDP_PASS
  Done $true 'auto-login aktif'
} catch { Warn 'auto-login gagal' }
try { Add-LocalGroupMember -Group 'Remote Desktop Users' -Member 'runneradmin' -ErrorAction SilentlyContinue } catch {}
Done $true 'runneradmin admin + RDP'

# ============================================================================
# 5. EKSPLORER: This PC + Control Panel di desktop
# ============================================================================
$cls = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Desktop\NameSpace'
foreach ($g in @('{20D04FE0-3AEA-1069-A2D8-08002B30309D}','{5399E694-6CE5-4D6C-8FCE-1D8870FDCBA0}')) {
  if (-not (Test-Path "$cls\$g")) { New-Item -Path "$cls\$g" -Force | Out-Null }
}
Done $true 'This PC + Control Panel di desktop'

# ============================================================================
# 6+ (Mode FULL saja) - runtime, browser, taskbar transparan, Lightshot
# ============================================================================
if ($script:Mode -eq 'Cepat') {
  Write-Host '[i] MODE CEPAT - install aplikasi dilewati (Chrome/Firefox/TranslucentTB/Lightshot tidak dipasang)'
} else {
  Log '6. Mode Full: runtime + browser + tools'
  $dl = "$env:TEMP\dl"
  New-Item -ItemType Directory -Path $dl -Force | Out-Null

  $vc = "$dl\vc_redist.x64.exe"
  if ((Get-FileRobust -Url 'https://aka.ms/vs/17/release/vc_redist.x64.exe' -Out $vc)) { Invoke-Setup -File $vc -ArgsList @('/install','/quiet','/norestart') -Name 'VC++ x64' | Out-Null; Done (Test-Path $vc) 'VC++ x64 diproses' }
  $vc86 = "$dl\vc_redist.x86.exe"
  if ((Get-FileRobust -Url 'https://aka.ms/vs/17/release/vc_redist.x86.exe' -Out $vc86)) { Invoke-Setup -File $vc86 -ArgsList @('/install','/quiet','/norestart') -Name 'VC++ x86' | Out-Null; Done (Test-Path $vc86) 'VC++ x86 diproses' }

  $dx = "$dl\dxwebsetup.exe"
  if ((Get-FileRobust -Url 'https://download.microsoft.com/download/1/7/1/1718ccc4-6315-4d8e-9543-8e28a4e18c4c/dxwebsetup.exe' -Out $dx)) { Invoke-Setup -File $dx -ArgsList @('/Q') -Name 'DirectX' | Out-Null; Done (Test-Path $dx) 'DirectX diproses' }

  $wv = "$dl\webview2.exe"
  if ((Get-FileRobust -Url 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -Out $wv)) { Invoke-Setup -File $wv -ArgsList @('/silent','/install') -Name 'WebView2' | Out-Null; Done (Test-Path $wv) 'WebView2 diproses' }

  # Chrome
  $chromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
  if (-not (Test-Path $chromePath)) {
    $ch = "$dl\chrome.exe"
    if ((Get-FileRobust -Url 'https://dl.google.com/chrome/install/standalonesetup64.exe' -Out $ch)) { Invoke-Setup -File $ch -ArgsList @('/silent','/install') -Name 'Chrome' | Out-Null }
  }
  if (Test-Path $chromePath) {
    try {
      $chLocal = 'HKCU:\Software\Policies\Google\Chrome'
      New-Item -Path $chLocal -Force | Out-Null
      Set-ItemProperty -Path $chLocal -Name 'HideFirstRunExperience' -Value 1 -Type DWord
      Set-ItemProperty -Path $chLocal -Name 'BrowserSignin' -Value 1 -Type DWord
    } catch {}
    Done $true 'Chrome terinstall'
  } else { Done $false 'Chrome tidak terpasang' }

  # Firefox
  $ffPath = 'C:\Program Files\Mozilla Firefox\firefox.exe'
  if (-not (Test-Path $ffPath)) {
    $ff = "$dl\firefox.exe"
    if ((Get-FileRobust -Url 'https://download.mozilla.org/?product=firefox-latest-ssl&os=win64&lang=en-US' -Out $ff)) { Invoke-Setup -File $ff -ArgsList @('-ms') -Name 'Firefox' | Out-Null }
  }
  Done (Test-Path $ffPath) 'Firefox terinstall'

  # TranslucentTB - taskbar transparan
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
    } catch { Warn 'TranslucentTB gagal diunduh' }
  }
  if (Test-Path $ttbExe) {
    try {
      $clean = @{ desktop_appearance = @{ accent = 'clear' }; start_opened_appearance = @{ accent = 'clear' }; search_opened_appearance = @{ accent = 'clear' }; task_view_opened_appearance = @{ accent = 'clear' }; hide_tray = $false } | ConvertTo-Json -Depth 5
      Set-Content -Path "$ttbDir\settings.json" -Value $clean -Encoding Ascii
    } catch {}
    Start-Process -FilePath $ttbExe -WorkingDirectory $ttbDir
    Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'TranslucentTB' -Value "`"$ttbExe`""
    Done $true 'TranslucentTB aktif (taskbar transparan)'
  } else { Done $false 'TranslucentTB tidak terpasang' }

  # Lightshot
  $lsPath = 'C:\Program Files (x86)\Lightshot\Lightshot.exe'
  if (-not (Test-Path $lsPath)) {
    $ls = "$dl\lightshot.exe"
    if ((Get-FileRobust -Url 'https://app.prntscr.com/build/setup-lightshot.exe' -Out $ls)) { Invoke-Setup -File $ls -ArgsList @('/VERYSILENT','/NORESTART') -Name 'Lightshot' | Out-Null }
  }
  if (Test-Path $lsPath) {
    Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'Lightshot' -Value "`"$lsPath`""
    Done $true 'Lightshot terinstall (PrtSc)'
  } else { Done $false 'Lightshot tidak terpasang' }
}

# ============================================================================
# 7. Optimasi + apply
# ============================================================================
try { powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c | Out-Null; Done $true 'Power plan High Performance' } catch { Warn 'power plan default' }
try { Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects' -Name 'VisualFXSetting' -Value 2 -Type DWord } catch {}
& RUNDLL32.EXE user32.dll,UpdatePerUserSystemParameters 1, True
try { Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; Start-Process explorer; Done $true 'Explorer restart' } catch { Warn 'explorer restart gagal' }

Write-Host ''
Write-Host '======================================================'
Write-Host " PROVISION SELESAI (mode: $script:Mode)"
Write-Host "  PC Name   : $pcName"
Write-Host "  Wallpaper : custom ($wallOk)"
Write-Host "  Masalah   : $script:Failures"
Write-Host '======================================================'
