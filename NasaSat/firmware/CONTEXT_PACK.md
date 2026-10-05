# NasaSat context pack (วางให้ AI อ่านก่อนถามปัญหา)

## ระบบ
- งาน: Thailand Young Satellite Challenge 2026 รอบชิง ภารกิจ 1 Sun Tracking (หันหาหลอดไฟ), ภารกิจ 2 Target Imaging (หันกล้องไปเป้าแล้วถ่าย)
- บอร์ด ESP32-S3 (Arduino IDE, core esp32 3.x หรือ 2.0.x), LDR 2 ตัววางเป็นตัว V เอียง ±α จากแกน, วงจรแบ่งแรงดันเข้า ADC
- ตัวขับหลัก 28BYJ-48 + ULN2003 (half-step ~4076–4096 step/รอบ, backlash ~1–2°) หรือ servo (PWM 50 Hz 14 บิต)
- กล้อง esp32-camera (OV2640) ส่ง JPEG เป็นชิ้น base64 ผ่าน Serial; preset ขา: 1 S3-EYE/Freenove, 2 XIAO S3, 3 board_config.h, 4 ESP32-CAM AI-Thinker (ชุดขาของชิปอื่นถูกปฏิเสธ `not for this chip`)
- เว็บ tool `NasaSatLab.html` (Web Serial, ต่อใหม่เองเมื่อบอร์ดรีเซ็ต) คุมทุกอย่าง, ค่าตั้ง 78 ค่า `SET`/`SAVE` (หรือ `SAVE k1 k2` เฉพาะบางค่า) ใน NVS ไม่ต้องอัปโหลดใหม่
- ไม่ต่อคอม: `m1.auto` เริ่มภารกิจ 1 เองหลังบูต, ปุ่ม `hw.btn` (0 = BOOT) เริ่ม/หยุด, `J hk` ทุก `com.hk` s (อุณหภูมิชิป, heap, loop นานสุด, แบตจาก `hw.vbat × hw.vdiv`), ช่องที่สอง UART1 (`com.rx/tx/baud`) ได้สำเนาทุกบรรทัด + รับคำสั่ง (วิทยุ HC-12/LoRa หรือบอร์ดสะพาน)

## สูตรมุมแสง (firmware = เว็บ ตรงกันทุกบิต)
1. mV → G = V/(Vcc−V) (sen.topo 0) หรือ (Vcc−V)/V (topo 1)
2. e_L = (G_L^(1/γL) − aL)^(1/qL),  e_R = (G_R^(1/γR) − aR)^(1/qR) / g   (γR = est.gammaR, 0 = ใช้ est.gamma)
3. S = e_L + e_R, D = (e_L − e_R)/S, raw = atan(D / tan α), θ = raw + th0 + LUT(raw)
4. valid = S ≥ minS และ ADC ไม่ตัน, edge = |D| > dmax
- aL/aR จาก AMB (ปิดหลอด), γ แต่ละตัว + q + g + LUT จากการ Fit ของ sweep (ต้องมี AMB ถ้าห้องเปิดไฟ)
- γR/γL วัดจากแสงสองระดับที่ท่าเดียว (กระดาษบังหลอด, ลด ≥ 2 เท่า) แล้ว Fit ด้วย q เดียวกันสองช่อง: ทำให้มุมไม่เพี้ยนตามความสว่างหลอด (ไม่วัด: 0.5° เมื่อหลอดหรี่ครึ่งหนึ่ง, 3–4° ถ้ากล่องครอบไม่เท่ากัน)
- ศูนย์สัมบูรณ์ (th0) ต้องมาจากของอ้างอิงภายนอก: `CAL TH0 ref` (บอร์ดบันทึก est.th0 ลง flash ให้เอง)

## ควบคุม
- ภารกิจ 1: วัด (ctl.meas ms) → err = θ − m1.tgt → หมุน ctl.k·err (จำกัด ctl.maxstep, ขอบช่วงหมุนหยาบ 30°, เข้าเป้าจากทิศ ctl.appr เสมอ) → รอ ctl.wait → ซ้ำ; |err| ≤ ctl.db ติดกัน ctl.nlock ครั้ง = HOLD; ขณะ HOLD ถ้าเกิน ctl.db ติดกัน ctl.trim ครั้ง = ขยับแก้โดยยัง HOLD (E M1TRIM); หลุดเกิน ctl.hys = FINE ใหม่; ไม่เห็นแสง = SEARCH หมุนต่อเนื่องใน m1.smin..m1.smax หยุดที่ค่าแรกที่ใช้ได้และหมุนไปถึงได้; แก้แล้วเลยเป้า = gain ลดครึ่ง; ctl.adapt = เฉลี่ยนานขึ้น (≤ 400 ms) และ deadband ≥ 2.5×noise เมื่อ noise สูง
- ภารกิจ 2: GO = หันกล้องไป tgt − cam.off (เทียบศูนย์ตัวขับ) เข้าเป้าด้วยการหมุนทิศ ctl.appr เสมอ, GO SUN = หาทิศดวงอาทิตย์ด้วย null-seek แล้วไป sun + offset; ไม่ถ่ายถ้านอก act.min/max หรือคลาดเกิน m2.tol (snap_fail)
- ภาพ → มุม (เว็บ): az = cam_az_cmd + s·atan((W/2 − x)/f), f = (W/2)/tan(hfov/2), s = cam.dir × (hm ? −1 : 1) (s = +1: ของที่มุมมากกว่าอยู่ซ้าย); cam.dir + cam.hfov วัดจากถ่าย → หมุน +8° → ถ่าย แล้ว correlate gradient ของโปรไฟล์คอลัมน์; boresight cam.off = θ − δ ต้องถ่ายตอน M1 HOLD |θ| ≤ 2° และหลัง CAL TH0

## Protocol ย่อ
ส่ง `@id CMD args` ได้ `@id OK ...` / `@id ERR code ...`, telemetry `T,ms,m1,ang,th,err,D,S,v0,v1,en,fl` (fl: 1 valid, 2 moving, 4 ADC ตัน, 8 edge, 16 มีงาน, 32 กล้องล็อก), JSON `J {"type":...}`, event `E ...`
คำสั่งหลัก: HELLO, CFG LIST, GET/SET/SAVE [k..], RAW, AMB, BAL, CAL TH0 [ref], SWEEP a b step dwell, MOVE, GOTO, ZERO, STOP, SPR, BACKLASH, M1 START [tgt]/STOP, STEP d, M2 INIT/LOCK/UNLOCK/SNAP/GO [tgt]/GO SUN off, CAL LUT/GET, HWID, PINFIND, DIAG, REBOOT
event ใหม่: `E AUTO M1_IN n / M1_START / CANCELLED / SKIPPED`, `E BTN M1_START / M1_STOP`, `E LINK ON ...`, `E WARN BTN ...`; JSON ใหม่ `J hk`; img_meta มี hm, vf, cam_dir, hfov
รายละเอียดเต็ม: `firmware/PROTOCOL.md`, ค่าตั้งทั้งหมด: `firmware/CONFIG_KEYS.md`

## โครงสร้างโค้ด firmware (`firmware/NasaSat/`)
app.cpp (setup/loop, telemetry) · commands.cpp (ตัวแยกคำสั่ง) · procs.cpp (งานยาวแบบ protothread: SWEEP, M1, M2, AMB, BAL, TH0, BACKLASH, SPR; ช่องงานหลัก 1 + ช่องเสริม 1) · sensors.cpp (อ่าน L,R,R,L หน้าต่าง 20 ms ตัดไฟกระพริบ) · estimator.cpp (สูตรข้างบน) · stepper.cpp (esp_timer 200 µs, trapezoid, ชดเชย backlash แบบนับ step ที่ชดเชยไปแล้ว (off_), ปล่อยขดลวดตอนหยุด) · actuator.cpp (stepper/servo) · camera.cpp (preset ขา + ตรวจขาตามชิป, hmirror/vflip, ส่งภาพทีละบรรทัดตามที่ว่างของช่องที่สอง) · cfg.cpp (NVS, กฎขาต่อชิป gpioWhy) · diag.cpp (HWID, PINFIND, DIAG) · ops.cpp (m1.auto, ปุ่ม, J hk, ช่องที่สอง) · proto.cpp (เขียนบรรทัดไป USB + ช่องที่สอง (ring buffer ทิ้งทั้งบรรทัดเมื่อเต็ม), CRC32, base64)
สวิตช์ compile: `features.h` (ENABLE_CAMERA, ENABLE_SERVO, ENABLE_WDT, ENABLE_LINK, SERIAL_BAUD)

## สิ่งที่รู้แล้ว (อย่าแนะนำให้ทำผิดซ้ำ)
- ต้องคูณ gain หลังถอดราก q ของแต่ละช่อง ไม่งั้นศูนย์เลื่อน ~6°
- AMB ต้องรอ LDR นิ่งหลังปิดหลอด (firmware รอเอง 1–4 s)
- ตอน fit ต้องเลือกจุดจากแสงหลอดล้วน (หักแสงห้องก่อน) ไม่งั้นห้องสว่างจะใช้จุดขอบกล่องครอบแล้วคลาด 8–22°; ห้องสว่างต้องวัด AMB เสมอ; γ แยกแต่ละ LDR ช่วยเพิ่มแค่เล็กน้อย
- ADC ตัน = ข้อมูลไร้ทิศ ห้ามล็อกจากค่านั้น
- LEDC ของ ESP32-S3 สูงสุด 14 บิต
- Sweep + Fit ให้ศูนย์ที่เยื้องคงที่ ~0.2–0.7° ต้อง CAL TH0 กับของอ้างอิง
- STEP/MOVE/GOTO ใช้ไม่ได้ขณะ M1 ทำงาน (ERR BUSY) ยกเว้น M2 GO ที่หยุด M1 ให้เอง
- ชื่อตัวแปร global ห้ามชนกับ POSIX/newlib (เช่น `stat`, `link`, `LINE_MAX`): core จริง include sys/stat.h และ sys/unistd.h ผ่าน Arduino.h
- ใน protothread (procs.cpp) ห้ามมีตัวแปร local คร่อม PT_WAIT/WAIT_MOTION (ใช้ member ของ struct แทน) ไม่งั้น compile ไม่ผ่าน "jump to case label"
- เปิด/ปิดชดเชย backlash (act.bl, BACKLASH) ระหว่างใช้งานได้: stepper นับ off_ แล้วชดเชยส่วนที่ขาดเอง (แบบเดิม "ชดเชยทุกครั้งที่กลับทิศ" ทำให้มุมตัวขับเลื่อนไป act.bl ถาวร)
- คลิกเล็งจากภาพใช้ได้แม้ยังไม่วัด boresight (มุมอ้างอิงจากภาพนั้นเอง) แต่ต้องรู้ทิศภาพ (cam.dir) ก่อน; boresight ก่อนคาลิเบรตเซนเซอร์จะได้ค่าผิดตามศูนย์ที่ยังผิด
- ใน .ino ทุก struct/class ที่ฟังก์ชันใช้เป็นชนิดค่าคืนต้องประกาศก่อนฟังก์ชันแรกของไฟล์ (Arduino แทรก prototype ไว้ตรงนั้น)
- ทำ BACKLASH + ตั้ง act.bl ก่อน SPR (ไม่งั้น SPR คลาดได้ ~17 step); null-seek จบด้วยการคำนวณจุดตัดศูนย์จากค่าสองฝั่ง (บังคับเข้าจากฝั่งเดียวเคยทำให้วนไม่จบ)
- ไฟห้องเปลี่ยน: ตรวจศูนย์ด้วยท่อเล็งแล้ว CAL TH0 ใหม่ ห้ามวัด AMB ใหม่อย่างเดียว/Fit ใหม่ด้วย sweep เก่า (แย่ลงได้ถึง 3°)
- ผลบนตัวจำลองต้องผ่านหลาย seed (`E2E_SEED=1..3`) ผล seed เดียวอาจเป็นโชค
- ขาที่ห้าม SET (ERR PIN): 26–32 flash, 33–37 ถ้า OPI PSRAM, 19/20 ถ้า USB CDC On Boot, 43/44 ถ้า UART, 22–25 ไม่มีจริง, LDR ต้องอยู่ขา ADC (GPIO1–20)
- แก้โค้ดแล้วต้องผ่าน 3 ด่าน: `node firmware/host_test/build.js && node firmware/host_test/e2e.js`, `node tool/tests/run_tests.js`, `node firmware/tools/compile_check.js` (compile ด้วย core จริง)

## เวลาถาม AI ให้แนบ
1. แท็บ "หลักฐาน & AI" → "DIAG + สร้างใหม่" → คัดลอก (มีค่าตั้งที่ต่างจากค่าเริ่ม, ผลคาลิเบรต, สถิติ telemetry 10 s, error ล่าสุด)
2. อาการที่เห็น + คำสั่งที่ส่งไป + สิ่งที่คาดว่าจะเกิด
3. ถ้า compile ไม่ผ่าน: ข้อความ error บรรทัดแรก ๆ + เวอร์ชัน core (Tools → Board → Boards Manager)
