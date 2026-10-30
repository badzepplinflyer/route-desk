# Copies the Route Desk tablet app into the MSFS 2024 Community folder.
# It finds the folder the same way the sim does: from UserCfg.opt (InstalledPackagesPath),
# for both the Microsoft Store / Xbox / Game Pass version and the Steam version.
$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot 'routedesk-efb'
Write-Host ''
Write-Host '  Route Desk tablet app installer' -ForegroundColor Cyan
Write-Host '  -------------------------------'
Write-Host ''

$cfgs = @(
  @{ name = 'Microsoft Store / Xbox app / Game Pass'; cfg = Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\UserCfg.opt'; def = Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\Packages' },
  @{ name = 'Steam'; cfg = Join-Path $env:APPDATA 'Microsoft Flight Simulator 2024\UserCfg.opt'; def = Join-Path $env:APPDATA 'Microsoft Flight Simulator 2024\Packages' }
)
$found = @()
foreach ($c in $cfgs) {
  $pkg = $null
  if (Test-Path -LiteralPath $c.cfg) {
    $line = Get-Content -LiteralPath $c.cfg | Where-Object { $_ -match '^\s*InstalledPackagesPath\s+"(.+)"' } | Select-Object -First 1
    if ($line -and $line -match '"(.+)"') { $pkg = $Matches[1] }
  }
  if (-not $pkg -and (Test-Path -LiteralPath $c.def)) { $pkg = $c.def }
  if ($pkg -and (Test-Path -LiteralPath $pkg)) { $found += @{ name = $c.name; path = (Join-Path $pkg 'Community') } }
}

$dest = $null
if ($found.Count -eq 1) {
  $dest = $found[0].path
  Write-Host "  Found Microsoft Flight Simulator 2024 ($($found[0].name))."
} elseif ($found.Count -gt 1) {
  Write-Host '  Found more than one copy of Microsoft Flight Simulator 2024:'
  for ($i = 0; $i -lt $found.Count; $i++) { Write-Host "    $($i + 1). $($found[$i].name)  ->  $($found[$i].path)" }
  $pick = Read-Host '  Type the number of the one you play'
  $n = 0; if ([int]::TryParse($pick, [ref]$n) -and $n -ge 1 -and $n -le $found.Count) { $dest = $found[$n - 1].path }
}
if (-not $dest) {
  Write-Host '  Could not find the sim automatically. Please pick your Community folder in the window that opens.' -ForegroundColor Yellow
  Add-Type -AssemblyName System.Windows.Forms
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $dlg.Description = 'Select your MSFS 2024 Community folder'
  if ($dlg.ShowDialog() -ne 'OK') { Write-Host '  Cancelled. Nothing was installed.' -ForegroundColor Red; exit 1 }
  $dest = $dlg.SelectedPath
}

try {
  if (-not (Test-Path -LiteralPath $dest)) { New-Item -ItemType Directory -Path $dest | Out-Null }
  $target = Join-Path $dest 'routedesk-efb'
  $old = $null
  if (Test-Path -LiteralPath (Join-Path $target 'manifest.json')) {
    try { $old = (Get-Content -LiteralPath (Join-Path $target 'manifest.json') -Raw | ConvertFrom-Json).package_version } catch { }
    Remove-Item -LiteralPath $target -Recurse -Force
  }
  Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force
  $new = (Get-Content -LiteralPath (Join-Path $target 'manifest.json') -Raw | ConvertFrom-Json).package_version
  Write-Host ''
  if ($old -and $old -ne $new) { Write-Host "  Updated Route Desk from $old to $new." -ForegroundColor Green }
  elseif ($old) { Write-Host "  Reinstalled Route Desk $new." -ForegroundColor Green }
  else { Write-Host "  Installed Route Desk $new." -ForegroundColor Green }
  Write-Host "  Location: $target"
  Write-Host ''
  Write-Host '  Next: start (or restart) Microsoft Flight Simulator 2024, open the tablet'
  Write-Host '  in the cockpit, and tap Route Desk. It shows an 8-letter code - type that'
  Write-Host '  code into the Route Desk website.'
} catch {
  Write-Host ''
  Write-Host "  Install failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host '  If the sim is running, close it and try again.'
  exit 1
}
