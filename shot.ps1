param([string]$name = 'a.png', [string]$page = '', [string]$extra = '', [int]$frames = 240, [int]$timeout = 90)
$out = Join-Path $PSScriptRoot "shots\$name"
if (Test-Path $out) { Remove-Item $out }
$ud = Join-Path $env:TEMP 'aq-chrome'
$url = "http://localhost:8090/${page}?shot=$name&frames=$frames&w=1920&h=1080$extra"
$p = Start-Process -PassThru 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList @('--headless=new', '--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', "--user-data-dir=$ud", '--window-size=1920,1080', '--no-first-run', $url)
$t = 0
while (-not (Test-Path $out) -and $t -lt $timeout) { Start-Sleep -Milliseconds 500; $t += 0.5 }
Start-Sleep -Milliseconds 500
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*aq-chrome*" } | Stop-Process -Force -ErrorAction SilentlyContinue
if (Test-Path $out) { "ok $out after $t s" } else { "timeout" }
