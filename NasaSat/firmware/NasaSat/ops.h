// ===== running without the laptop: automatic M1 start, push button, housekeeping telemetry, second link port =====
//  m1.auto  : start mission 1 by itself N seconds after power-on (battery, no cable); STOP cancels it
//  hw.btn   : a button to GND (0 = the BOOT button) starts mission 1, a second press stops it
//  com.hk   : "J hk" every N seconds: chip temperature, free memory, longest loop, battery voltage (hw.vbat)
//  com.tx/rx: a second UART that gets a copy of every line and takes commands (radio or bridge board)
#pragma once
#include <stdint.h>

class Stream;

namespace ops {
void begin();                 // in setup(), after the camera (the button must skip a pin the camera uses)
void applyConfig();           // after SET hw.* / com.*, LOAD, DEFAULTS, M2 INIT
void tick();                  // every loop
void cancelAuto();            // STOP: forget a pending automatic start
void noteLoop(uint32_t us);   // how long one loop() was busy (J hk reports the longest)
Stream* linkPort();           // the second port while it is on, else nullptr
int buttonPin();              // GPIO of the button in use, -1 = none
}  // namespace ops
