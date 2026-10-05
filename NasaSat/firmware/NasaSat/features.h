// ===== compile-time switches =====
// ถ้าโมดูลไหนมีปัญหาตอน compile/ใช้งานบนบอร์ดแข่ง ปิดได้ด้วยการเปลี่ยน 1 เป็น 0 บรรทัดเดียว
#pragma once

#define FW_NAME "NasaSat"
#define FW_VERSION "1.0.0"

#define ENABLE_CAMERA 1   // กล้อง (ภารกิจ 2) ใช้ esp_camera ที่มากับ ESP32 core
#define ENABLE_SERVO  1   // ตัวขับแบบ servo (act.type = 2)
#define ENABLE_WDT    1   // watchdog: ถ้า loop ค้างเกิน ~5 วินาที บอร์ดจะรีเซ็ตตัวเอง
#define ENABLE_LINK   1   // ช่องสื่อสารที่สอง (Serial1 ต่อวิทยุ/บอร์ดสะพาน) ใช้งานเมื่อ SET com.tx เป็นเลขขา (ค่าเริ่ม -1 = ปิด)

#define SERIAL_BAUD   115200      // บอร์ดที่ใช้ USB ในตัวไม่สนค่านี้ บอร์ดที่มีชิป USB-UART ต้องตรงกับ tool
#define CMD_LINE_MAX  2400        // ความยาวสูงสุดของคำสั่ง 1 บรรทัด (CAL LUT ยาวที่สุด) ไม่ใช้ชื่อ LINE_MAX เพราะชนกับ limits.h
#define LUT_MAX       256         // จำนวนช่องสูงสุดของตาราง LUT
#define LUT_MAX_STR   "256"       // ค่าเดียวกัน (ใช้ในข้อความ error)
#define STEP_TICK_US  200         // คาบของ timer ที่เดิน stepper (ไมโครวินาที)
#define IMG_CHUNK     480         // ไบต์ต่อ 1 บรรทัด IMG C (เป็น base64 ได้ 640 ตัวอักษร)
#define IMG_MAX_BYTES (300 * 1024) // ขนาดภาพ JPEG ใหญ่สุดที่เก็บไว้ส่งซ้ำได้
#define SERVO_LEDC_CH 6           // ช่อง LEDC ของ servo (กล้องใช้ช่อง 0)
#define SERVO_BITS    14          // ความละเอียด PWM ของ servo: ESP32-S3 ทำได้สูงสุด 14 บิต
#define ADC_SAT_HI_MV 3050        // อ่านได้ตั้งแต่ค่านี้ = ADC ตัน (sen.topo 0: แสงแรงเกิน)
#define ADC_SAT_LO_MV 60          // อ่านได้ไม่เกินค่านี้ = ADC ตันด้านล่าง (sen.topo 1: แสงแรงเกิน)
