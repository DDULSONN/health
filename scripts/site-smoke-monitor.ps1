param(
  [string]$BaseUrl = "https://helchang.com",
  [int]$IntervalSeconds = 600
)

$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logDir = Join-Path $PSScriptRoot "..\docs\ops"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir "site-smoke-$stamp.log"

$targets = @(
  "/",
  "/community/dating/cards",
  "/dating/paid",
  "/community/dating"
)

"[$(Get-Date -Format o)] monitor start base=$BaseUrl interval=${IntervalSeconds}s" | Tee-Object -FilePath $logPath -Append

while ($true) {
  $now = Get-Date -Format o
  foreach ($path in $targets) {
    $url = "$BaseUrl$path"
    try {
      $headers = @{ "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36" }
      $res = Invoke-WebRequest -Uri $url -Method GET -Headers $headers -MaximumRedirection 5 -TimeoutSec 20
      $line = "[$now] OK $($res.StatusCode) $path len=$($res.RawContentLength)"
    } catch {
      $status = $_.Exception.Response.StatusCode.value__ 2>$null
      if (-not $status) { $status = "ERR" }
      $line = "[$now] FAIL $status $path msg=$($_.Exception.Message)"
    }
    $line | Tee-Object -FilePath $logPath -Append
  }

  Start-Sleep -Seconds $IntervalSeconds
}
