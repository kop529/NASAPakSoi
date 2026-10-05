#include "proto.h"
#include <Arduino.h>
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

namespace {
char fbuf[512];
uint8_t dest = out::TO_ALL;  // where the line being written goes

// ---- second port: a ring buffer that only ever holds whole lines
Stream* linkPort = nullptr;
uint8_t* ring = nullptr;
size_t cap = 0, head = 0, tail = 0, lineStart = 0;
bool dropping = false;
uint32_t nLines = 0, nDrop = 0;

void ringPut(const char* s, size_t n) {
  for (size_t i = 0; i < n; i++) {
    const char c = s[i];
    if (!dropping) {
      const size_t nx = head + 1 == cap ? 0 : head + 1;
      if (nx != tail) {
        ring[head] = (uint8_t)c;
        head = nx;
        if (c == '\n') {
          lineStart = head;
          nLines++;
        }
        continue;
      }
      // full: take back the part of this line already queued. Nothing of it has left yet, because linkPump()
      // runs from loop() only, between lines.
      head = lineStart;
      dropping = true;
      nDrop++;
    }
    if (c == '\n') {
      dropping = false;
      lineStart = head;
    }
  }
}

void emit(const char* s, size_t n) {
  if (!n) return;
  if (dest & out::TO_USB) Serial.write((const uint8_t*)s, n);
  if (linkPort && (dest & out::TO_LINK)) ringPut(s, n);
}
void emitStr(const char* s) { emit(s, strlen(s)); }
void emitChar(char c) { emit(&c, 1); }
void endLine() {
  emitChar('\n');
  dest = out::TO_ALL;
}

void vput(const char* fmt, va_list ap) {
  va_list ap2;
  va_copy(ap2, ap);
  const int n = vsnprintf(fbuf, sizeof(fbuf), fmt, ap);
  if (n >= 0 && (size_t)n < sizeof(fbuf)) {
    emit(fbuf, (size_t)n);
  } else if (n > 0) {  // long text: format into a temporary buffer
    char* big = (char*)malloc((size_t)n + 1);
    if (big) {
      vsnprintf(big, (size_t)n + 1, fmt, ap2);
      emit(big, (size_t)n);
      free(big);
    } else {
      emitStr(fbuf);  // truncated, still line-safe
    }
  }
  va_end(ap2);
}

void prefixId(int id) {
  if (id >= 0) {
    char b[16];
    snprintf(b, sizeof(b), "@%d ", id);
    emitStr(b);
  }
}
}  // namespace

namespace out {

void to(uint8_t where) { dest = where; }

void line(const char* s) {
  emitStr(s);
  endLine();
}

void printf(const char* fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  vput(fmt, ap);
  va_end(ap);
  endLine();
}

void ok(int id, const char* fmt, ...) {
  prefixId(id);
  emitStr("OK");
  if (fmt && *fmt) {
    emitChar(' ');
    va_list ap;
    va_start(ap, fmt);
    vput(fmt, ap);
    va_end(ap);
  }
  endLine();
}

void err(int id, const char* code, const char* fmt, ...) {
  prefixId(id);
  emitStr("ERR ");
  emitStr(code);
  if (fmt && *fmt) {
    emitChar(' ');
    va_list ap;
    va_start(ap, fmt);
    vput(fmt, ap);
    va_end(ap);
  }
  endLine();
}

void event(const char* fmt, ...) {
  emitStr("E ");
  va_list ap;
  va_start(ap, fmt);
  vput(fmt, ap);
  va_end(ap);
  endLine();
}

void put(const char* s) { emitStr(s); }

void putf(const char* fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  vput(fmt, ap);
  va_end(ap);
}

void putStr(const char* s) {
  emitChar('"');
  const char* run = s;
  for (const char* p = s; p && *p; p++) {
    const unsigned char c = (unsigned char)*p;
    if (c == '"' || c == '\\' || c < 0x20) {
      emit(run, (size_t)(p - run));
      if (c < 0x20) {
        emitChar(' ');
      } else {
        const char e[2] = {'\\', (char)c};
        emit(e, 2);
      }
      run = p + 1;
    }
  }
  if (run) emitStr(run);
  emitChar('"');
}

void putNum(float v) {
  if (!isfinite(v)) {
    emitStr("null");
    return;
  }
  char b[24];
  snprintf(b, sizeof(b), "%.7g", (double)v);
  emitStr(b);
}

void end() { endLine(); }

bool linkBegin(Stream* port, size_t bufBytes) {
  linkEnd();
  if (!port || bufBytes < 1024) return false;
  ring = (uint8_t*)(psramFound() ? ps_malloc(bufBytes) : nullptr);
  if (!ring) {  // no PSRAM: a smaller buffer in internal RAM
    bufBytes = bufBytes < 8192 ? bufBytes : 8192;
    ring = (uint8_t*)malloc(bufBytes);
  }
  if (!ring) return false;
  cap = bufBytes;
  head = tail = lineStart = 0;
  dropping = false;
  nLines = nDrop = 0;
  linkPort = port;
  return true;
}

void linkEnd() {
  linkPort = nullptr;
  free(ring);
  ring = nullptr;
  cap = head = tail = lineStart = 0;
  dropping = false;
}

bool linkOn() { return linkPort != nullptr; }

void linkPump() {
  if (!linkPort) return;
  while (tail != head) {
    const int room = linkPort->availableForWrite();
    if (room <= 0) return;
    size_t n = (head > tail ? head : cap) - tail;  // contiguous bytes up to the end of the buffer
    if (n > (size_t)room) n = (size_t)room;
    const size_t w = linkPort->write(ring + tail, n);
    if (!w) return;
    tail += w;
    if (tail >= cap) tail = 0;
  }
}

size_t linkRoom() {
  if (!linkPort) return SIZE_MAX;
  const size_t used = head >= tail ? head - tail : cap - tail + head;
  return cap - 1 - used;
}

void linkStats(uint32_t& lines, uint32_t& dropped, uint32_t& queued) {
  lines = nLines;
  dropped = nDrop;
  queued = !linkPort ? 0 : (uint32_t)(head >= tail ? head - tail : cap - tail + head);
}

}  // namespace out

uint32_t crc32Update(uint32_t crc, const uint8_t* d, size_t n) {
  crc = ~crc;
  for (size_t i = 0; i < n; i++) {
    crc ^= d[i];
    for (int k = 0; k < 8; k++) crc = (crc & 1) ? (0xEDB88320u ^ (crc >> 1)) : (crc >> 1);
  }
  return ~crc;
}

size_t base64Encode(const uint8_t* in, size_t n, char* o) {
  static const char tb[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  size_t j = 0;
  size_t i = 0;
  for (; i + 2 < n; i += 3) {
    const uint32_t v = ((uint32_t)in[i] << 16) | ((uint32_t)in[i + 1] << 8) | in[i + 2];
    o[j++] = tb[(v >> 18) & 63];
    o[j++] = tb[(v >> 12) & 63];
    o[j++] = tb[(v >> 6) & 63];
    o[j++] = tb[v & 63];
  }
  if (i < n) {
    uint32_t v = (uint32_t)in[i] << 16;
    if (i + 1 < n) v |= (uint32_t)in[i + 1] << 8;
    o[j++] = tb[(v >> 18) & 63];
    o[j++] = tb[(v >> 12) & 63];
    o[j++] = (i + 1 < n) ? tb[(v >> 6) & 63] : '=';
    o[j++] = '=';
  }
  o[j] = '\0';
  return j;
}

bool LineReader::poll(Stream& port, char*& line, bool& overflow) {
  while (port.available() > 0) {
    const int c = port.read();
    if (c < 0) break;
    if (c == '\r') continue;
    if (c == '\n') {
      buf_[n_] = '\0';
      overflow = over_;
      const bool had = n_ > 0 || over_;
      n_ = 0;
      over_ = false;
      if (had) {
        line = buf_;
        return true;
      }
      continue;
    }
    if (n_ < CMD_LINE_MAX - 1) buf_[n_++] = (char)c;
    else over_ = true;
  }
  return false;
}
