// mock of the esp32-camera component (same names and field names as the real one)
#pragma once
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

typedef enum { LEDC_TIMER_0 = 0, LEDC_TIMER_1, LEDC_TIMER_2, LEDC_TIMER_3 } ledc_timer_t;
typedef enum { LEDC_CHANNEL_0 = 0, LEDC_CHANNEL_1, LEDC_CHANNEL_2, LEDC_CHANNEL_3, LEDC_CHANNEL_4, LEDC_CHANNEL_5, LEDC_CHANNEL_6, LEDC_CHANNEL_7 } ledc_channel_t;
typedef enum { PIXFORMAT_RGB565, PIXFORMAT_YUV422, PIXFORMAT_YUV420, PIXFORMAT_GRAYSCALE, PIXFORMAT_JPEG, PIXFORMAT_RGB888 } pixformat_t;
typedef enum {
  FRAMESIZE_96X96,
  FRAMESIZE_QQVGA,
  FRAMESIZE_128X128,
  FRAMESIZE_QCIF,
  FRAMESIZE_HQVGA,
  FRAMESIZE_240X240,
  FRAMESIZE_QVGA,
  FRAMESIZE_320X320,
  FRAMESIZE_CIF,
  FRAMESIZE_HVGA,
  FRAMESIZE_VGA,
  FRAMESIZE_SVGA,
  FRAMESIZE_XGA,
  FRAMESIZE_HD,
  FRAMESIZE_SXGA,
  FRAMESIZE_UXGA,
  FRAMESIZE_INVALID
} framesize_t;
typedef enum { CAMERA_FB_IN_PSRAM, CAMERA_FB_IN_DRAM } camera_fb_location_t;
typedef enum { CAMERA_GRAB_WHEN_EMPTY, CAMERA_GRAB_LATEST } camera_grab_mode_t;

typedef struct {
  int pin_pwdn;
  int pin_reset;
  int pin_xclk;
  int pin_sccb_sda;
  int pin_sccb_scl;
  int pin_d7, pin_d6, pin_d5, pin_d4, pin_d3, pin_d2, pin_d1, pin_d0;
  int pin_vsync;
  int pin_href;
  int pin_pclk;
  int xclk_freq_hz;
  ledc_timer_t ledc_timer;
  ledc_channel_t ledc_channel;
  pixformat_t pixel_format;
  framesize_t frame_size;
  int jpeg_quality;
  size_t fb_count;
  camera_fb_location_t fb_location;
  camera_grab_mode_t grab_mode;
  int sccb_i2c_port;
} camera_config_t;

typedef struct {
  uint8_t* buf;
  size_t len;
  size_t width;
  size_t height;
  pixformat_t format;
} camera_fb_t;

typedef struct {
  uint8_t MIDH, MIDL;
  uint16_t PID;
  uint8_t VER;
} sensor_id_t;

typedef struct _sensor sensor_t;
struct _sensor {
  sensor_id_t id;
  int (*set_framesize)(sensor_t*, framesize_t);
  int (*set_quality)(sensor_t*, int);
  int (*set_exposure_ctrl)(sensor_t*, int);
  int (*set_gain_ctrl)(sensor_t*, int);
  int (*set_whitebal)(sensor_t*, int);
  int (*set_aec_value)(sensor_t*, int);
  int (*set_agc_gain)(sensor_t*, int);
  int (*set_hmirror)(sensor_t*, int);
  int (*set_vflip)(sensor_t*, int);
};

esp_err_t esp_camera_init(const camera_config_t* config);
esp_err_t esp_camera_deinit();
camera_fb_t* esp_camera_fb_get();
void esp_camera_fb_return(camera_fb_t* fb);
sensor_t* esp_camera_sensor_get();
