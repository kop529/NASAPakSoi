<#
  board.ps1 - ให้ AI (หรือคน) ส่งคำสั่งเข้าบอร์ด NasaSat ทาง Serial แล้วอ่านคำตอบกลับมาเป็นข้อความ
  ใช้แทนเว็บ tool ตอนที่ AI ต้องคุยกับบอร์ดเอง (พอร์ตใช้ได้ทีละโปรแกรม: ต้องกด "ตัดการเชื่อมต่อ" ในเว็บ
  และปิด Serial Monitor ของ Arduino IDE ก่อนทุกครั้ง)

  ตัวอย่าง
    powershell -File C:\TYSC\NasaSat\ai\board.ps1 -List
    powershell -File C:\TYSC\NasaSat\ai\board.ps1 -Cmd HELLO,HWID
    powershell -File C:\TYSC\NasaSat\ai\board.ps1 -Port COM10 -Cmd 'RAW 1000' -Wait 2500
    powershell -File C:\TYSC\NasaSat\ai\board.ps1 -Listen 5000 -ShowT     (ฟังเฉย ๆ 5 วินาที รวม telemetry)

  หมายเหตุ
    - ไม่ใส่ @id ให้เอง ถ้าต้องการจับคู่คำตอบให้พิมพ์ '@7 GET ctl.k' เอง
    - บรรทัด telemetry (T,...) ถูกซ่อนโดยปริยาย แสดงแค่จำนวน + บรรทัดล่าสุด ใช้ -ShowT เพื่อดูทั้งหมด
    - DTR/RTS ปล่อยต่ำไว้ (บอร์ดที่มีวงจร auto-reset จะไม่รีเซ็ตตอนเปิดพอร์ต) ถ้าบอร์ด USB ในตัวเงียบ ลอง -Dtr
    - ทุกครั้งที่รันจะเก็บ log ไว้ที่ ai\logs\ (หลักฐาน)
#>
param(
  [string]$Port = '',
  [string[]]$Cmd = @(),
  [int]$Wait = 1000,      # ms ที่รอฟังหลังส่งแต่ละคำสั่ง
  [int]$Listen = 0,       # ms ที่ฟังต่อหลังคำสั่งสุดท้าย (หรือฟังเฉย ๆ ถ้าไม่มี -Cmd)
  [int]$Baud = 115200,
  [switch]$ShowT,
  [switch]$Dtr,
  [switch]$List
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

function Get-BoardPorts {
  # VID: 303A = USB ในตัว ESP32-S3, 10C4 = CP210x, 1A86 = CH340/CH343
  Get-CimInstance Win32_PnPEntity -Filter "PNPClass='Ports'" | ForEach-Object {
    if ($_.Name -match '\((COM\d+)\)') {
      $vid = if ($_.PNPDeviceID -match 'VID_([0-9A-F]{4})') { $Matches[1] } else { '' }
      $kind = switch ($vid) { '303A' { 'ESP32-S3 USB ในตัว' } '10C4' { 'CP210x' } '1A86' { 'CH340/CH343' } default { 'อื่น ๆ' } }
      [pscustomobject]@{ Port = $Matches[1]; VID = $vid; Kind = $kind; Name = $_.Name }
    }
  }
}

$ports = @(Get-BoardPorts)
if ($List) {
  if ($ports.Count -eq 0) { 'ไม่เห็นพอร์ตเลย: เช็กสวิตช์บอร์ด / สาย USB (บางเส้นชาร์จอย่างเดียว) / ไดรเวอร์' }
  else { $ports | Format-Table -AutoSize | Out-String }
  return
}

if (-not $Port) {
  $cand = @($ports | Where-Object { $_.VID -in '303A', '10C4', '1A86' })
  if ($cand.Count -eq 0) { throw 'หาพอร์ตบอร์ดไม่เจอ: ใช้ -List ดูพอร์ตทั้งหมด แล้วระบุ -Port COMx' }
  if ($cand.Count -gt 1) { "เจอหลายพอร์ต ใช้ตัวแรก: $(($cand | ForEach-Object { "$($_.Port)[$($_.Kind)]" }) -join ', ')" }
  $Port = $cand[0].Port
}

$logDir = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$logFile = Join-Path $logDir ("{0:yyyyMMdd_HHmmss}_{1}.log" -f (Get-Date), $Port)

$sp = New-Object System.IO.Ports.SerialPort $Port, $Baud, 'None', 8, 'One'
$sp.NewLine = "`n"
$sp.DtrEnable = [bool]$Dtr
$sp.RtsEnable = $false
$sp.ReadTimeout = 50
$sp.Encoding = [Text.Encoding]::UTF8
try { $sp.Open() }
catch { throw "เปิด $Port ไม่ได้ ($($_.Exception.Message)) — มีโปรแกรมอื่นถือพอร์ตอยู่? กด 'ตัดการเชื่อมต่อ' ในเว็บ / ปิด Serial Monitor" }

$script:buf = ''
$script:tCount = 0
$script:tLast = ''
$script:thHeader = ''

function Pump([int]$ms) {
  $end = [DateTime]::Now.AddMilliseconds($ms)
  while ([DateTime]::Now -lt $end) {
    try { $chunk = $sp.ReadExisting() } catch { $chunk = '' }
    if ($chunk) {
      $script:buf += $chunk
      while (($i = $script:buf.IndexOf("`n")) -ge 0) {
        $line = $script:buf.Substring(0, $i).TrimEnd("`r")
        $script:buf = $script:buf.Substring($i + 1)
        if (-not $line) { continue }
        Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
        if ($line.StartsWith('T,')) {
          $script:tCount++; $script:tLast = $line
          if ($ShowT) { $line }
        } elseif ($line.StartsWith('TH')) {
          $script:thHeader = $line
          if ($ShowT) { $line }
        } else { $line }
      }
    } else { Start-Sleep -Milliseconds 20 }
  }
}

try {
  "# $Port @ $Baud  (log: $logFile)"
  Pump 300   # ทิ้ง/แสดงของที่ค้างในบัฟเฟอร์ก่อน
  foreach ($c in $Cmd) {
    ">> $c"
    Add-Content -LiteralPath $logFile -Value ">> $c" -Encoding UTF8
    $sp.Write($c + "`n")
    Pump $Wait
  }
  if ($Listen -gt 0) { Pump $Listen }
  if (-not $ShowT -and $script:tCount -gt 0) {
    "# telemetry: $($script:tCount) บรรทัด (ซ่อนไว้ ใช้ -ShowT)"
    if ($script:thHeader) { "# $($script:thHeader)" }
    "# ล่าสุด: $($script:tLast)"
  }
}
finally { if ($sp.IsOpen) { $sp.Close() } }
