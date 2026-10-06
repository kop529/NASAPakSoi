# T05 — Payload & Data Link Integration: ผลของทีม (6 ต.ค. 2026)
บอร์ด SUNSEEK-NasaPakSoi (เฟิร์มแวร์ทีม team-2 บน v3.0) · กล้อง ESP32-CAM AI-Thinker + OV2640 + microSD (โค้ดกล้อง v3.0 สำเนาทีม) · GS v1.10.4

## โครงสร้าง (Control Plane ≠ Data Plane)
- **คำสั่ง:** GS → BLE → บอร์ดยาน → UART (GPIO41 TX → กล้อง GPIO3, GPIO42 RX ← กล้อง GPIO1, 5V, GND) → กล้อง
- **ภาพ:** กล้อง → Wi-Fi `SUNSEEK-PAYLOAD-NasaPakSoi` (192.168.4.1) → HTTP `/stream`, `/image?name=` → GS / เบราว์เซอร์

## P1 — กล้องเดี่ยว (ต่อ USB ผ่านบอร์ดอัป, COM10) · PASS
| ทดสอบ | ผล |
|---|---|
| Boot | `PAYLOAD,READY`, `WIFI_IP,192.168.4.1` |
| PING | `PONG,CAMERA` |
| STATUS | `STATUS,READY,CAMERA,OK,STORAGE,OK,WIFI,READY,IP,192.168.4.1,STREAM,OFF` |
| CAPTURE | `IMAGE_READY,/IMG_0001.JPG,15271` |
| STREAM_START / STOP | `ACK` + `EVENT,STREAM_ON/OFF` |

## P2 — Wi-Fi ตรงจากกล้อง · PASS
- `/status` → `{"ready":true,"camera":true,"storage":true,"wifi":true,...}`
- `/stream` → เห็นภาพสดใน Chrome; วัดจากโน้ตบุ๊ก 467 KB ใน 4 วิ (~5 ภาพ/วิ ที่ SVGA)

## P3 — ผ่านบอร์ดยาน · PASS (หลังแก้)
| ทดสอบ | ผล |
|---|---|
| PAYLOAD_PING | `PAYLOAD,PONG,CAMERA` |
| PAYLOAD_STATUS | ครั้งแรก `STORAGE,ERR` → หลังรีสตาร์ตกล้อง `STORAGE,OK` |
| CAPTURE | ครั้งแรก `CAPTURE_FAILED` → หลังแก้ `IMAGE_READY,/IMG_0002.JPG,22068` (จำนวน 1 → 2) |
| PAYLOAD_STREAM_START / STATUS | `STREAM_ON` / `STREAM_STATUS,ON` |

**Unexpected behavior record**
- อาการ: CAPTURE_FAILED, STORAGE ERR หลังย้ายกล้องจากบอร์ดอัปมาต่อกับยาน
- สมมติฐาน: SD ไม่ถูก mount ตอนกล้องเปิด
- หลักฐาน: ปิดแบตแล้วเปิดใหม่ STREAM ยังเป็น ON = กล้องไม่ได้รีสตาร์ต (USB ที่บอร์ดยังจ่ายไฟ 5V ให้)
- แก้ 1 อย่าง: ถอดสาย 5V ของกล้องแล้วเสียบใหม่ (กด SD ให้แน่น)
- Retest: STORAGE OK, CAPTURE ผ่าน

## P4 — Ground Station v1.10.4 · Live View PASS (16:18)
| ตัวชี้ | ผล |
|---|---|
| TT&C CONNECTED | ✅ |
| DATA LINK | ✅ (ต้องต่อ Wi-Fi กล้องจริง: Windows ชอบสลับกลับไปเน็ตโรงแรม) |
| Payload READY | ✅ |
| Live View ACTIVE | ✅ เห็นภาพพร้อมเส้น BORESIGHT 0° และ FOV ±20° |
| CAPTURE → PREVIEW LATEST | ยังไม่ได้ทดสอบใน GS |
| ตัด BLE แล้วภาพยังมา | ยังไม่ได้ทดสอบ (คาดว่าภาพยังมา เพราะคนละเส้นทาง) |

**ปัญหา Live View ค้าง STARTING และวิธีหาสาเหตุ**
1. ดักดูการเชื่อมต่อ TCP: มีแต่ Chrome ที่ต่อไปที่ 192.168.4.1 โปรแกรม GS ไม่เคยต่อเลย
2. เช็ค Wi-Fi ของโน้ตบุ๊ก: อยู่บนเน็ตโรงแรม ไม่ใช่กล้อง (GS ยังโชว์ CONNECTED ค้าง)
3. แกะโปรแกรม GS (PyInstaller) ดูข้อความข้างใน: GS เริ่มดึงภาพเมื่อได้ `PAYLOAD,STREAM_URL,<url>` เท่านั้น แต่โค้ดกล้อง v3.0 ส่งแค่ `EVENT,STREAM_ON`
4. แก้: บอร์ดยานส่ง `PAYLOAD,STREAM_URL,http://192.168.4.1/stream` ต่อจาก STREAM_ON → ภาพขึ้นทันที

## คำตอบสำหรับสมุด
- BLE หลุด แต่ Wi-Fi ยังต่อ → stream ยังมาต่อ เพราะภาพวิ่งผ่าน Wi-Fi และกล้องจำสถานะ STREAM ไว้เองตราบที่ยังมีไฟ
- CAMERA OK แต่ STORAGE ERR → Live stream ยังใช้ได้ (ไม่ใช้ SD) แต่ CAPTURE เก็บภาพไม่ได้ (เจอจริง)
- สั่งผ่าน BLE แล้วไม่ถึงกล้อง → เช็คชั้น UART ก่อน (TX↔RX, GND ร่วม, baud 115200) แล้วจึงชั้นกล้อง
- LAST KNOWN = สถานะล่าสุดที่ได้รับก่อน TT&C หลุด อาจไม่ใช่สถานะปัจจุบัน
- Failure matrix: A (TT&C off, Wi-Fi on) = ภาพยังดูได้ สั่งไม่ได้ · B (TT&C on, Wi-Fi off) = สั่งได้ ภาพไม่มา ทั้งที่รายงาน STREAM=ON · C = กล้องเสีย · D = SD เสีย แต่ stream ได้ · E = แค่ยังไม่ได้สั่ง STREAM_START
