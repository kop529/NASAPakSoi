#include "camera.h"
#include "features.h"

#if ENABLE_CAMERA
#include <Arduino.h>
#include <esp_camera.h>
#include <stdlib.h>
#include <string.h>
#include "board_config.h"
#include "cfg.h"
#include "proto.h"

namespace {
struct CamPins {
  int pwdn, reset, xclk, sda, scl, y9, y8, y7, y6, y5, y4, y3, y2, vsync, href, pclk;
};
const CamPins kS3Eye = {-1, -1, 15, 4, 5, 16, 17, 18, 12, 10, 8, 9, 11, 6, 7, 13};   // ESP32-S3-EYE / Freenove
const CamPins kXiao = {-1, -1, 10, 40, 39, 48, 11, 12, 14, 16, 18, 17, 15, 38, 47, 13};  // XIAO ESP32S3 Sense
const CamPins kCustom = {CUSTOM_PWDN_GPIO_NUM, CUSTOM_RESET_GPIO_NUM, CUSTOM_XCLK_GPIO_NUM, CUSTOM_SIOD_GPIO_NUM,
                         CUSTOM_SIOC_GPIO_NUM, CUSTOM_Y9_GPIO_NUM, CUSTOM_Y8_GPIO_NUM, CUSTOM_Y7_GPIO_NUM,
                         CUSTOM_Y6_GPIO_NUM, CUSTOM_Y5_GPIO_NUM, CUSTOM_Y4_GPIO_NUM, CUSTOM_Y3_GPIO_NUM,
                         CUSTOM_Y2_GPIO_NUM, CUSTOM_VSYNC_GPIO_NUM, CUSTOM_HREF_GPIO_NUM, CUSTOM_PCLK_GPIO_NUM};
const CamPins kAiThinker = {32, -1, 0, 26, 27, 35, 34, 39, 36, 21, 19, 18, 5, 25, 23, 22};  // ESP32-CAM (classic ESP32)

bool inited = false;
bool isLocked = false;
char camStat[96] = "off";  // not "stat": the real core pulls in POSIX stat() and the name becomes ambiguous
CamPins used = kS3Eye;
int appliedRes = -1, appliedQ = -1, appliedHm = -1, appliedVf = -1;

// A preset made for another chip would drive that chip's flash/PSRAM pins (ESP32-CAM pins on an ESP32-S3: GPIO26,
// 27, 32 are its flash) and crash it, at every boot once cam.model is saved: check every pin first.
bool pinsFit(const CamPins& p, int model) {
  const struct { int gpio; PinUse use; const char* name; } list[] = {
      {p.pwdn, PIN_OUT, "PWDN"}, {p.reset, PIN_OUT, "RESET"}, {p.xclk, PIN_OUT, "XCLK"}, {p.sda, PIN_OUT, "SDA"},
      {p.scl, PIN_OUT, "SCL"},   {p.y9, PIN_IN, "Y9"},       {p.y8, PIN_IN, "Y8"},      {p.y7, PIN_IN, "Y7"},
      {p.y6, PIN_IN, "Y6"},      {p.y5, PIN_IN, "Y5"},       {p.y4, PIN_IN, "Y4"},      {p.y3, PIN_IN, "Y3"},
      {p.y2, PIN_IN, "Y2"},      {p.vsync, PIN_IN, "VSYNC"}, {p.href, PIN_IN, "HREF"},  {p.pclk, PIN_IN, "PCLK"}};
  for (const auto& e : list) {
    const char* why = cfg::gpioWhy(e.gpio, e.use);
    if (why) {
      snprintf(camStat, sizeof(camStat), "cam.model %d not for this chip: %s GPIO%d %s", model, e.name, e.gpio, why);
      return false;
    }
  }
  return true;
}

uint8_t* buf = nullptr;
size_t bufCap = 0;
size_t len = 0;
uint32_t imgId = 0, imgCrc = 0;
uint32_t nChunks = 0, nextChunk = 0;
bool isSending = false;
bool headerDue = false;  // img_meta + IMG B wait for room on the second port like the chunks do
char b64[((IMG_CHUNK + 2) / 3) * 4 + 4];
// the photo being sent: where its lines go (com.limg) and what the header says, frozen at the moment of the shot
uint8_t imgTo = out::TO_ALL;
ImgMeta shot;
int shotW = 0, shotH = 0, shotQ = 0, shotHm = 0, shotVf = 0, shotDir = 0;
float shotHfov = 0;
uint32_t shotMs = 0;
bool shotLocked = false;

const size_t kChunkLine = ((IMG_CHUNK + 2) / 3) * 4 + 40;
// free room on the slowest port this photo goes to (a radio on com.tx sets the pace; USB alone never waits here)
size_t room() { return (imgTo & out::TO_LINK) ? out::linkRoom() : SIZE_MAX; }

framesize_t sizeFor(int res) {
  switch (res) {
    case 0: return FRAMESIZE_QVGA;
    case 2: return FRAMESIZE_SVGA;
    case 3: return FRAMESIZE_XGA;
    case 4: return FRAMESIZE_HD;
    case 5: return FRAMESIZE_UXGA;
    default: return FRAMESIZE_VGA;
  }
}

void applySettings() {
  sensor_t* s = esp_camera_sensor_get();
  if (!s) return;
  const int r = cfg::i(CFG_CAM_RES);
  const int q = cfg::i(CFG_CAM_Q);
  const int hm = cfg::i(CFG_CAM_HMIRROR);
  const int vf = cfg::i(CFG_CAM_VFLIP);
  if (r != appliedRes) { s->set_framesize(s, sizeFor(r)); appliedRes = r; }
  if (q != appliedQ) { s->set_quality(s, q); appliedQ = q; }
  // always set (not left to the driver's default) so the tool knows which way the picture faces
  if (hm != appliedHm && s->set_hmirror) { s->set_hmirror(s, hm); appliedHm = hm; }
  if (vf != appliedVf && s->set_vflip) { s->set_vflip(s, vf); appliedVf = vf; }
}

void sendChunk(uint32_t seq) {
  const size_t off = (size_t)seq * IMG_CHUNK;
  if (off >= len) return;
  const size_t n = len - off < IMG_CHUNK ? len - off : IMG_CHUNK;
  base64Encode(buf + off, n, b64);
  out::to(imgTo);
  out::printf("IMG C %lu %lu %s", (unsigned long)imgId, (unsigned long)seq, b64);
}

void sendHeader() {
  const ImgMeta& m = shot;
  out::to(imgTo);
  out::putf("J {\"type\":\"img_meta\",\"id\":%lu,\"t_ms\":%lu,\"w\":%d,\"h\":%d,\"bytes\":%lu,\"q\":%d,\"ang\":",
            (unsigned long)imgId, (unsigned long)shotMs, shotW, shotH, (unsigned long)len, shotQ);
  out::putNum(m.ang);
  out::put(",\"cam_az_cmd\":");
  out::putNum(m.camAzCmd);
  out::put(",\"tgt\":");
  if (m.hasTgt) out::putNum(m.tgt); else out::put("null");
  out::put(",\"err_cmd\":");
  if (m.hasTgt) out::putNum(m.errCmd); else out::put("null");
  out::put(",\"tol\":");
  out::putNum(m.tol);
  out::putf(",\"in_tol\":%s", !m.hasTgt ? "null" : fabsf(m.errCmd) <= m.tol ? "true" : "false");
  out::put(",\"m1\":");
  out::putStr(m.m1);
  out::put(",\"th\":");
  out::putNum(m.th);
  out::putf(",\"locked\":%s,\"aec\":", shotLocked ? "true" : "false");
  if (shotLocked) out::put("\"frozen\""); else out::put("\"auto\"");
  out::putf(",\"moving\":%s,\"ref\":", m.moving ? "true" : "false");
  out::putStr(m.ref);
  // what the tool needs to turn a pixel into an angle: picture flips at the moment of the shot, direction, field of view
  out::putf(",\"hm\":%d,\"vf\":%d,\"cam_dir\":%d,\"hfov\":", shotHm, shotVf, shotDir);
  out::putNum(shotHfov);
  if (m.hasSun) {
    out::put(",\"sun_az\":");
    out::putNum(m.sunAz);
    out::put(",\"offset\":");
    out::putNum(m.offset);
  }
  out::put("}");
  out::end();
  out::to(imgTo);
  out::printf("IMG B %lu %lu %lu %08lx", (unsigned long)imgId, (unsigned long)len, (unsigned long)nChunks, (unsigned long)imgCrc);
}

bool jpegOk(const uint8_t* d, size_t n) {
  if (n < 100 || d[0] != 0xFF || d[1] != 0xD8) return false;
  for (size_t i = n - 2; i + 16 >= n && i > 0; i--)
    if (d[i] == 0xFF && d[i + 1] == 0xD9) return true;
  return false;
}
}  // namespace

namespace cam {

bool begin() {
  if (inited) {
    esp_camera_deinit();
    inited = false;
  }
  isLocked = false;
  const int model = cfg::i(CFG_CAM_MODEL);
  if (model == 0) {
    snprintf(camStat, sizeof(camStat), "off (cam.model=0)");
    return false;
  }
  used = model == 1 ? kS3Eye : model == 2 ? kXiao : model == 4 ? kAiThinker : kCustom;
  if (!pinsFit(used, model)) return false;
  camera_config_t c;
  memset(&c, 0, sizeof(c));
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = used.y2;
  c.pin_d1 = used.y3;
  c.pin_d2 = used.y4;
  c.pin_d3 = used.y5;
  c.pin_d4 = used.y6;
  c.pin_d5 = used.y7;
  c.pin_d6 = used.y8;
  c.pin_d7 = used.y9;
  c.pin_xclk = used.xclk;
  c.pin_pclk = used.pclk;
  c.pin_vsync = used.vsync;
  c.pin_href = used.href;
  c.pin_sccb_sda = used.sda;
  c.pin_sccb_scl = used.scl;
  c.pin_pwdn = used.pwdn;
  c.pin_reset = used.reset;
  c.xclk_freq_hz = model == 3 ? CUSTOM_XCLK_FREQ_HZ : 20000000;
  c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size = sizeFor(cfg::i(CFG_CAM_RES));
  c.jpeg_quality = cfg::i(CFG_CAM_Q);
  if (psramFound()) {
    c.fb_count = 2;
    c.fb_location = CAMERA_FB_IN_PSRAM;
    c.grab_mode = CAMERA_GRAB_LATEST;
  } else {  // no PSRAM: one small frame buffer in internal RAM
    c.fb_count = 1;
    c.fb_location = CAMERA_FB_IN_DRAM;
    c.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
    if (c.frame_size > FRAMESIZE_VGA) c.frame_size = FRAMESIZE_VGA;
  }
  const esp_err_t e = esp_camera_init(&c);
  if (e != ESP_OK) {
    snprintf(camStat, sizeof(camStat), "init fail 0x%x", (unsigned)e);
    return false;
  }
  inited = true;
  appliedRes = cfg::i(CFG_CAM_RES);
  appliedQ = cfg::i(CFG_CAM_Q);
  appliedHm = appliedVf = -1;
  applySettings();
  sensor_t* s = esp_camera_sensor_get();
  snprintf(camStat, sizeof(camStat), "ok sensor PID 0x%x", s ? (unsigned)s->id.PID : 0u);
  return true;
}

bool ok() { return inited; }
const char* status() { return camStat; }
bool locked() { return isLocked; }

void autoExposure(bool on) {
  sensor_t* s = inited ? esp_camera_sensor_get() : nullptr;
  if (!s) return;
  s->set_exposure_ctrl(s, on ? 1 : 0);
  s->set_gain_ctrl(s, on ? 1 : 0);
  s->set_whitebal(s, on ? 1 : 0);
  isLocked = !on;
}

bool manualExposure(int aec, int agc) {
  sensor_t* s = inited ? esp_camera_sensor_get() : nullptr;
  if (!s) return false;
  s->set_exposure_ctrl(s, 0);
  s->set_aec_value(s, aec);
  s->set_gain_ctrl(s, 0);
  s->set_agc_gain(s, agc);
  isLocked = true;
  return true;
}

bool grabDiscard() {
  if (!inited) return false;
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) return false;
  esp_camera_fb_return(fb);
  return true;
}

bool capture(const ImgMeta& m, const char*& err) {
  err = nullptr;
  if (!inited) { err = "camera_not_ready"; return false; }
  if (isSending) { err = "still_sending"; return false; }
  applySettings();
  // drop frames taken while moving; each esp_camera_fb_get() can wait ~4 s when no frame comes (camera
  // detected but data/PCLK pins wrong), so give up at the first miss instead of tripping the 5 s watchdog
  for (int k = 0; k < cfg::i(CFG_CAM_FLUSH); k++)
    if (!grabDiscard()) { err = "no_frames"; return false; }
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) { err = "fb_get"; return false; }
  if (fb->format != PIXFORMAT_JPEG || !jpegOk(fb->buf, fb->len)) {
    esp_camera_fb_return(fb);
    err = "bad_jpeg";
    return false;
  }
  if (fb->len > IMG_MAX_BYTES) {
    esp_camera_fb_return(fb);
    err = "too_big_lower_cam.res";
    return false;
  }
  if (!buf) {
    bufCap = psramFound() ? IMG_MAX_BYTES : 64 * 1024;
    buf = (uint8_t*)(psramFound() ? ps_malloc(bufCap) : malloc(bufCap));
    if (!buf) { esp_camera_fb_return(fb); bufCap = 0; err = "no_memory"; return false; }
  }
  if (fb->len > bufCap) { esp_camera_fb_return(fb); err = "too_big_lower_cam.res"; return false; }
  memcpy(buf, fb->buf, fb->len);
  len = fb->len;
  const int w = fb->width;
  const int h = fb->height;
  esp_camera_fb_return(fb);

  imgId++;
  imgCrc = crc32Update(0, buf, len);
  nChunks = (uint32_t)((len + IMG_CHUNK - 1) / IMG_CHUNK);
  nextChunk = 0;
  shot = m;
  shotW = w;
  shotH = h;
  shotQ = cfg::i(CFG_CAM_Q);
  shotHm = appliedHm;
  shotVf = appliedVf;
  shotDir = cfg::i(CFG_CAM_DIR);
  shotHfov = cfg::f(CFG_CAM_HFOV);
  shotMs = millis();
  shotLocked = isLocked;
  imgTo = cfg::i(CFG_COM_LIMG) ? out::TO_ALL : out::TO_USB;
  headerDue = true;  // pump() sends the metadata, IMG B, the chunks and IMG E
  isSending = true;
  return true;
}

bool sending() { return isSending; }

void pump() {
  if (!isSending) return;
  // a slow second port (radio, com.tx) sets the pace: each line is sent only when it fits that port's buffer whole
  if (headerDue) {
    if (room() < 1200) return;  // img_meta + IMG B
    sendHeader();
    headerDue = false;
    return;
  }
  if (nextChunk < nChunks) {
    if (room() < kChunkLine) return;
    // at least one chunk per loop; more while the serial TX buffer has room (keeps loop() responsive on a slow UART)
    const uint32_t t0 = micros();
    do {
      sendChunk(nextChunk++);
    } while (nextChunk < nChunks && Serial.availableForWrite() > 2 * IMG_CHUNK && room() >= kChunkLine &&
             micros() - t0 < 5000);
  }
  if (nextChunk >= nChunks && room() >= 64) {
    out::to(imgTo);
    out::printf("IMG E %lu", (unsigned long)imgId);
    isSending = false;
  }
}

bool resend(const char* id, const char* seqs) {
  if (!buf || !len || strtoul(id, nullptr, 10) != imgId) return false;
  const char* p = seqs;
  while (p && *p) {
    const unsigned long s = strtoul(p, nullptr, 10);
    if (s < nChunks) sendChunk((uint32_t)s);
    p = strchr(p, ',');
    if (p) p++;
  }
  out::to(imgTo);
  out::printf("IMG E %lu", (unsigned long)imgId);
  return true;
}

int pinsInUse(int* o, int max) {
  if (!inited) return 0;
  const int all[] = {used.pwdn, used.reset, used.xclk, used.sda, used.scl, used.y9, used.y8, used.y7,
                     used.y6, used.y5, used.y4, used.y3, used.y2, used.vsync, used.href, used.pclk};
  int n = 0;
  for (int p : all)
    if (p >= 0 && n < max) o[n++] = p;
  return n;
}

}  // namespace cam

#else  // ENABLE_CAMERA == 0: keep the API, report "disabled"

namespace cam {
bool begin() { return false; }
bool ok() { return false; }
const char* status() { return "disabled at compile time (ENABLE_CAMERA 0)"; }
bool locked() { return false; }
void autoExposure(bool) {}
bool manualExposure(int, int) { return false; }
bool grabDiscard() { return false; }
bool capture(const ImgMeta&, const char*& err) { err = "camera_disabled"; return false; }
bool sending() { return false; }
void pump() {}
bool resend(const char*, const char*) { return false; }
int pinsInUse(int*, int) { return 0; }
}  // namespace cam

#endif
