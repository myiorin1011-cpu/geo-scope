' Runs kick_actions.ps1 without a console window (for Task Scheduler). Arg: quakes / news
Set sh = CreateObject("WScript.Shell")
ps1 = Replace(WScript.ScriptFullName, "kick_hidden.vbs", "kick_actions.ps1")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & ps1 & """ " & WScript.Arguments(0), 0, False
