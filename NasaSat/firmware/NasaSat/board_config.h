// ===== ขากล้องแบบกำหนดเอง (cam.model = 3) =====
// ขา LDR, ULN2003, servo ตั้งผ่านคำสั่ง SET ได้เลย (ไม่ต้องแก้ไฟล์นี้)
// แต่ขากล้องมี 16 ขา จึงให้แก้ในไฟล์นี้: คัดลอกจากโค้ดตัวอย่างของผู้จัด (#define PWDN_GPIO_NUM ... ) มาใส่
// ค่าเริ่มต้นด้านล่าง = ESP32-S3-EYE / Freenove ESP32-S3 WROOM CAM
#pragma once

#define CUSTOM_PWDN_GPIO_NUM  -1
#define CUSTOM_RESET_GPIO_NUM -1
#define CUSTOM_XCLK_GPIO_NUM  15
#define CUSTOM_SIOD_GPIO_NUM  4
#define CUSTOM_SIOC_GPIO_NUM  5
#define CUSTOM_Y9_GPIO_NUM    16
#define CUSTOM_Y8_GPIO_NUM    17
#define CUSTOM_Y7_GPIO_NUM    18
#define CUSTOM_Y6_GPIO_NUM    12
#define CUSTOM_Y5_GPIO_NUM    10
#define CUSTOM_Y4_GPIO_NUM    8
#define CUSTOM_Y3_GPIO_NUM    9
#define CUSTOM_Y2_GPIO_NUM    11
#define CUSTOM_VSYNC_GPIO_NUM 6
#define CUSTOM_HREF_GPIO_NUM  7
#define CUSTOM_PCLK_GPIO_NUM  13
#define CUSTOM_XCLK_FREQ_HZ   20000000
