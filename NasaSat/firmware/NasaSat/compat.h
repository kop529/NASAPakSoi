// ===== ครอบ API ที่ต่างกันระหว่าง ESP32 Arduino core 2.x กับ 3.x =====
#pragma once
#include <Arduino.h>

#ifndef ESP_ARDUINO_VERSION_MAJOR
#define ESP_ARDUINO_VERSION_MAJOR 2
#define ESP_ARDUINO_VERSION_MINOR 0
#define ESP_ARDUINO_VERSION_PATCH 0
#endif

// LEDC (servo PWM): core 3.x ผูกกับขา, core 2.x ผูกกับช่อง
inline bool pwmAttach(int pin, int ch, uint32_t freq, uint8_t bits) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  return ledcAttachChannel((uint8_t)pin, freq, bits, (uint8_t)ch);
#else
  if (ledcSetup((uint8_t)ch, freq, bits) == 0) return false;  // 0 = frequency/resolution not possible
  ledcAttachPin((uint8_t)pin, (uint8_t)ch);
  return true;
#endif
}

inline void pwmWrite(int pin, int ch, uint32_t duty) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  (void)ch;
  ledcWrite((uint8_t)pin, duty);
#else
  (void)pin;
  ledcWrite((uint8_t)ch, duty);
#endif
}

inline void pwmDetach(int pin) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcDetach((uint8_t)pin);
#else
  ledcDetachPin((uint8_t)pin);
#endif
}
