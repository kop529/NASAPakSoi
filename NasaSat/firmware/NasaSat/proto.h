// ===== line protocol output helpers (same format the web tool parses) =====
//  "@id OK ..." / "@id ERR code ..." / "TH,..." / "T,..." / "J {json}" / "E EVENT ..." / "# text" / "IMG ..."
//  Every line goes to the USB port (Serial) and, when a second port is on (com.tx), to that link too.
#pragma once
#include <stddef.h>
#include <stdint.h>
#include "features.h"

class Stream;

namespace out {
enum : uint8_t { TO_USB = 1, TO_LINK = 2, TO_ALL = 3 };
void to(uint8_t where);                                          // where the NEXT line goes (back to TO_ALL after it)
void line(const char* s);                                        // s + newline
void printf(const char* fmt, ...) __attribute__((format(printf, 1, 2)));  // formatted line
void ok(int id, const char* fmt = nullptr, ...) __attribute__((format(printf, 2, 3)));
void err(int id, const char* code, const char* fmt = nullptr, ...) __attribute__((format(printf, 3, 4)));
void event(const char* fmt, ...) __attribute__((format(printf, 1, 2)));   // "E ..."
// building one long line piece by piece (JSON)
void put(const char* s);
void putf(const char* fmt, ...) __attribute__((format(printf, 1, 2)));
void putStr(const char* s);   // JSON string with quotes and escaping
void putNum(float v);         // JSON number (null if not finite)
void end();                   // newline

// Second port (UART to a radio such as HC-12/LoRa, or to a bridge board). Lines wait in a buffer and leave as fast
// as the port takes them, so a slow radio never blocks the loop; when the buffer is full a WHOLE line is dropped
// (never half a line: the tool would misread it). Commands may arrive on it too (app.cpp reads it).
bool linkBegin(Stream* port, size_t bufBytes);
void linkEnd();
bool linkOn();
void linkPump();              // call every loop
size_t linkRoom();            // free buffer bytes (SIZE_MAX when there is no link)
void linkStats(uint32_t& lines, uint32_t& dropped, uint32_t& queued);
}  // namespace out

uint32_t crc32Update(uint32_t crc, const uint8_t* d, size_t n);   // start with 0
size_t base64Encode(const uint8_t* in, size_t n, char* out);       // returns length, adds '\0'

// collects characters from a port into complete lines
class LineReader {
 public:
  // returns true and sets `line` when a full line arrived; `overflow` tells a line was too long
  bool poll(Stream& port, char*& line, bool& overflow);

 private:
  char buf_[CMD_LINE_MAX];
  size_t n_ = 0;
  bool over_ = false;
};
