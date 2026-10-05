# NasaSat protocol (firmware ↔ NasaSatLab)

ข้อความเป็นบรรทัด ASCII ปิดท้ายด้วย `\n` (ยอมรับ `\r\n`) ใช้ได้ทั้งจากเว็บ tool และ Serial Monitor ของ Arduino
ตัวจำลองในเว็บ, firmware หลัก และ `Fallback.ino` (ชุดย่อย) ใช้รูปแบบเดียวกัน

ช่องทาง: USB (หรือ UART ต่อคอม) เสมอ และ**ช่องที่สอง** (ไม่บังคับ) เมื่อ `SET com.tx <ขา>`: UART1 ต่อวิทยุแบบ serial
(HC-12, LoRa UART, XBee) หรือบอร์ดสะพาน ช่องที่สองได้สำเนาทุกบรรทัด (telemetry ที่อัตรา `com.lhz`, ภาพถ้า `com.limg 1`)
และรับคำสั่งได้เหมือน USB บรรทัดรอในบัฟเฟอร์ (64 KB ถ้ามี PSRAM, 8 KB ถ้าไม่มี) ส่งออกตามความเร็ววิทยุ ถ้าบัฟเฟอร์เต็ม
ทิ้ง**ทั้งบรรทัด** ไม่มีครึ่งบรรทัด และ loop ไม่รอวิทยุเลย ส่วนภาพจะรอจนแต่ละบรรทัดใส่บัฟเฟอร์ได้ทั้งบรรทัด จึงช้าเท่าวิทยุ
(320×240 ที่ 9600 baud ≈ 10 s) เครื่องมือเว็บใช้กับช่องที่สองได้โดยต่อตัวรับวิทยุเข้าคอมผ่าน USB-UART

## รูปแบบ

ส่งไปบอร์ด: `[@id] COMMAND args...`
- `@id` (ไม่บังคับ) เลขอ้างอิง บอร์ดจะใส่เลขเดียวกันในคำตอบ
- คำสั่งไม่สนตัวพิมพ์เล็กใหญ่ ชื่อค่าตั้ง (`est.alpha`) ต้องตรงตัว
- ขยะหรือ BOM หน้าคำสั่งถูกข้าม บรรทัดยาวสูงสุด 2400 ตัว (เกิน = `ERR LONG`)

บอร์ดตอบ/ส่งเอง:

| ขึ้นต้น | ความหมาย | ตัวอย่าง |
|---|---|---|
| `@id OK [ข้อความ]` | สำเร็จ | `@7 OK ctl.k=0.8` |
| `@id ERR code [ข้อความ]` | ไม่สำเร็จ | `@3 ERR RANGE ctl.k 0.1..1.5` |
| `TH,cols` | หัวตาราง telemetry | `TH,ms,m1,ang,th,err,D,S,v0,v1,en,fl` |
| `T,values` | telemetry (ค่าเริ่ม 20 ครั้ง/วินาที) | `T,1020,3,24.1,0.05,0.05,0.00071,8.12,2481.0,1938.2,1,1` |
| `J {json}` | ผลลัพธ์แบบมีโครงสร้าง มีฟิลด์ `type` | `J {"type":"raw",...}` |
| `E EVENT args` | เหตุการณ์ | `E M1 HOLD t=4379 it=5 err=-0.205 sd=0.054` (sd = noise ของค่าที่ใช้ตัดสิน) |
| `# ข้อความ` | ข้อความให้คนอ่าน | `# NasaSat firmware boot ...` |
| `IMG B/C/E` | ส่งภาพเป็นชิ้น | ดูหัวข้อภาพ |

## telemetry

`ms,m1,ang,th,err,D,S,v0,v1,en,fl`

| คอลัมน์ | ความหมาย |
|---|---|
| ms | เวลาบอร์ด (ms) |
| m1 | สถานะภารกิจ 1: 0 IDLE, 1 SEARCH, 2 FINE, 3 HOLD, 4 LOST |
| ang | มุมตัวขับ (องศา, นับจาก step) |
| th | มุมแสงเทียบแกนดาวเทียมที่ประมาณได้ |
| err | th − m1.tgt |
| D, S | ผลต่างปรับมาตรฐาน และความสว่างรวมหลังแปลง |
| v0, v1 | mV ของ LDR ซ้าย / ขวา |
| en | ขดลวดมอเตอร์มีไฟ (1/0) |
| fl | ธงรวม: 1 เห็นแสง (valid), 2 กำลังหมุน, 4 ADC ตัน, 8 นอกช่วงแม่น (edge), 16 มีงานรันอยู่, 32 กล้องตรึงแสง |

## คำสั่ง

### พื้นฐาน
| คำสั่ง | ผล |
|---|---|
| `HELLO` | `J hello` + OK |
| `HELP` | บรรทัด `#` + OK |
| `CFG LIST` | `J cfg` (ทุกค่า: k, t, v, d, min, max, step, u, g, desc, sv=ค่าที่ SAVE ไว้) + `OK 78` |
| `GET k` | `OK k=v` / `ERR KEY` |
| `SET k v` | `OK k=v` / `ERR KEY` / `ERR VAL` / `ERR RANGE k min..max` (ค่า i ถูกปัดเป็นจำนวนเต็ม) / `ERR PIN k=gpio เหตุผล` (ค่าขา: ต่อกับ flash/PSRAM/USB/UART0, ไม่มีขานี้, LDR/แบตบนขาที่ไม่ใช่ ADC, output บนขา input-only ของ ESP32 รุ่นเก่า) ถ้าสองค่าใช้ขาเดียวกัน รับค่าแต่ส่ง `E WARN PIN GPIOx k1 k2` |
| `SAVE` / `LOAD` / `DEFAULTS` | เก็บทุกค่าลง flash / อ่านจาก flash / ค่าเริ่มต้น (ยังไม่เก็บ) |
| `SAVE k1 k2 ...` | เก็บเฉพาะค่าที่ระบุ → `OK saved 2` (ค่าอื่นที่ยังทดลองอยู่ไม่ถูกเก็บ) ชื่อผิด = `ERR KEY` ไม่เก็บอะไรเลย |
| `STREAM ON [hz]` / `STREAM OFF` | เปิด (ส่ง `TH` ใหม่) / ปิด telemetry, hz นอก 0..100 = `ERR RANGE` |

### วัดแสง (ใช้ช่องงานเสริม ทำพร้อมภารกิจได้)
| คำสั่ง | ผล |
|---|---|
| `RAW [ms=200]` | `J raw` (มี `th_sd` = noise ของมุมต่อหน้าต่าง `sen.win`, `n` = จำนวนหน้าต่าง ใช้วัด noise: `RAW 1000`) |
| `AMB [ms=500]` | รอ LDR นิ่ง (สูงสุด 4 วินาที) แล้วตั้ง `est.aL/aR` → `J amb` (ปิดหลอดก่อน) |
| `BAL [ms=500]` | ตั้ง `est.g` ให้สองช่องเท่ากันตรงนี้ → `J bal` (หันตรงหลอดก่อน) |
| `CAL TH0 [ref=0]` | ของอ้างอิงภายนอกบอกว่าแสงอยู่ `ref` องศาจากแกนดาวเทียม → ปรับ `est.th0` และบันทึกค่านี้ค่าเดียวลง flash ทันที → `J th0` (`saved:true`) |

### ตัวขับ (ช่องงานหลัก ทีละงาน)
| คำสั่ง | ผล |
|---|---|
| `MOVE d` / `GOTO a` | หมุนสัมพัทธ์ / ไปมุม a (เกิน act.min/max = ตัดที่ขอบ + `E LIMIT`) |
| `ZERO` | มุมตอนนี้ = 0 |
| `STOP` | หยุดทุกงาน + มอเตอร์ และยกเลิกการเริ่มภารกิจ 1 อัตโนมัติที่รออยู่ (`E AUTO CANCELLED`) → `OK stopped` |
| `RELEASE` | ปล่อยขดลวด (หมุนมือได้) |
| `SWEEP a b step [dwell=300] [tag=cal]` | `J sweep_pt` ทีละจุด แล้ว `J sweep_end` |
| `BACKLASH` | ต้องหันเข้าหลอดก่อน → `J backlash` |
| `SPR` | ต้องหมุนได้ 360° (`act.max` − มุมตอนนี้ ≥ 365) → `J spr` ทำหลัง `BACKLASH` + ตั้ง `act.bl` (ถ้า `act.bl` = 0 ได้ `E WARN SPR ...`) |

### ภารกิจ
| คำสั่ง | ผล |
|---|---|
| `M1 START [tgt]` | เริ่มภารกิจ 1 (tgt นอก −80..80 = `ERR RANGE`) ถ้าไม่เห็นแสง: SEARCH หมุนต่อเนื่องไปทางที่เห็นแสงล่าสุด (หรือฝั่งที่เหลือมุมมากกว่า) หยุดทันทีที่เห็นแสงในมุมที่หมุนไปถึงได้ แล้วกวาดอีกฝั่งถ้าไม่เจอ; `ctl.adapt 1` เฉลี่ยนานขึ้น/ขยาย deadband เองเมื่อ noise สูง |
| `M1 STOP` | หยุดภารกิจ 1 |
| `STEP d` | ขณะ HOLD: ดันเบี้ยว d องศาแล้ววัดการกลับเข้าเป้า → `J step_result` (ไม่ HOLD = `ERR STATE`) |
| `M2 INIT` | เริ่มกล้องใหม่ตาม `cam.model` → `OK ok sensor PID 0x..` / `ERR CAM init fail 0x..` / `ERR CAM cam.model N not for this chip: <ขา> GPIOx <เหตุผล>` (ชุดขาของชิปอื่น เช่น ESP32-CAM บน ESP32-S3 ถูกปฏิเสธก่อนแตะขา flash) |
| `M2 LOCK` / `M2 UNLOCK` / `M2 MANUAL` | ตรึงแสงกล้องตามภาพตอนนี้ / อัตโนมัติ / ใช้ `cam.aec`, `cam.agc` |
| `M2 SNAP` | ถ่ายตรงนี้ (ช่องงานเสริม: ใช้ได้ขณะภารกิจ 1 ล็อก) |
| `M2 GO [tgt]` | หันกล้องไปมุม tgt เทียบศูนย์ตัวขับแล้วถ่าย (หยุดภารกิจ 1 ให้เอง) เข้าเป้าด้วยการหมุนทิศ `ctl.appr` เสมอ (ถ้าต้องหมุนอีกทาง จะเลยไป 2° แล้วย้อนเข้า) ภาพจึงชี้ตรงกันไม่ว่ามาจากทางไหน |
| `M2 GO SUN offset` | หาทิศดวงอาทิตย์ (จุดที่ค่าที่อ่านเป็นศูนย์ ถ้าได้ค่าสองฝั่งที่ห่างกันไม่เกิน 3° ใช้จุดตัดศูนย์ที่คำนวณจากสองค่านั้น) แล้วหันกล้องไป ทิศนั้น + offset แล้วถ่าย |

### ไม่ต้องต่อคอม (ค่าตั้ง ไม่ใช่คำสั่ง)
| ค่า | ผล |
|---|---|
| `m1.auto N` (+ `SAVE m1.auto`) | เปิดเครื่องแล้ว N วินาทีเริ่มภารกิจ 1 เอง: `E AUTO M1_IN N` ตอนบูต, `E AUTO M1_START` ตอนเริ่ม, `E AUTO SKIPPED busy_X` ถ้ามีงานอื่นทำอยู่, `STOP` ระหว่างรอ = `E AUTO CANCELLED` |
| `hw.btn G` (ค่าเริ่ม 0 = ปุ่ม BOOT) | กดปุ่ม (ต่อลง GND) = เริ่มภารกิจ 1 (`E BTN M1_START`) กดอีกครั้ง = หยุด (`E BTN M1_STOP`) กดค้างทำครั้งเดียว ต้องปล่อย 100 ms ก่อนกดใหม่ ถ้ากล้องใช้ขานี้ (ESP32-CAM: GPIO0 = XCLK) ปิดปุ่มเองพร้อม `E WARN BTN GPIO0_used_by_camera_button_off` |
| `com.hk N` | `J hk` ทุก N วินาที (0 = ปิด, ปิดด้วยเมื่อ `STREAM OFF`) |
| `hw.vbat G` + `hw.vdiv k` | อ่านแรงดันแบตผ่านวงจรแบ่งแรงดันบนขา ADC G: vbat_mv = mV ที่ขา × k |
| `com.tx G` (+ `com.rx`, `com.baud`, `com.lhz`, `com.limg`) | เปิดช่องที่สองบน UART1 (`E LINK ON rx=.. tx=.. baud=..`) `com.tx -1` = ปิด |

### ตาราง LUT และระบบ
| คำสั่ง | ผล |
|---|---|
| `CAL LUT x0 dx v0,v1,...` | ตั้งตารางแก้มุม (สูงสุด 256 ค่า) ผิดรูปแบบ = `ERR ARG ... (เหตุผล)` ตารางเดิมไม่เปลี่ยน |
| `CAL CLR` / `CAL GET` | ล้าง / `J cal` (lut + ค่า est ทั้งหมด) |
| `HWID [I2C]` | `J hwid` (สแกน I2C ที่ `hw.sda/hw.scl` ถ้าขาไม่ชนกับ LDR/มอเตอร์/กล้อง/ปุ่ม/ช่องที่สอง) |
| `PINFIND ON` / `OFF` | `J pins` ทุก 200 ms: mV ของ GPIO1–18 (ข้ามขาที่มอเตอร์/กล้อง/ปุ่ม/ช่องที่สองใช้ การอ่าน ADC บนขาพวกนั้นจะทำให้มันเลิกทำงาน) |
| `DIAG` | `J diag` สรุปสถานะเป็นบรรทัด ๆ |
| `REBOOT` | `OK rebooting` แล้วรีสตาร์ต |
| `IMG GET id seq,seq,...` | ส่งชิ้นภาพซ้ำ + `IMG E id` (ไม่มีในหน่วยความจำ = `ERR IMG not_cached`) |

รหัส ERR: `CMD` ไม่รู้จักคำสั่ง, `ARG` อาร์กิวเมนต์ผิด, `KEY` ไม่มีค่านี้, `VAL` ไม่ใช่ตัวเลข, `RANGE` นอกช่วง, `PIN` ใช้ขานี้ไม่ได้, `BUSY` มีงานอื่นอยู่ (ตามด้วยชื่องาน), `STATE` สถานะไม่ถูก, `CAM` กล้องไม่พร้อม, `IMG` ไม่มีภาพ, `LONG` บรรทัดยาวเกิน

## JSON (`J {...}`)

| type | ฟิลด์หลัก |
|---|---|
| `hello` | fw, ver, board, proto (=1), caps (เพิ่ม `hk`, `auto`, `btn`, `link`) |
| `cfg` | items[] |
| `hwid` | chip, rev, cores, cpu_mhz, flash_mb, psram_mb, core, fw, reset, uptime_ms, free_heap, camera, actuator, ldr_pins, uln_pins, btn (ขาปุ่มที่ใช้อยู่, -1 = ปิด), link ("off" หรือ "rx=.. tx=.. baud=.."), i2c |
| `hk` | t, temp_c (อุณหภูมิชิป, ESP32 รุ่นเก่า = null), heap, heap_min (ต่ำสุดตั้งแต่บูต), loop_max_ms (loop ทำงานนานสุดตั้งแต่ hk ก่อน), vbat_mv (null ถ้า `hw.vbat -1`), m1, btn, [link{lines, drop, queued}] |
| `diag` | lines[] |
| `pins` | t, mv{gpio: mV} |
| `raw` | mv[2], G[2], D, S, th, valid, sat, edge, ang, th_sd, n |
| `amb` | aL, aR, mv[2] |
| `bal` | g, S, suggest_minS |
| `th0` | old, new, th_before, ref, saved |
| `sweep_pt` | tag, ang, mv[2], G[2], D, S, th, sat |
| `sweep_end` | tag, n |
| `step_result` | deg, t_lock_ms, iters, peak_err, final_err |
| `backlash` | deg, fwd, bwd |
| `spr` | steps, cfg |
| `cal` | lut{x0,dx,v[]} หรือ null, est{...} |
| `cam` | locked, aec, agc |
| `sun_ref` | sun_az, offset |
| `snap_fail` | reason (`target_out_of_range` / `not_in_tol`), tgt, aim, ang, min, max, tol, err_cmd |
| `img_meta` | id, t_ms, w, h, bytes, q, ang, cam_az_cmd, tgt, err_cmd, tol, in_tol, m1, th, locked, aec, moving, ref, hm, vf, cam_dir, hfov, [sun_az, offset] |

`err_cmd` = (มุมตัวขับจาก step + cam.off) − เป้า เป็น**ค่าที่สั่ง** ไม่ใช่มุมที่วัดจริง
`hm`/`vf` = ภาพนี้ถ่ายตอนกลับซ้าย-ขวา/บน-ล่างอยู่ไหม, `cam_dir`/`hfov` = ทิศภาพและมุมรับภาพตอนถ่าย: เว็บใช้แปลงตำแหน่งบนภาพเป็นมุม
มุมของจุด x บนภาพกว้าง W: `az = cam_az_cmd + s·atan((W/2 − x)/f)`, `f = (W/2)/tan(hfov/2)`, `s = cam_dir × (hm ? −1 : 1)`

## Event (`E ...`)

| event | ตัวอย่าง |
|---|---|
| `BOOT` | `E BOOT POWERON` (SOFTWARE, PANIC, TASK_WDT, BROWNOUT, ...) |
| `PROC` | `E PROC SWEEP START`, `E PROC SWEEP END`, `E PROC SWEEP ABORT` |
| `M1` | `E M1 FINE start`, `E M1 HOLD t=4379 it=5 err=-0.205 sd=0.054` (sd = noise ของค่าที่ใช้ตัดสิน), `E M1 FINE reacquire`, `E M1 LOST adc_saturated`, `E M1 IDLE m2_takeover` |
| `M1TRIM` | `E M1TRIM err=-0.678 move=-0.576` ขณะ HOLD error เกิน `ctl.db` ติดกัน `ctl.trim` ครั้ง → ขยับแก้โดยยัง HOLD |
| `LIMIT` | `E LIMIT 250.00` (สั่งเกิน act.min/max) |
| `AUTO` | `E AUTO M1_IN 5`, `E AUTO M1_START`, `E AUTO CANCELLED`, `E AUTO SKIPPED busy_SWEEP` |
| `BTN` | `E BTN M1_START`, `E BTN M1_STOP` |
| `LINK` | `E LINK ON rx=21 tx=14 baud=9600` |
| `FAULT` | `E FAULT SNAP target_out_of_range`, `E FAULT SNAP no_frames` (กล้องตอบแต่ไม่ส่งภาพ), `E FAULT TH0 no_light`, `E FAULT ACT servo_pwm_attach_failed pin=42`, `E FAULT LINK no_memory` |
| `WARN` | `E WARN AMB still_drifting_after_4s`, `E WARN PIN GPIO1 sen.pin1 sen.pin0`, `E WARN SPR act.bl_is_0_run_BACKLASH_and_set_act.bl_first`, `E WARN BTN GPIO0_used_by_camera_button_off` |

## ภาพ

```
J {"type":"img_meta","id":3,...}
IMG B <id> <bytes> <nchunks> <crc32 hex>
IMG C <id> <seq> <base64 ของ 480 ไบต์>      (ทีละชิ้น)
IMG E <id>
```
ผู้รับประกอบชิ้นตามลำดับ ตรวจ CRC32 ถ้าขาดส่ง `IMG GET id seq,...` (tool ทำให้เองสูงสุด 3 รอบ ถ้ายังขาดจะรายงานภาพเสีย)
640×480 ประมาณ 25 KB: ผ่าน USB ในตัว ESP32-S3 เร็วมาก, ผ่านชิป USB-UART 115200 baud ประมาณ 3 วินาที,
ผ่านวิทยุ 9600 baud ช่องที่สองประมาณ 32 วินาที (320×240 ประมาณ 10 วินาที) `img_meta` และ `IMG B` ออกจาก `cam::pump()`
ใน loop ถัดไปหลังถ่าย (รอที่ว่างในบัฟเฟอร์ของช่องที่สองเหมือนชิ้นภาพ) จึงอาจมาหลัง `E PROC SNAP END`

## CRC บรรทัด (ไม่บังคับ)

tool รับบรรทัดที่ต่อท้าย `*XXXX` (CRC-16/CCITT-FALSE ของข้อความก่อน `*`) และทิ้งบรรทัดที่ CRC ผิด firmware ตอนนี้ยังไม่ส่ง CRC (USB มีตรวจความถูกต้องอยู่แล้ว)
