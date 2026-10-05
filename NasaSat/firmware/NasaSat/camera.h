// ===== camera (Target Imaging): init from presets, exposure lock, capture, chunked JPEG downlink =====
#pragma once
#include <stdint.h>

struct ImgMeta {
  float ang = 0, camAzCmd = 0, th = 0;
  bool hasTgt = false;
  float tgt = 0, errCmd = 0, tol = 1;   // errCmd = commanded vs step count, NOT a measured pointing error
  bool hasSun = false;
  float sunAz = 0, offset = 0;
  const char* ref = "none";
  const char* m1 = "IDLE";
  bool moving = false;
};

namespace cam {
bool begin();                     // (re)initialise according to cam.model; 0 = no camera
bool ok();
const char* status();
bool locked();
void autoExposure(bool on);       // off = keep the exposure/gain/white balance the sensor has now
bool manualExposure(int aec, int agc);
bool grabDiscard();               // take one frame and drop it
bool capture(const ImgMeta& m, const char*& err);
bool sending();
void pump();                      // sends a few IMG C lines per call
bool resend(const char* id, const char* seqs);
int pinsInUse(int* out, int max);
}  // namespace cam
