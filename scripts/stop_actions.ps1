# Stop the automatic updates: disable the news and quake workflows on GitHub
# (covers both the PC stand-in and GitHub's own schedule) and remove the \GEO-SCOPE\ tasks.
# Restart later with:  gh workflow enable update-news.yml / update-quakes.yml  and re-register the tasks (HANDOFF.md 7).
$gh = 'C:\Program Files\GitHub CLI\gh.exe'
$repo = 'myiorin1011-cpu/geo-scope'
$log = Join-Path $env:LOCALAPPDATA 'geo-scope\kick.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
function Log($m) { "$((Get-Date).ToString('s')) [stop] $m" | Add-Content -Encoding UTF8 $log }

foreach ($wf in 'update-news.yml', 'update-quakes.yml') {
  $out = (& $gh workflow disable $wf -R $repo 2>&1) -join ' '
  Log "disable $wf exit=$LASTEXITCODE $out"
}
foreach ($t in 'GEO-SCOPE quakes', 'GEO-SCOPE news', 'GEO-SCOPE stop') {
  try { Unregister-ScheduledTask -TaskPath '\GEO-SCOPE\' -TaskName $t -Confirm:$false -ErrorAction Stop; Log "removed task $t" } catch { Log "task $t : $($_.Exception.Message)" }
}
