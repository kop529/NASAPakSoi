# ชุด 0 แก้เสร็จ (1 ต.ค. 2569)

ไฟล์เดิมก่อนแก้สำรองไว้ที่ `backup/2026-10-01_before_batch0/` (firmware + tool) ถ้าต้องย้อนคัดลอกกลับได้ทั้งโฟลเดอร์

## สิ่งที่แก้

| เรื่อง | มาจาก | แก้อย่างไร | ไฟล์ |
|---|---|---|---|
| firmware หลัก compile ไม่ผ่านกับ core จริง | Opus F01 | เปลี่ยนชื่อ `stat` → `camStat` | `camera.cpp` |
| Fallback compile ไม่ผ่าน | Opus F02 | ย้าย `struct Reading` ขึ้นก่อนฟังก์ชันแรก | `Fallback.ino` |
| ตัวทดสอบบนคอมมองไม่เห็นสองข้อข้างบน | Opus F03 | mock include `sys/stat.h` และ `build.js` แทรก prototype แบบ Arduino IDE ตอนนี้โค้ดเดิมทั้งสองไฟล์ build บนคอมไม่ผ่านด้วย error เดียวกับของจริง | `host_test/mock/Arduino.h`, `host_test/build.js` |
| ไม่มีด่าน compile ด้วย core จริง | Opus F03, Sonnet F01 | สคริปต์ใหม่ใช้ arduino-cli ที่มากับ Arduino IDE (ไม่ต้องติดตั้งเพิ่ม) | `firmware/tools/compile_check.js` |
| ชื่อ `LINE_MAX` อาจชนกับ limits.h | Sonnet F15 | เปลี่ยนเป็น `CMD_LINE_MAX` | `features.h`, `proto.*`, `app.cpp` |
| Space ไม่ STOP เมื่อโฟกัสอยู่บนปุ่ม และกดปุ่มนั้นซ้ำ | Sonnet F06, แผน UI Q1 | Space = STOP ทุกที่ยกเว้นช่องพิมพ์ข้อความ, Esc = STOP ทุกที่, กัน Space ไม่ให้กดปุ่ม | `09_app.js` |
| ตั้งขาที่ต่อ flash/PSRAM/USB แล้ว SAVE → บอร์ดพังทุกบูต | Opus F17, Sonnet F10 | `SET` ตอบ `ERR PIN เหตุผล` (26–32, 33–37 ถ้า OPI PSRAM, 19/20 ถ้า USB CDC, 43/44 ถ้า UART, 22–25 ไม่มีจริง, LDR ต้องเป็นขา ADC) ค่าที่ SAVE ไว้ผิดจะไม่ถูกโหลดตอนบูต สองค่าใช้ขาเดียวกันได้ `E WARN PIN` ตัวจำลองในเว็บทำเหมือนกัน | `cfg.cpp`, `commands.cpp`, `07_sim.js` |
| CAL TH0 ไม่ SAVE เอง | Opus F13 | บอร์ดบันทึก `est.th0` ค่าเดียวลง flash ทันที (`"saved":true`) ค่าอื่นที่ยังไม่ SAVE ไม่ถูกบันทึกตาม | `cfg.cpp` (`saveKey`), `procs.cpp`, `07_sim.js`, `09_app.js` |
| ตอน HOLD ปล่อย error ค้างได้เกือบ 1° | Opus F09 | ค่าใหม่ `ctl.trim` (ค่าเริ่ม 3): error เกิน `ctl.db` ติดกัน 3 ครั้ง → ขยับแก้ด้วยค่าเฉลี่ยโดยยัง HOLD (`E M1TRIM`) ไม่ลด `ctl.hys` ตามแผนเดิม เพราะ e2e แสดง error ค้าง 0.44° ซึ่ง hys 0.5 ก็ไม่แก้ และจะทำให้ HOLD กระพริบเมื่อ noise สูง | `procs.cpp`, `06_cfgdefs.js`, `07_sim.js`, Fallback ทำแบบง่าย |
| กล้องไม่ส่งภาพ → loop ค้าง ~12 s → watchdog รีเซ็ต | Opus F12 | เลิกที่เฟรมแรกที่หมดเวลา → `E FAULT SNAP no_frames` | `camera.cpp` |
| Fallback วัดทันทีหลังมอเตอร์หยุด | Opus F11 | รอ `ctl.wait` นับจาก step สุดท้าย ผล: คลาดจริง 0.895° → 0.617° | `Fallback.ino` |
| warning `comp_--` บนตัวแปร volatile | เจอตอน compile จริง | `comp_ = comp_ - 1` ตอนนี้ compile ทุกแบบไม่มี warning | `stepper.cpp` |

## สิ่งที่เจอเพิ่มระหว่างทดสอบ (ไม่มีใน audit)

1. **ผล 106/106 เดิมผ่านเพราะ seed ของ noise** เพิ่ม `E2E_SEED=n` ให้ e2e ลองหลาย seed ได้ เมื่อรันโค้ดเดิมกับ seed 1–4 พบว่า SPR คลาด 7–17 step ใน 3 ใน 4 seed และข้อ "หลอดหรี่ 55%" ไม่ผ่าน 2 ใน 4 seed
2. **SPR ต้องทำหลัง BACKLASH + ตั้ง act.bl** เอกสาร firmware เดิมให้ทำ SPR ก่อน (ส่วน tool README ให้ทำทีหลัง ขัดกัน) ถ้า act.bl = 0 จุดศูนย์สองครั้งอาจอยู่คนละฝั่งของระยะฟรีเฟือง ตอนนี้ทุกเอกสารเรียง BACKLASH → SPR และบอร์ดเตือน `E WARN SPR` ถ้า act.bl = 0
3. **null-seek วนไม่จบ** เมื่อทำตามลำดับที่ถูก (act.bl ตั้งแล้ว เซนเซอร์ยังไม่คาลิเบรต มุมอ่านได้ ~1.6 เท่าของจริง) การเข้าเป้าจากทิศเดียว (ctl.appr) กับการแก้เกินวิ่งไล่กันรอบศูนย์จน `null_not_converged` แก้: ถ้าการแก้ปกติข้ามศูนย์ ลด gain ลงครึ่ง ตอนนี้ SPR = 4076/4075/4076/4076 ใน 4 seed (ลองแบบ "บังคับเข้าจากฝั่งเดียว" แล้วแย่ลง จึงไม่ใช้)
4. **ข้อ "หลอดหรี่ 55%" แยกเป็นสองข้อ** ข้อเดิมรวมสองเรื่อง: ความเพี้ยนของเซนเซอร์ (bias) กับตำแหน่งที่ล็อกในช่วง ±ctl.db ตอนนี้วัด bias ตรง ๆ ได้ −0.51 ถึง −0.54° ทุก seed ตำแหน่งจริงคลาดได้ถึง 0.79° นี่คือ F04 ของ Opus ต้องแก้ในชุด 1

## ผลทดสอบหลังแก้

| ชุด | ผล |
|---|---|
| `node firmware/tools/compile_check.js --all` (esp32 core 3.3.5 จริง) | ผ่าน 6/6 แบบ ไม่มี warning: S3 CDC+OPI 486,583 B, S3 UART ไม่มี PSRAM, TinyUSB, ESP32-CAM, Fallback ×2 |
| `e2e.js` core 3.x | 120/120 ที่ seed เริ่มต้น, 1, 2, 3 |
| `e2e.js --core2` | 120/120 |
| `fallback_test.js` | 11/11 |
| `tool/tests/run_tests.js` | 60/60 |
| `docs/check_formulas.py` | 45/45 |
| เบราว์เซอร์จริง (ตัวจำลอง) | กด START แล้ว Space → ส่ง STOP ครั้งเดียว M1 หยุด ไม่ START ซ้ำ; พิมพ์ในช่องคำสั่งยังเว้นวรรคได้ |

เอกสารที่อัปเดตตาม: `firmware/README.md`, `PROTOCOL.md`, `CONTEXT_PACK.md`, `INSTALL_CHECKLIST.md` (core 3.3.5), `TEST_PLAN.md`, `CONFIG_KEYS.md` (64 ค่า), `tool/README.md`, `docs/THEORY_TH`, `PLAYBOOK_TH`, `CHEATSHEET_TH` (.md/.html/.pdf), `PLAN.md`

## ยังเหลือ (ชุด 1–3)
- F04 ความเพี้ยนตามความสว่างหลอด ~0.5° (วัดได้แล้วใน e2e) → q ร่วม + γ จากแสงสองระดับ
- ข้อสังเกตที่ยังไม่ได้ทดสอบ: ภารกิจ 1 ก่อนคาลิเบรตเซนเซอร์ใช้การเข้าเป้าแบบเดียวกับ null-seek จึงอาจวนได้แบบเดียวกัน (หลังคาลิเบรตมุมอ่านได้ใกล้ของจริง จึงไม่น่าเป็น) ควรทดสอบและใส่การลด gain แบบเดียวกันในชุด 1
- ที่เหลือตามแผนเดิม: หาแสงเร็วขึ้น, ปรับตาม noise, M1 มุมเป้า ≠ 0, ภารกิจ 2 คลิกภาพ/preset ESP32-CAM/กลับภาพ, โหมดไม่ต่อสาย, auto-reconnect, UI
