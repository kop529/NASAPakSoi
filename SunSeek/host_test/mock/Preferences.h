// Host-test NVS: kept in memory and written to the file named by $SUNSEEK_NVS after every change,
// so a test can restart the program and see the saved values (like a reset on the real board).
#pragma once
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
  double getDouble(const char* key, double def = 0);
  size_t putDouble(const char* key, double v);
  int32_t getInt(const char* key, int32_t def = 0);
  size_t putInt(const char* key, int32_t v);
  size_t getBytesLength(const char* key);
  size_t getBytes(const char* key, void* buf, size_t maxLen);
  size_t putBytes(const char* key, const void* buf, size_t len);

 private:
  bool open_ = false, ro_ = false;
  std::string ns_;
  std::string full(const char* key) const { return ns_ + "/" + key; }
};
