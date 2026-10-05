<#
  t01.ps1 - ตัวช่วยทำ Workshop T01 (Reaction Wheel) อัตโนมัติ กับเฟิร์มแวร์ผู้จัด v2.1 (SunSeek\workshop\)
  สคริปต์ส่งคำสั่ง รอเวลา อ่านคำตอบบอร์ดให้ แล้วถามสิ่งที่ต้องดูด้วยตา (y/n) จากนั้นสรุปค่าทั้ง 6 ข้อของสไลด์
  ลงไฟล์ C:\TYSC\SunSeek\t01_results\T01_<เวลา>.md (+ log ทุกบรรทัด)

  วิธีใช้ (ปิด Serial Monitor / เว็บ ก่อน เพราะพอร์ตใช้ได้ทีละโปรแกรม; แท่นต้องหมุนได้อิสระ ไม่มีอะไรขวางล้อ)
    powershell -ExecutionPolicy Bypass -File C:\TYSC\SunSeek\tools\t01.ps1
    powershell -ExecutionPolicy Bypass -File C:\TYSC\SunSeek\tools\t01.ps1 -Port COM9
  ฉุกเฉิน: กด Ctrl+C ได้ทุกเมื่อ สคริปต์จะส่ง STOP ให้ก่อนปิด (หรือปิดสวิตช์บอร์ด)
#>
param([string]$Port = '', [int]$Baud = 115200, [int]$MaxPct = 80)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

if (-not $Port) {
  $c = @(Get-CimInstance Win32_PnPEntity -Filter "PNPClass='Ports'" | Where-Object { $_.PNPDeviceID -match 'VID_(303A|10C4|1A86)' -and $_.Name -match '\((COM\d+)\)' } | ForEach-Object { $Matches[1] })
  if ($c.Count -eq 0) { Write-Host 'หาบอร์ดไม่เจอ: เปิดสวิตช์บอร์ด เสียบ USB (สายที่ส่งข้อมูลได้) แล้วลองใหม่ หรือใส่ -Port COMx' -ForegroundColor Red; exit 1 }
  $Port = $c[0]
}
$outDir = 'C:\TYSC\SunSeek\t01_results'
New-Item -ItemType Directory -Force $outDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$logFile = Join-Path $outDir "T01_$stamp.log"
$mdFile = Join-Path $outDir "T01_$stamp.md"

$sp = New-Object System.IO.Ports.SerialPort $Port, $Baud
$sp.NewLine = "`n"; $sp.ReadTimeout = 50; $sp.DtrEnable = $false; $sp.RtsEnable = $false
$sp.Open()
Write-Host "เปิดพอร์ต $Port แล้ว" -ForegroundColor Green

function Log($s) { Add-Content -Path $logFile -Value ("{0:HH:mm:ss.fff} {1}" -f (Get-Date), $s) -Encoding UTF8 }
function Listen([int]$ms) {
  $lines = @(); $end = (Get-Date).AddMilliseconds($ms)
  while ((Get-Date) -lt $end) {
    try { $l = $sp.ReadLine().Trim(); if ($l) { $lines += $l; Log "< $l"; if ($l -notmatch '^TM,(IMU|SUN|ADCS|EST)') { Write-Host "   < $l" -ForegroundColor DarkGray } } } catch [TimeoutException] { }
  }
  return ,$lines
}
function Send([string]$cmd, [int]$ms = 600) {
  Write-Host "> $cmd" -ForegroundColor Cyan; Log "> $cmd"
  $sp.WriteLine($cmd); return (Listen $ms)
}
function Ask([string]$q) {
  while ($true) { $a = (Read-Host "   ? $q (y/n)").Trim().ToLower(); if ($a -in 'y', 'n') { Log "? $q -> $a"; return $a -eq 'y' } }
}
function Note([string]$q) { $a = Read-Host "   ? $q"; Log "? $q -> $a"; return $a }
function Wait-Stop { [void](Send 'STOP' 300); Write-Host '   (รอล้อหยุดสนิท 3 วินาที)'; [void](Listen 3000) }

$R = New-Object 'System.Collections.Generic.Dictionary[string,string]'  # [ordered] picks the Int32 indexer in PS 5.1
try {
  # ---------- 0. เริ่ม: บอร์ดตอบไหม, โหมดถูกไหม
  [void](Listen 500)
  $resp = Send 'PING' 800
  if (-not ($resp -match '^PONG')) { $resp = Send 'PING' 1500 }
  if (-not ($resp -match '^PONG')) { throw 'บอร์ดไม่ตอบ PING: เช็กว่าอัปโหลดเฟิร์มแวร์ v2.1 แล้ว, ปิด Serial Monitor แล้ว, ลองกดปุ่ม RESET บนบอร์ด' }
  $resp = Send 'STOP' 500
  $R['Safe stop (ตอนเริ่ม)'] = if (($resp -match '^ACK,STOP') -and ($resp -match '^EVT,SAFE')) { 'ACK,STOP + EVT,SAFE ✓' } else { 'ไม่ครบ: ' + ($resp -join ' | ') }
  [void](Send 'ADCS_MODE,MANUAL' 400); [void](Send 'ADCS_STRATEGY,REACTION' 400)
  Write-Host "`nเช็กก่อนเริ่ม: ล้อยึดแน่น ไม่มีสาย/มือใกล้ล้อ แท่นหมุนได้อิสระ" -ForegroundColor Yellow
  if (-not (Ask 'พร้อมเริ่มไหม')) { throw 'ผู้ใช้ยกเลิก' }

  # ---------- 1. Direction convention
  Write-Host "`n=== 1. ทิศทาง (มองจากด้านบนล้อ) ===" -ForegroundColor Yellow
  [void](Send 'RW,20' 3000)
  $R['คำสั่ง + : ล้อหมุน'] = Note 'ล้อหมุนทิศไหน พิมพ์ ทวน หรือ ตาม (เข็มนาฬิกา) หรือ ไม่หมุน'
  $R['คำสั่ง + : แท่น/ตัวดาวเทียม'] = Note 'ตัวแท่นหมุนทิศไหน (ทวน/ตาม/ไม่ขยับ)'
  Wait-Stop
  [void](Send 'RW,-20' 3000)
  $R['คำสั่ง − : ล้อหมุน'] = Note 'ล้อหมุนทิศไหน (ทวน/ตาม/ไม่หมุน)'
  Wait-Stop

  # ---------- 2. Minimum start (จากหยุด) และ minimum stable (ลดลง) ทั้ง + และ −
  foreach ($s in 1, -1) {
    $sg = if ($s -gt 0) { '+' } else { '−' }
    Write-Host "`n=== 2A. Min Start ฝั่ง $sg (เริ่มจากล้อหยุดทุกครั้ง) ===" -ForegroundColor Yellow
    $start = $null
    foreach ($p in 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60) {
      [void](Send ("RW,{0}" -f ($s * $p)) 3000)
      $ok = Ask "ที่ $sg$p % ล้อออกตัวหมุนเองไหม"
      Wait-Stop
      if ($ok) {
        [void](Send ("RW,{0}" -f ($s * $p)) 3000); $again = Ask "ลองซ้ำที่ $sg$p % ออกตัวอีกไหม"; Wait-Stop
        if ($again) { $start = $p; break }
      }
    }
    $R["Min Start $sg"] = if ($start) { "$start %" } else { '> 60 % (ไม่ออกตัวถึง 60)' }

    if (-not $start) { $R["Min Stable $sg"] = "วัดไม่ได้ (ล้อไม่ออกตัว)"; continue }
    Write-Host "`n=== 2B. Min Stable ฝั่ง $sg (หมุนอยู่แล้วค่อยลด) ===" -ForegroundColor Yellow
    [void](Send ("RW,{0}" -f ($s * 60)) 3000)
    $stable = 60
    foreach ($p in 55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5) {
      [void](Send ("RW,{0}" -f ($s * $p)) 3000)
      if (Ask "ที่ $sg$p % ล้อยังหมุนต่อเนื่อง ไม่สะดุดไหม") { $stable = $p } else { break }
    }
    $R["Min Stable $sg"] = "$stable %"
    Wait-Stop
  }

  # ---------- 3 + 5. ช่วงใช้งาน (linear) และการสั่น
  Write-Host "`n=== 3. ช่วงใช้งาน + การสั่น (ค่อย ๆ เพิ่ม) ===" -ForegroundColor Yellow
  $faster = @(); $vib = @()
  foreach ($p in 20, 30, 40, 50, 60, 70, 80) {
    if ($p -gt $MaxPct) { break }
    if ($p -gt 40 -and -not (Ask "ไปต่อที่ $p % ไหม (ถ้ามีสั่นแรงตอบ n)")) { break }
    [void](Send "RW,$p" 3000)
    if (Ask "ที่ $p % เร็วขึ้นชัดเจนจากขั้นก่อนไหม") { $faster += $p }
    if (Ask "ที่ $p % สั่น/มีเสียงผิดปกติไหม") { $vib += $p }
  }
  Wait-Stop
  $R['ช่วงที่เร็วขึ้นตามคำสั่ง (เกือบ linear)'] = if ($faster) { "$($faster[0])–$($faster[-1]) %" } else { 'ไม่ชัด' }
  $R['ช่วงที่สั่น/เสียงดัง'] = if ($vib) { ($vib -join ', ') + ' %' } else { 'ไม่พบ' }

  # ---------- 4. สมมาตร + / −
  $R['สมมาตร +/−'] = "Start + $($R['Min Start +']) / − $($R['Min Start −']) · Stable + $($R['Min Stable +']) / − $($R['Min Stable −'])"

  # ---------- กลับทิศ (direction reversal)
  Write-Host "`n=== กลับทิศ RW,30 -> RW,-30 ===" -ForegroundColor Yellow
  [void](Send 'RW,30' 4000)
  [void](Send 'RW,-30' 4000)
  $R['กลับทิศ'] = Note 'ล้อกลับทิศทันทีไหม / ช้าลงก่อนแล้วค่อยกลับ / แท่นสะบัดไหม (พิมพ์สั้น ๆ)'

  # ---------- 6. Safe stop ขณะหมุน
  Write-Host "`n=== 6. Safe stop ขณะหมุน ===" -ForegroundColor Yellow
  [void](Send 'RW,30' 2500)
  $resp = Send 'STOP' 800
  $okStop = ($resp -match '^ACK,STOP') -and ($resp -match '^EVT,SAFE')
  $R['Safe stop (ขณะหมุน)'] = if ($okStop) { 'ACK,STOP + EVT,SAFE ✓' } else { 'ไม่ครบ: ' + ($resp -join ' | ') }
  $R['ล้อหยุดจริง'] = if (Ask 'ล้อหยุด (ค่อย ๆ หมุนฟรีจนหยุด) ไหม') { 'ใช่' } else { 'ไม่ ← ตรวจสาย/บอร์ด' }
  $resp = Send 'STATUS' 1500
  $R['STATUS หลังหยุด'] = (@($resp | Where-Object { $_ -match '^TM,RW_CMD' }) -join ' ')
}
catch { Write-Host "`nหยุด: $($_.Exception.Message)" -ForegroundColor Red; $R['หยุดกลางทาง'] = $_.Exception.Message }
finally {
  try { if ($sp.IsOpen) { $sp.WriteLine('STOP'); Start-Sleep -Milliseconds 300; $sp.Close() } } catch { }
  $md = @("# ผล Workshop T01 — NasaPakSoi ($stamp, พอร์ต $Port)", '', '| หัวข้อ | ผล |', '|---|---|')
  foreach ($k in $R.Keys) { $md += "| $k | $($R[$k]) |" }
  $md += ''; $md += 'ทิศ (convention): คำสั่ง + = ล้อหมุนตามที่จดข้างบน · ตัวเลขทั้งหมดเป็น % PWM ไม่ใช่ RPM · log ดิบ: ' + (Split-Path $logFile -Leaf)
  Set-Content -Path $mdFile -Value $md -Encoding UTF8
  Write-Host "`n===== สรุป T01 =====" -ForegroundColor Green
  $md | ForEach-Object { Write-Host $_ }
  Write-Host "`nบันทึกที่ $mdFile" -ForegroundColor Green
}
