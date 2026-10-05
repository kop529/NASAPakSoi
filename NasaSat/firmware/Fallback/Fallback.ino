// =====================================================================================
//  NasaSat FALLBACK - แผนสำรองของทีมนาซ่าหน้าปากซอย
//  ใช้เมื่อ firmware หลัก (NasaSat) มีปัญหาบนบอร์ดจริง: ไฟล์เดียว ไม่ใช้ไลบรารีเสริม ไม่มีกล้อง ไม่ใช้ flash
//  ทำภารกิจ 1 (หันหาแสง) ได้ และพูด protocol ชุดย่อยเดียวกับ NasaSatLab (แท็บ Live + Console ใช้ได้)
//
//  ก่อนอัปโหลด: แก้ขา LDR / ULN2003 สองบรรทัดด้านล่างให้ตรงบอร์ด (ดูจาก PINFIND ของ firmware หลัก หรือแผ่นวงจร)
//  คำสั่ง: HELLO  HELP  GET k  SET k v  RAW  BAL  MOVE d  GOTO a  ZERO  STOP  RELEASE  M1 START [tgt]  M1 STOP
//  ขั้นตอนเร็ว: หันดาวเทียมตรงหลอดด้วยตา -> BAL -> M1 START
// =====================================================================================

const int PIN_L = 1, PIN_R = 2;               // ขา ADC ของ LDR ซ้าย / ขวา
const int IN_PINS[4] = {38, 39, 40, 41};      // ขา IN1..IN4 ของ ULN2003

// ชนิดข้อมูลที่ฟังก์ชันใช้เป็นค่าคืนต้องประกาศก่อนฟังก์ชันแรกของไฟล์ เพราะ Arduino IDE แทรกบรรทัดประกาศฟังก์ชัน
// (prototype) ไว้ก่อนฟังก์ชันแรกเอง ถ้า struct อยู่ทีหลัง compile จะไม่ผ่าน ('Reading' does not name a type)
struct Reading { float mvL, mvR, D, S, th; bool valid, sat; };

// ค่าที่ปรับด้วย SET ได้ (หายเมื่อรีเซ็ต: จดค่าดี ๆ ไว้แล้วแก้ในไฟล์นี้)
struct Param { const char* key; float val; };
Param P[] = {
  {"sen.topo", 0},     // 0 = LDR ฝั่ง 3.3V (สว่าง = mV สูง), 1 = LDR ฝั่ง GND
  {"est.alpha", 30},   // มุมเอียงของ LDR แต่ละตัว (องศา)
  {"est.gamma", 0.6},  // gamma ของ LDR
  {"est.g", 1},        // gain ขวาเทียบซ้าย (คำสั่ง BAL ตั้งให้)
  {"est.th0", 0},      // ชดเชยศูนย์ (องศา)
  {"est.minS", 0.05},  // แสงรวมขั้นต่ำที่ถือว่าเห็นหลอด
  {"ctl.k", 0.8},      // สัดส่วนการแก้ต่อรอบ
  {"ctl.db", 0.4},     // deadband (องศา)
  {"ctl.wait", 150},   // รอหลังหมุนก่อนวัด (ms)
  {"act.spr", 4096},   // step ต่อรอบ (half-step)
  {"act.dir", 1},      // ทิศมอเตอร์ 1 / -1
  {"act.sps", 300},    // ความเร็ว (step ต่อวินาที)
  {"m1.tgt", 0},       // มุมแสงที่ต้องการ
  {"com.hz", 10},      // อัตรา telemetry
};
const int NP = sizeof(P) / sizeof(P[0]);
float& par(const char* k) {
  for (int i = 0; i < NP; i++)
    if (!strcmp(P[i].key, k)) return P[i].val;
  static float dummy = 0;
  return dummy;
}

// ---------------------------------------------------------------- stepper (non-blocking, from loop)
const uint8_t HALF[8] = {0x1, 0x3, 0x2, 0x6, 0x4, 0xC, 0x8, 0x9};
long posSteps = 0, tgtSteps = 0;
int phase = 0;
bool energized = false;
uint32_t lastStepUs = 0, idleSince = 0;

void coils(uint8_t p) {
  for (int k = 0; k < 4; k++) digitalWrite(IN_PINS[k], (p >> k) & 1 ? HIGH : LOW);
}
bool moving() { return posSteps != tgtSteps; }
void stepperRun() {
  if (!moving()) {
    if (energized && millis() - idleSince > 100) { coils(0); energized = false; }  // cool motor, less noise
    return;
  }
  const uint32_t period = (uint32_t)(1e6 / max(50.0f, par("act.sps")));
  if (micros() - lastStepUs < period) return;
  lastStepUs = micros();
  const int d = tgtSteps > posSteps ? 1 : -1;
  posSteps += d;
  phase = (phase + d * (par("act.dir") < 0 ? -1 : 1) + 8) % 8;
  coils(HALF[phase]);
  energized = true;
  idleSince = millis();
}
float angleDeg() { return posSteps * 360.0f / par("act.spr"); }
void gotoDeg(float a) { tgtSteps = lroundf(a * par("act.spr") / 360.0f); }

// ---------------------------------------------------------------- light sensor (20 ms windows cancel 100 Hz flicker)
Reading last = {0, 0, 0, 0, 0, false, false};

Reading measure(int ms) {  // blocking but short (<= a few hundred ms); keeps the stepper idle anyway
  double sL = 0, sR = 0;
  long n = 0;
  bool sat = false;
  const uint32_t t0 = millis();
  while (millis() - t0 < (uint32_t)ms || n == 0) {
    const float a = analogReadMilliVolts(PIN_L);
    const float b = analogReadMilliVolts(PIN_R);
    sL += a;
    sR += b;
    n++;
    if (par("sen.topo") == 0 ? (a >= 3050 || b >= 3050) : (a <= 60 || b <= 60)) sat = true;
    delayMicroseconds(300);
  }
  Reading r;
  r.mvL = sL / n;
  r.mvR = sR / n;
  auto G = [](float mv) {
    mv = constrain(mv, 1.0f, 3299.0f);
    return par("sen.topo") == 1 ? (3300 - mv) / mv : mv / (3300 - mv);
  };
  const float eL = pow(G(r.mvL), 1.0f / par("est.gamma"));
  const float eR = pow(G(r.mvR), 1.0f / par("est.gamma")) / par("est.g");
  r.S = eL + eR;
  r.D = r.S > 1e-9f ? (eL - eR) / r.S : 0;
  r.th = atan(r.D / tan(par("est.alpha") * DEG_TO_RAD)) * RAD_TO_DEG + par("est.th0");
  r.sat = sat;
  r.valid = r.S >= par("est.minS") && !sat;  // clipped ADC is never "on target"
  return r;
}

// ---------------------------------------------------------------- mission 1 (IDLE, FINE, HOLD, LOST)
int m1 = 0;
int nOk = 0, nOff = 0;
uint32_t nextM1 = 0;
void setM1(int s, const char* why) {
  static const char* N[] = {"IDLE", "SEARCH", "FINE", "HOLD", "LOST"};
  m1 = s;
  Serial.printf("E M1 %s%s%s\n", N[s], why ? " " : "", why ? why : "");
}
void m1Run() {
  // the LDRs need ctl.wait after the LAST step to catch up (a long move must not shorten that wait)
  if (m1 == 0 || moving() || (int32_t)(millis() - nextM1) < 0 || millis() - idleSince < (uint32_t)par("ctl.wait")) return;
  const Reading r = measure(60);
  last = r;
  nextM1 = millis() + (uint32_t)par("ctl.wait");
  if (!r.valid) {
    if (m1 != 4) setM1(4, r.sat ? "adc_saturated" : "lost");
    return;
  }
  const float err = r.th - par("m1.tgt");
  if (fabs(err) <= par("ctl.db")) {
    nOff = 0;
    if (m1 != 3 && ++nOk >= 3) setM1(3, nullptr);
    return;
  }
  nOk = 0;
  if (m1 == 3 && fabs(err) < 2 * par("ctl.db")) {  // holding: ignore one noisy reading,
    if (++nOff < 3) return;                         // but correct an offset that stays (and keep HOLD)
    nOff = 0;
  } else {
    nOff = 0;
    if (m1 != 2) setM1(2, nullptr);
  }
  gotoDeg(angleDeg() + constrain(par("ctl.k") * err, -30.0f, 30.0f));
}

// ---------------------------------------------------------------- commands
char buf[200];
int blen = 0;
void handle(char* line) {
  char* p = line;
  while (*p && (*p <= ' ' || *p > '~')) p++;
  String pre = "";
  if (*p == '@') {
    char* sp = strchr(p, ' ');
    if (!sp) return;
    *sp = 0;
    pre = String(p) + " ";
    p = sp + 1;
  }
  char* cmd = strtok(p, " ");
  char* a1 = strtok(nullptr, " ");
  char* a2 = strtok(nullptr, " ");
  if (!cmd) return;
  String c = String(cmd);
  c.toUpperCase();
  const String A1 = a1 ? String(a1) : String("");
  if (c == "HELLO") {
    Serial.println("J {\"type\":\"hello\",\"fw\":\"NasaSat-Fallback\",\"ver\":\"1.0.0\",\"board\":\"ESP32-S3\",\"proto\":1,\"caps\":[\"stepper\",\"m1\"]}");
  } else if (c == "HELP") {
    Serial.println("# HELLO GET SET RAW BAL MOVE GOTO ZERO STOP RELEASE M1 START [tgt] | M1 STOP");
  } else if (c == "GET" && a1) {
    Serial.printf("%sOK %s=%g\n", pre.c_str(), a1, par(a1));
    return;
  } else if (c == "SET" && a1 && a2) {
    par(a1) = atof(a2);
    Serial.printf("%sOK %s=%g\n", pre.c_str(), a1, par(a1));
    return;
  } else if (c == "RAW") {
    const Reading r = measure(200);
    Serial.printf("J {\"type\":\"raw\",\"mv\":[%.1f,%.1f],\"D\":%.5f,\"S\":%.4f,\"th\":%.3f,\"valid\":%s,\"sat\":%s,\"ang\":%.3f}\n", r.mvL, r.mvR, r.D, r.S, r.th,
                  r.valid ? "true" : "false", r.sat ? "true" : "false", angleDeg());
  } else if (c == "BAL") {  // face the lamp first: makes both channels equal here
    const float g0 = par("est.g");
    par("est.g") = 1;
    const Reading r = measure(500);
    const float eL = (r.S * (1 + r.D)) / 2, eR = (r.S * (1 - r.D)) / 2;
    par("est.g") = eL > 0 && !r.sat ? eR / eL : g0;
    Serial.printf("J {\"type\":\"bal\",\"g\":%.5f}\n", par("est.g"));
  } else if (c == "MOVE" || c == "GOTO") {
    if (m1) { Serial.printf("%sERR BUSY M1\n", pre.c_str()); return; }
    gotoDeg(c == "MOVE" ? angleDeg() + A1.toFloat() : A1.toFloat());
  } else if (c == "ZERO") {
    posSteps = tgtSteps = 0;
  } else if (c == "STOP" || c == "RELEASE") {
    tgtSteps = posSteps;
    if (m1) setM1(0, "stopped");
    if (c == "RELEASE") { coils(0); energized = false; }
  } else if (c == "M1") {
    String s = A1;
    s.toUpperCase();
    if (s == "START") {
      if (a2) par("m1.tgt") = atof(a2);
      nOk = 0;
      setM1(2, "start");
    } else {
      tgtSteps = posSteps;
      setM1(0, "stopped");
    }
  } else {
    Serial.printf("%sERR CMD %s\n", pre.c_str(), cmd);
    return;
  }
  Serial.printf("%sOK\n", pre.c_str());
}

void setup() {
  Serial.begin(115200);
  const uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 1500) delay(10);
  for (int k = 0; k < 4; k++) {
    pinMode(IN_PINS[k], OUTPUT);
    digitalWrite(IN_PINS[k], LOW);
  }
  Serial.println("# NasaSat FALLBACK boot (mission 1 only)");
  Serial.println("E BOOT FALLBACK");
  Serial.println("TH,ms,m1,ang,th,err,D,S,v0,v1,en,fl");
}

uint32_t nextTel = 0;
void loop() {
  while (Serial.available()) {
    const int ch = Serial.read();
    if (ch == '\r') continue;
    if (ch == '\n') {
      buf[blen] = 0;
      if (blen) handle(buf);
      blen = 0;
    } else if (blen < (int)sizeof(buf) - 1) {
      buf[blen++] = (char)ch;
    }
  }
  stepperRun();
  m1Run();
  if (par("com.hz") > 0 && (int32_t)(millis() - nextTel) >= 0 && !moving()) {
    nextTel = millis() + (uint32_t)(1000 / par("com.hz"));
    if (m1 == 0) last = measure(20);
    const int fl = (last.valid ? 1 : 0) | (moving() ? 2 : 0) | (last.sat ? 4 : 0) | (m1 ? 16 : 0);
    Serial.printf("T,%lu,%d,%.3f,%.3f,%.3f,%.5f,%.4f,%.1f,%.1f,%d,%d\n", (unsigned long)millis(), m1, angleDeg(), last.th,
                  last.th - par("m1.tgt"), last.D, last.S, last.mvL, last.mvR, energized ? 1 : 0, fl);
  }
}
