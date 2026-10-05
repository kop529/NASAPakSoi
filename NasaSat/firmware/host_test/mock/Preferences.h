// in-memory NVS, saved to a file by the harness so REBOOT keeps the values (like the real flash)
#pragma once
#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <string>

class Preferences {
 public:
  bool begin(const char* name, bool readOnly = false, const char* partition = nullptr);
  void end();
  bool isKey(const char* key);
  bool remove(const char* key);
  bool clear();
  float getFloat(const char* key, float def = NAN);
  size_t putFloat(const char* key, float v);
  size_t getBytesLength(const char* key);
  size_t getBytes(const char* key, void* buf, size_t maxLen);
  size_t putBytes(const char* key, const void* buf, size_t len);

 private:
  bool open_ = false, ro_ = false;
  std::string ns_;
  std::string full(const char* key) const;
};
