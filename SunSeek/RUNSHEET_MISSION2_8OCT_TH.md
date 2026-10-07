# ภารกิจ 2 (ถ่ายรูปตามมุม) — ขั้นตอนวันซ้อม 8 ต.ค.

เฟิร์มแวร์ **team-7** (commit e7e052d) ยังไม่ได้อัปเข้าบอร์ด ตอนนี้บอร์ดยังเป็น team-5
ทุกขั้นต้องอยู่ MANUAL ยกเว้นตอนที่ภารกิจกำลังวิ่ง และ **อัปเฟิร์มแวร์ได้หลังผู้ใช้พิมพ์ "อัปได้" เท่านั้น**

## 0. ก่อนอัป
- `TEAM_INFO` → ต้องเห็น `NasaPakSoi-team-5` และ `UNSAVED,0`
- `TEAM_LIST` → เก็บ log ไว้เทียบค่า
- ค่าที่ควรเห็น: kp 4, kd 2, max 60, lock 1.5, unlock 3, wrap 1, miss 5, est.wrap 1

## 1. อัป team-7 (ขอ "อัปได้" ก่อน)
```
node C:\TYSC\SunSeek\tools\compile_sunseek.js
arduino-cli upload -p COM7 --fqbn esp32:esp32:esp32s3:CDCOnBoot=default --input-dir "$env:TEMP\sunseek_compile\team" C:\TYSC\SunSeek\team\SunSeek_Platform_Firmware_v3_0
```
- `TEAM_INFO` → ต้องเห็น `NasaPakSoi-team-7`, `UNSAVED,0` และ `BOOT,<เหตุ>,UP_S,<วินาที>`
- `TEAM_LIST` → ค่าที่บันทึกไว้ต้องอยู่ครบเหมือนข้อ 0

## 2. ตั้งค่าภารกิจ (MANUAL)
```
TEAM_SET,mis.on,1
TEAM_SET,adcs.keepTune,1
TEAM_SET,adcs.ghold,1
TEAM_SAVE
```
- `adcs.ghold 1` = เป้าที่เลยมุมที่เซนเซอร์แสงเห็น ยานจะใช้ไจโรนับมุมต่อ (จำลอง: ghold 0 + เป้า 75/85° → ยานหมุนไม่หยุด; ghold 1 → ถึงเป้าทั้ง 60/75/85°)
- ลองบนแท่น: `TEAM_MIS_GO,0,70,0` แล้วดู Live View ว่าที่ 70° หันไปถูกทิศจริงไหม
- `mis.on 1` = ทีมเราตอบปุ่มในแท็บ Competition เอง
- `adcs.keepTune 1` = GS ส่ง `ADCS_TUNE` มาก็ไม่ทับ kp/kd ของเรา จะเห็น `EVT,TEAM_KEEP_TUNE,IGNORED,...`

## 3. ถามผู้จัด (จดคำตอบไว้)
1. มุมเป้าหมายในภารกิจ 2 วัดจากเซนเซอร์แสง (ด้านหน้า) หรือจากกล้อง (ด้านซ้าย ห่าง ~90°)?
2. วันแข่งใช้แท็บ Competition ของ GS ไหม? ค่า tolerance และ hold ที่จะใช้คือเท่าไหร่?
3. กรรมการตัดสินจากอะไร: รูป, มุมใน GS หรือเวลา?
4. GS ดึงรูปจากกล้องผ่าน Wi-Fi ของกล้อง → ต้องให้โน้ตบุ๊กต่อ AP ของกล้องตลอดภารกิจใช่ไหม?

## 4. ตรวจกล้อง
- ต่อ Wi-Fi กล้อง: `netsh wlan connect name="SUNSEEK-PAYLOAD-NasaPakSoi"`
- `PAYLOAD_STATUS` → ต้องตอบ
- `CAPTURE` → ต้องได้ `IMAGE_READY,/IMG_xxxx.JPG,...`

## 5. ลองด้วยคำสั่งเราก่อน (ไม่ต้องใช้แท็บ Competition)
```
TEAM_MIS_GO,20,-20,0
```
- ดูบรรทัด `EVT,TEAM_MIS,CAPTURE,<i>,<ครั้งที่>,ERR,<e>,RATE,<r>,TGT,<มุม>`
  - ERR ควรไม่เกิน 1.5 ถ้าเกินแปลว่ารอครบ `mis.waitMs` แล้วถ่ายเลย
- จบแล้วต้องเห็น `MISSION,STATE,COMPLETE` ยานยังอยู่ AUTO ที่เป้าสุดท้าย → พิมพ์ `STOP`
- ถ้าบอร์ดต่อ USB อยู่ → `TEAM_CDUMP` เก็บ black box ไว้ดู

## 6. แท็บ Competition ของ GS
- ช่องค่า: Reference SUN, Strategy REACTION, kp 4 / kd 2 / bias 40 (ถึงพิมพ์ผิด keepTune ก็กันไว้), Transfer EACH, เป้า 2–3 แถว (เช่น 20 / −20 / 0, tol 3, hold 2)
- กด **PREPARE** → ปุ่ม START ต้องกดได้, log มี `MISSION,READY` และ `MISSION,PREP,3 targets SUN EACH cam OK`
  - ถ้า START ยังกดไม่ได้: ดู log ว่ามี `ERR,...` ไหม แล้วกด PREPARE ซ้ำ
- กด **START** → สถานะต้องไล่ ACQUIRING → STABILIZING → CAPTURING ทีละเป้า และรูปต้องขึ้นในแผงของ GS
- จบแล้วต้องเห็น COMPLETE และเวลาใน `MISSION,TIMER,STOP,<ms>`

## 7. ทดสอบหยุด
- เริ่มภารกิจใหม่ แล้วกด **ABORT** ระหว่างยานกำลังหมุน → ต้องเห็น `ACK,ABORT` + `MISSION,STATE,ABORTED` และล้อหยุด
- ลองซ้ำด้วย `STOP` → ผลต้องเหมือนกัน

## 8. ถ้าผลไม่ดี (ปรับด้วย TEAM_SET ได้ ไม่ต้องอัปใหม่)
| อาการ | ปรับ |
|---|---|
| ERR ตอนถ่ายเกิน 1.5 บ่อย | `mis.capErr` 2 หรือ `adcs.unlock` 2 |
| ถ่ายตอนยังหมุนอยู่ / รูปเบลอ | `mis.capRate` 1 |
| กล้องตอบช้ากว่า 6 s | `mis.capMs` 10000 |
| GS ไม่โหลดรูปเป้า 2 | `mis.gap` 4000 |
| ผู้จัดบอกว่ามุมวัดจากกล้อง | `cam.off` ±90 (ดูทิศจาก Live View + BORESIGHT ก่อน) → เซนเซอร์แสงจะไม่เห็นหลอด → ต้องลองกับ `adcs.ghold 1` |

## 9. ตัวช่วยถ้าทุกอย่างพัง
- `TEAM_SET,mis.on,0` → กลับไปเป็นแบบผู้จัด (ตอบ `ERR,MISSION_NOT_AVAILABLE_T04`)
- หรือทำเองทีละเป้า: `SET_TARGET,<มุม>` → `ADCS_MODE,AUTO` → รอนิ่ง → `CAPTURE`

## 10. ปิดงาน
`STOP` → `ADCS_MODE,MANUAL` → `TEAM_SAVE` → `TEAM_INFO` ต้องเห็น `UNSAVED,0`
