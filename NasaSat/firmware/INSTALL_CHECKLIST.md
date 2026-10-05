# เตรียมเครื่องแข่ง (ทำให้เสร็จก่อนวันที่ 5 ต.ค.)

ทำบน**โน้ตบุ๊กที่จะใช้แข่งจริง** (1 ต.ค. 2569: compile ด้วย esp32 core **3.3.5** ตัวจริงผ่านแล้วทั้ง NasaSat และ Fallback บนเครื่องที่เขียนโค้ด ด้วย `node firmware/tools/compile_check.js`)
ทุกข้อยกเว้นข้อ 5 **ทำได้โดยยังไม่มีบอร์ด**

## 1. โปรแกรม
- [ ] Arduino IDE 2.3.x (ตัวล่าสุด) จาก arduino.cc
- [ ] Boards Manager → ค้น `esp32` → **esp32 by Espressif Systems** เลือกเวอร์ชัน **3.3.5** (ตัวที่พิสูจน์แล้วว่า compile ผ่าน ถ้าผู้จัดกำหนดเวอร์ชันให้ใช้ตามผู้จัด)
  - โค้ดรองรับทั้ง core 2.0.x และ 3.x (ทดสอบ API ทั้งสองแบบบนคอมแล้ว) ถ้า 3.3.5 มีปัญหา ลอง 3.2.x หรือ 2.0.17 (2.x ทดสอบได้เฉพาะบนคอม ยังไม่เคย compile จริง)
  - **จดเวอร์ชันที่ผ่านไว้** แล้วห้ามกดอัปเดตจนจบงาน
- [ ] Chrome หรือ Edge (Web Serial) เปิด `tool/NasaSatLab.html` ได้ (ดับเบิลคลิก ไม่ต้องใช้เน็ต)
- [ ] ไดรเวอร์ USB-UART เผื่อบอร์ดผู้จัดใช้ชิปแปลง: CH340/CH343 (WCH) และ CP210x (Silicon Labs) ถ้าเป็น USB ในตัว ESP32-S3 (VID 303A) ไม่ต้องลง
- [ ] Node.js (ไม่บังคับ ใช้รันตัวทดสอบบนคอม)

## 2. คัดลอกไฟล์
- [ ] คัดลอกทั้งโฟลเดอร์โปรเจกต์ไปไว้ที่ **path สั้น ไม่มีภาษาไทย ไม่มีช่องว่าง** เช่น `C:\TYSC\` (Arduino IDE บางเวอร์ชันมีปัญหากับ path ยาว/อักษรพิเศษ)
- [ ] สำรองไว้ใน USB drive อีกชุด

## 3. ตั้งค่าบอร์ดใน Arduino IDE (เมนู Tools)

| ตัวเลือก | ค่า | หมายเหตุ |
|---|---|---|
| Board | **ESP32S3 Dev Module** | |
| USB CDC On Boot | **Enabled** ถ้าเสียบสายเข้าพอร์ต USB ของ ESP32-S3 เอง (VID 303A) / **Disabled** ถ้าบอร์ดมีชิป CH340/CP210x | ตั้งผิด = เชื่อมต่อได้แต่เงียบ |
| USB Mode | Hardware CDC and JTAG | |
| PSRAM | **OPI PSRAM** ถ้าโมดูลเขียน N8R8/N16R8, **QSPI PSRAM** ถ้า N4R2/N8R2, ไม่มี R = **Disabled** | ดูตัวอักษรบนฝาเหล็กของโมดูล ตั้งผิดอาจรีเซ็ตวน → ลอง Disabled |
| Flash Size | ตามโมดูล (N16 = 16MB, N8 = 8MB, N4 = 4MB) | |
| Partition Scheme | Default | firmware ใช้ไม่ถึง 1.2 MB |
| Erase All Flash Before Sketch Upload | **Disabled** | ถ้า Enabled ค่าคาลิเบรตที่ SAVE ไว้จะหายทุกครั้งที่อัปโหลด |
| Core Debug Level | None | |
| Upload Speed | 921600 (ถ้าอัปโหลดพลาดลด 460800) | |

## 4. Compile โดยไม่ต้องมีบอร์ด (สำคัญที่สุด ทำวันนี้เลย)
- [ ] เปิด `firmware/NasaSat/NasaSat.ino` → กด **Verify (✓)** → ต้องขึ้น "Done compiling" จดขนาด sketch และ RAM
- [ ] เปิด `firmware/Fallback/Fallback.ino` → Verify ผ่าน
- [ ] ถ้าไม่ผ่าน: ตรวจก่อนว่าใช้ไฟล์ล่าสุด (รุ่นก่อน 1 ต.ค. มีบั๊ก `stat` ใน camera.cpp และลำดับ struct ใน Fallback.ino ที่ทำให้ compile ไม่ผ่าน) แล้วส่งข้อความ error ให้ AI ช่วยดู `ENABLE_CAMERA 0` ใช้เป็นทางสุดท้ายเท่านั้น เพราะภารกิจ 2 จะหายทั้งภารกิจ
- [ ] ลอง Verify ทั้งสองแบบ: USB CDC On Boot = Enabled และ Disabled (ใช้ Serial คนละชนิด)

ทางเลือก: `node firmware/tools/compile_check.js` ใช้ arduino-cli ที่มากับ Arduino IDE 2.x ตรวจ compile ทุกแบบในคำสั่งเดียว หรือสั่งเอง:
```
arduino-cli core install esp32:esp32@3.3.5 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli compile --fqbn "esp32:esp32:esp32s3:CDCOnBoot=cdc,PSRAM=opi,FlashSize=16M" firmware/NasaSat
arduino-cli compile --fqbn "esp32:esp32:esp32s3:CDCOnBoot=cdc,PSRAM=opi,FlashSize=16M" firmware/Fallback
```
ถ้าชื่อ option ผิด ดูชื่อจริงด้วย `arduino-cli board details -b esp32:esp32:esp32s3`

### ถ้ากล้องเป็นบอร์ด ESP32-CAM (AI-Thinker) แยกต่างหาก
- Board: **AI Thinker ESP32-CAM** (`esp32:esp32:esp32cam`, PSRAM เปิดให้แล้ว) ใช้ไฟล์ `NasaSat.ino` ตัวเดียวกัน (compile ผ่านแล้ว 1 ต.ค.)
- บอร์ดนี้ไม่มี USB ในตัว: ใช้ฐาน ESP32-CAM-MB หรือ USB-UART 3.3V (TX→U0R, RX→U0T, GND) ตอนอัปโหลดต้องต่อ IO0 ลง GND แล้วกด RESET
- หลังอัปโหลด: `SET act.type 0`, `SET cam.model 4`, `M2 INIT`, `SAVE` (ปุ่ม BOOT ถูกปิดเองเพราะ GPIO0 เป็นนาฬิกากล้อง)
- ไฟ: กล้อง + Wi-Fi ปิด กินไม่เกิน ~250 mA แต่ขั้วต่อ 5V ของฐาน MB บางตัวหลวม ถ้าเห็น `E BOOT BROWNOUT` ให้เลี้ยง 5V แยก

## 5. เมื่อได้บอร์ด (ซ้อมหรือวันจริง)
- [ ] เสียบบอร์ด → เลือกพอร์ต → Upload
  - อัปโหลดไม่ขึ้น: กดปุ่ม BOOT ค้าง แล้วกด RESET ปล่อย RESET แล้วค่อยปล่อย BOOT จากนั้น Upload ใหม่
- [ ] เปิด NasaSatLab → บอร์ดจริง → เชื่อมต่อ (ต้อง**ปิด** Serial Monitor ก่อน และกด "ตัดการเชื่อมต่อ" ใน tool ก่อนอัปโหลดทุกครั้ง: ช่อง "ต่อใหม่เอง" จะไม่แย่งพอร์ตหลังกดตัดการเชื่อมต่อ)
- [ ] ต้องเห็น `hello`, `CFG LIST` 78 ค่า, telemetry ~20 ครั้ง/วินาที, สุขภาพระบบ (`J hk`) ทุก 2 วินาที
- [ ] ลอง `REBOOT`: เว็บต้องขึ้น "กำลังต่อใหม่…" แล้วกลับมาเองภายในไม่กี่วินาที (บอร์ด USB ในตัว) ถ้าไม่กลับให้กด "เชื่อมต่อ" เองแล้วจดไว้
- [ ] `HWID`: จด chip, flash_mb, psram_mb, core, reset
- [ ] ทำ "ตั้งค่ากับชุดของผู้จัด" ใน `README.md`

## 6. ไฟเลี้ยง
- 28BYJ-48 กินไฟ ~200 mA ตอนหมุน + กล้อง ~150 mA + ESP32-S3 ~100 mA ใกล้ขีด USB 500 mA
- ถ้าเห็น `E BOOT BROWNOUT` หรือบอร์ดรีเซ็ตตอนมอเตอร์หมุน/ถ่ายภาพ: ใช้ USB hub มีไฟเลี้ยง หรือแยกไฟ 5V ให้ ULN2003 (ต่อ GND ร่วมกัน)
- `act.hold 0` (ค่าเริ่ม) ปล่อยขดลวดตอนหยุด ช่วยลดไฟและความร้อน
- ใช้แบต/พาวเวอร์แบงก์ไม่ต่อคอม: `SET m1.auto 5` + `SAVE m1.auto` ให้เริ่มหาแสงเอง หรือกดปุ่ม BOOT เริ่ม/หยุด
  ถ้าต่อวงจรแบ่งแรงดันแบตเข้าขา ADC (แบต → R บน → ขา ADC → R ล่าง → GND): `SET hw.vbat <ขา>`, `SET hw.vdiv <(R บน + R ล่าง)/R ล่าง>` แล้วดูแรงดันที่หัวเว็บ
  แรงดันที่ขาต้องไม่เกิน ~3.1 V: แบต 1 เซลล์ (4.2 V) ใช้ 100k + 100k → `hw.vdiv 2`, แบต 2S (8.4 V) ใช้ 100k + 47k → `hw.vdiv 3.13`

## 7. ของที่ต้องพกไปแข่ง
- [ ] โน้ตบุ๊ก + สายชาร์จ + ปลั๊กพ่วง
- [ ] สาย USB อย่างน้อย 2 เส้น (ทั้ง Type-C และ Micro-B) ที่**ส่งข้อมูลได้** (บางเส้นชาร์จได้อย่างเดียว)
- [ ] USB drive สำรองโปรเจกต์
- [ ] ไม้โปรแทรกเตอร์/กระดาษพิมพ์สเกลมุม, ท่อเล็ง (หลอดดูด) หรือเลเซอร์พอยน์เตอร์ติดขนานแกนหน้าดาวเทียม, เทปกาว, กระดาษบาง (ลดแสงให้ LDR เท่ากัน), กระดาษขาว/กระดาษไข 2–3 แผ่นใหญ่กว่าหน้าหลอด (ขั้น γ สองระดับแสง), ไขควงเล็ก
- [ ] (ถ้ามี) พาวเวอร์แบงก์ + สาย, ตัวต้านทาน 100k/47k สำหรับวัดแบต, USB-UART 3.3V สำรอง (ESP32-CAM / วิทยุ), วิทยุ serial คู่ (HC-12 หรือ LoRa UART) ถ้าผู้จัดให้สื่อสารไร้สาย
- [ ] ไฟล์ที่พิมพ์ออกมา: `README.md` หัวข้อคาลิเบรตและแก้ปัญหา, `TEST_PLAN.md` ส่วนวันแข่ง
