# GitHub の schedule が発火しない間の代行。Windows のタスクスケジューラから kick_hidden.vbs 経由で呼ぶ。
#   quakes: 15分ごと / news: 4時間ごと（scheduled=true を付けて地域枠を1日2回に絞る）
# GitHub 側の schedule 実行が最近あれば何もしない（直ったら自動で身を引く）。
# ログ: %LOCALAPPDATA%\geo-scope\kick.log
param([ValidateSet('quakes', 'news')][string]$Kind = 'quakes')

$gh = 'C:\Program Files\GitHub CLI\gh.exe'
$repo = 'myiorin1011-cpu/geo-scope'
$wf = @{ quakes = 'update-quakes.yml'; news = 'update-news.yml' }[$Kind]
$windowMin = @{ quakes = 30; news = 300 }[$Kind]
$log = Join-Path $env:LOCALAPPDATA 'geo-scope\kick.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
function Log($m) { "$((Get-Date).ToString('s')) [$Kind] $m" | Add-Content -Encoding UTF8 $log }

try {
  $recent = & $gh run list -R $repo -w $wf -e schedule -L 1 --json createdAt --jq '.[0].createdAt' 2>$null
  if ($recent) {
    $age = ([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($recent)).TotalMinutes
    if ($age -lt $windowMin) { Log "skip: GitHub schedule ran at $recent"; exit 0 }
  }
} catch { }

$a = @('workflow', 'run', $wf, '-R', $repo)
if ($Kind -eq 'news') { $a += @('-f', 'scheduled=true') }
$out = (& $gh @a 2>&1) -join ' '
Log "exit=$LASTEXITCODE $out"
