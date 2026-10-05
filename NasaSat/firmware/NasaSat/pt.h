// ===== minimal protothreads =====
// Lets a long procedure (sweep, mission 1, ...) be written top-to-bottom like normal code while loop()
// keeps running: every PT_WAIT/PT_SLEEP returns to loop() and continues there on the next call.
// Rules: (1) values that must survive a wait are class members, (2) never two PT_ macros on one line,
// (3) no `switch` statement inside a procedure body.
#pragma once
#include <Arduino.h>

#define PT_BEGIN() \
  switch (ptLine_) {  \
    case 0:
#define PT_WAIT_UNTIL(cond)  \
  do {                       \
    ptLine_ = __LINE__;      \
    case __LINE__:           \
      if (!(cond)) return true; \
  } while (0)
#define PT_SLEEP(ms)                                            \
  do {                                                          \
    ptUntil_ = millis() + (uint32_t)(ms);                       \
    PT_WAIT_UNTIL((int32_t)(millis() - ptUntil_) >= 0);         \
  } while (0)
#define PT_EXIT() \
  do {            \
    ptLine_ = 0;  \
    return false; \
  } while (0)
#define PT_END() \
  }              \
  ptLine_ = 0;   \
  return false
