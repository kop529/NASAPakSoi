<#
  team_setup.ps1 — หลังอัปเฟิร์มแวร์ทีม (หรือหลัง TEAM_DEFAULTS) ส่งค่าทีมทั้งชุดเข้าบอร์ด SunSeek แล้ว TEAM_SAVE
  ค่าอยู่ในไฟล์ team_setup.txt (แก้ค่าที่ไฟล์นั้น ไม่ต้องแก้สคริปต์)

  วิธีใช้ (ปิดเว็บ / Serial Monitor / Ground Station ที่ถือพอร์ตก่อน)
    powershell -NoProfile -ExecutionPolicy Bypass -File C:\TYSC\SunSeek\tools\team_setup.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File C:\TYSC\SunSeek\tools\team_setup.ps1 -Port COM7
    ... -DryRun      แค่แสดงคำสั่งที่จะส่ง ไม่เปิดพอร์ต
    ... -NoSave      ส่งค่าแต่ไม่ TEAM_SAVE (ลองค่าชั่วคราว รีเซ็ตแล้วหาย)

  ขั้นตอน: PING → ตรวจว่าเป็นเฟิร์มแวร์ทีม (TEAM_INFO) → STOP → ส่งทีละบรรทัดรอ ACK
           → ถ้าทุกบรรทัดผ่าน TEAM_SAVE → TEAM_LIST เก็บเป็นหลักฐานใน SunSeek\setup_logs\
  ถ้ามีบรรทัดไหนถูกปฏิเสธ จะไม่ TEAM_SAVE (ค่าที่ส่งไปแล้วอยู่ใน RAM จนรีเซ็ต)
#>
param([string]$Port = '', [string]$File = '', [int]$Baud = 115200, [switch]$DryRun, [switch]$NoSave)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
if (-not $File) { $File = Join-Path $PSScriptRoot 'team_setup.txt' }

$cmds = @(Get-Content -LiteralPath $File -Encoding UTF8 | ForEach-Object { ($_ -replace '#.*$', '').Trim() } | Where-Object { $_ })
if ($cmds.Count -eq 0) { throw "ไม่มีคำสั่งใน $File" }
$bad = @($cmds | Where-Object { $_ -notmatch '^TEAM_SET,[A-Za-z.]+,[-+0-9.eE]+$' })
if ($bad.Count) { throw "บรรทัดรูปแบบผิดใน ${File}: $($bad -join ' | ')  (ต้องเป็น TEAM_SET,<ชื่อ>,<ตัวเลข>)" }

if ($DryRun) {
  "# จะส่ง $($cmds.Count) คำสั่ง แล้ว $(if ($NoSave) { 'ไม่ TEAM_SAVE' } else { 'TEAM_SAVE' })"
  $cmds
  return
}

if (-not $Port) {
  # 10C4 = CP210x (SunSeek v1.3), 303A = USB ในตัว ESP32-S3, 1A86 = CH340
  $cand = @(Get-CimInstance Win32_PnPEntity -Filter "PNPClass='Ports'" | Where-Object { $_.PNPDeviceID -match 'VID_(10C4|303A|1A86)' -and $_.Name -match '\((COM\d+)\)' } | ForEach-Object { $Matches[1] })
  if ($cand.Count -eq 0) { throw 'หาพอร์ตบอร์ดไม่เจอ: เปิดสวิตช์บอร์ด เช็กสาย USB แล้วลองใหม่ หรือระบุ -Port COMx' }
  $Port = $cand[0]
  if ($cand.Count -gt 1) { "# เจอหลายพอร์ต ($($cand -join ', ')) ใช้ $Port" }
}

$logDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'setup_logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$logFile = Join-Path $logDir "setup_$stamp.log"
$mdFile = Join-Path $logDir "setup_$stamp.md"

$sp = New-Object System.IO.Ports.SerialPort $Port, $Baud, 'None', 8, 'One'
$sp.NewLine = "`n"; $sp.DtrEnable = $false; $sp.RtsEnable = $false; $sp.ReadTimeout = 50; $sp.Encoding = [Text.Encoding]::UTF8
try { $sp.Open() } catch { throw "เปิด $Port ไม่ได้ ($($_.Exception.Message)): ปิดเว็บ / Serial Monitor / Ground Station ที่ใช้พอร์ตอยู่ก่อน" }

$script:pending = ''
$script:lines = New-Object System.Collections.Generic.List[string]
function Pump([int]$ms) {
  $end = [DateTime]::Now.AddMilliseconds($ms)
  do {
    try { $chunk = $sp.ReadExisting() } catch { $chunk = '' }
    if ($chunk) {
      $script:pending += $chunk
      while (($i = $script:pending.IndexOf("`n")) -ge 0) {
        $ln = $script:pending.Substring(0, $i).TrimEnd("`r")
        $script:pending = $script:pending.Substring($i + 1)
        if ($ln) { $script:lines.Add($ln); Add-Content -LiteralPath $logFile -Value $ln -Encoding UTF8 }
      }
    } else { Start-Sleep -Milliseconds 15 }
  } while ([DateTime]::Now -lt $end)
}
# send one command and wait for the line that answers it: ACK,<name>... / PONG / ERR,...  -> the line, or '' on timeout
function Ask([string]$c, [int]$ms = 1500) {
  $from = $script:lines.Count
  Add-Content -LiteralPath $logFile -Value ">> $c" -Encoding UTF8
  $sp.Write($c + "`n")
  $name = ($c -split ',')[0]
  $end = [DateTime]::Now.AddMilliseconds($ms)
  while ([DateTime]::Now -lt $end) {
    Pump 30
    for ($k = $from; $k -lt $script:lines.Count; $k++) {
      $ln = $script:lines[$k]
      if (($name -eq 'PING' -and $ln -eq 'PONG') -or $ln.StartsWith("ACK,$name") -or $ln.StartsWith('ERR,')) { return $ln }
    }
  }
  return ''
}

$ok = 0; $failed = @()
try {
  "# $Port @ $Baud · log: $logFile"
  Pump 300
  $pong = ''
  for ($t = 0; $t -lt 3 -and -not $pong; $t++) { $pong = Ask 'PING' 1000 }
  if ($pong -ne 'PONG') { throw 'บอร์ดไม่ตอบ PING: เช็กว่าเปิดสวิตช์ และไม่มีโปรแกรมอื่นถือพอร์ต (หรือกด RESET แล้วรันใหม่)' }
  $from = $script:lines.Count
  $info = Ask 'TEAM_INFO' 1500
  Pump 200
  $fw = @($script:lines | Select-Object -Skip $from | Where-Object { $_.StartsWith('TM,TEAM_FW,') })
  if (-not $info.StartsWith('ACK,TEAM_INFO') -or $fw.Count -eq 0) { throw "บอร์ดนี้ไม่ใช่เฟิร์มแวร์ทีม (ตอบ: $info) — ถ้ายังเป็นเฟิร์มแวร์ workshop ต้องอัปเฟิร์มแวร์ทีมก่อน" }
  "# $($fw[-1])"
  $stop = Ask 'STOP' 1500
  if (-not $stop.StartsWith('ACK,STOP')) { throw "STOP ไม่ผ่าน ($stop)" }
  foreach ($c in $cmds) {
    $ans = Ask $c 1500
    if ($ans.StartsWith('ACK,TEAM_SET,')) { $ok++; "  ok   $c" }
    else { $failed += $c; Write-Host "  FAIL $c  ->  $(if ($ans) { $ans } else { 'ไม่มีคำตอบ' })" -ForegroundColor Red }
  }
  if ($failed.Count) {
    Write-Host "`nมี $($failed.Count) บรรทัดไม่ผ่าน: ไม่ TEAM_SAVE (ค่าที่ผ่านอยู่ใน RAM จนรีเซ็ต) แก้ team_setup.txt แล้วรันใหม่" -ForegroundColor Red
  } elseif ($NoSave) {
    "`nส่งครบ $ok ค่า (ไม่ได้ TEAM_SAVE: รีเซ็ตแล้วกลับเป็นค่าเดิม)"
  } else {
    $sv = Ask 'TEAM_SAVE' 3000
    if (-not $sv.StartsWith('ACK,TEAM_SAVE')) { throw "TEAM_SAVE ไม่ผ่าน ($sv)" }
    "`nส่งครบ $ok ค่า และบันทึกลง flash แล้ว ($sv)"
  }
  # evidence: every parameter as the board has it now
  $from = $script:lines.Count
  [void](Ask 'TEAM_LIST' 1500)
  Pump 600
  $params = @($script:lines | Select-Object -Skip $from | Where-Object { $_.StartsWith('TM,TEAM_PARAM,') } | ForEach-Object { $p = $_ -split ','; "| $($p[2]) | $($p[3]) |" })
  $md = @("# ค่าทีมในบอร์ด ($stamp, $Port)", '', "เฟิร์มแวร์: $($fw[-1])", '', "ส่งจาก team_setup.txt: ผ่าน $ok / $($cmds.Count)$(if ($failed.Count) { ' · ไม่ผ่าน: ' + ($failed -join ', ') })$(if ($NoSave -or $failed.Count) { ' · ไม่ได้ TEAM_SAVE' } else { ' · TEAM_SAVE แล้ว' })", '', '| ค่า | ในบอร์ดตอนนี้ |', '|---|---|') + $params
  Set-Content -LiteralPath $mdFile -Value $md -Encoding UTF8
  "สรุปค่าทั้งหมดในบอร์ด: $mdFile"
}
finally {
  if ($sp.IsOpen) { $sp.Close() }
}
if ($failed.Count) { exit 1 }
