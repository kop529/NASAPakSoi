'use strict';
// ===== rules: judgements and "what to do" texts the UI shows (pure: no DOM, unit-tested) =====
NS.rules = (() => {
  const ERR = {
    CMD: 'ไม่รู้จักคำสั่ง: พิมพ์ HELP ดูรายการ',
    ARG: 'ใส่ค่าไม่ครบหรือรูปแบบผิด: พิมพ์ HELP ดูตัวอย่าง',
    KEY: 'ไม่มีค่าตั้งชื่อนี้: พิมพ์ CFG LIST ดูชื่อที่ถูก',
    VAL: 'ค่าต้องเป็นตัวเลข',
    PIN: 'ขานี้ใช้ไม่ได้หรือซ้ำกับตัวอื่น: ดู HWID แล้วเลือกขาอื่น',
    STATE: 'ต้องให้ภารกิจ 1 ล็อก (HOLD) ก่อน',
    CAM: 'กล้องไม่พร้อม: ลอง cam.model อื่นแล้ว M2 INIT',
    IMG: 'ภาพที่ขอไม่มีแล้ว: ถ่ายใหม่ด้วย SNAP',
    LONG: 'คำสั่งยาวเกินไป: พิมพ์ให้สั้นลง',
    NVS: 'เขียน flash ไม่สำเร็จ: ลอง SAVE อีกครั้ง ถ้ายังไม่ได้ให้รีสตาร์ตบอร์ด',
  };
  const FAULT = {
    adc_saturated: 'แสงแรงจน ADC ตัน: ถอยหลอดออก, ใช้กระดาษบางบังทั้งสองตัวให้เท่ากัน หรือคาลิเบรตใหม่',
    no_light: 'ไม่เห็นแสง: เปิดหลอด หันหน้าดาวเทียมเข้าหาหลอด เช็กสาย LDR',
    null_not_converged: 'หาจุดสมดุลไม่ลงตัว: เช็กว่าแสงนิ่ง ตัวขับไม่ติด แล้วเพิ่ม ctl.wait',
    no_frames: 'กล้องไม่ส่งภาพ: เช็กสายกล้อง ตั้ง cam.model แล้ว M2 INIT',
    camera_not_ready: 'กล้องไม่พร้อม: M2 INIT ก่อน ถ้ายังไม่ได้ลอง cam.model อื่น',
    target_out_of_range: 'เป้าอยู่นอกช่วงที่หมุนได้: ขยาย act.min/act.max หรือใช้ SNAP ถ่ายตรงนั้น',
    not_in_tol: 'หันได้คลาดเกิน m2.tol: วัด BACKLASH (act.bl), เพิ่ม m2.settle หรือเพิ่ม m2.tol',
    th0_out_of_range: 'ศูนย์ที่ตั้งเลื่อนไปไกลเกิน: หันเข้าหาหลอดให้ใกล้ศูนย์ก่อน CAL TH0 หรือคาลิเบรตขั้น 1–7 ใหม่',
    outside_accurate_range: 'แสงอยู่นอกช่วงที่วัดได้แม่น: หันดาวเทียมเข้าหาหลอดก่อน',
    no_zero_crossing: 'หันเข้าหลอดก่อน: ช่วงที่กวาดไม่ผ่านจุดที่สองฝั่งเท่ากัน',
    need_360deg: 'ต้องหมุนได้ 360°: SET act.max 720 ชั่วคราวแล้วทำใหม่',
    stepper_only: 'คำสั่งนี้ใช้ได้กับ stepper เท่านั้น (ตรวจ act.type)',
    too_dark: 'ภาพมืดเกินไป: เปิดไฟเพิ่ม หรือ M2 UNLOCK ให้กล้องปรับแสงเอง',
    still_sending: 'บอร์ดยังส่งภาพก่อนหน้าไม่จบ: รอสักครู่แล้วลองใหม่',
    too_big: 'ภาพใหญ่เกินไป: ลด cam.res หรือเพิ่มเลข cam.q',
    no_memory: 'หน่วยความจำไม่พอ: ลด cam.res แล้วลองใหม่ หรือรีสตาร์ตบอร์ด',
    bad_jpeg: 'ภาพจากกล้องเสีย: ถ่ายใหม่ ลด cam.res หรือเช็กสายกล้อง',
  };
  const CHIP = 'เลือก cam.model ให้ตรงชิป: ESP32-S3 ใช้ 1/2/3, ESP32-CAM ใช้ 4';
  const POWER = 'ไฟไม่พอ: ตั้ง act.hold 0, ให้ hub มีไฟเลี้ยง, แยกไฟมอเตอร์ออกจากบอร์ด';
  const LINK = 'ตรวจสาย USB, บอร์ดรีเซ็ตอยู่ไหม, ปิด Serial Monitor ของ Arduino แล้วกด "เชื่อมต่อ" ใหม่';

  // short Thai fix for an error text (ERR reply, FAULT event, toast); '' when unknown
  const errHelp = (text) => {
    const s = String(text || '');
    if (/not for this chip/i.test(s)) return CHIP;
    const m = s.match(/\bERR\s+(CMD|ARG|KEY|VAL|RANGE|PIN|BUSY|STATE|CAM|IMG|LONG|NVS)\b\s*(.*)$/);
    if (m) {
      if (m[1] === 'RANGE') {
        // the board prints limits with %g, so a big one arrives as 2e+06
        const r = m[2].match(/(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i);
        return r ? `ค่าต้องอยู่ในช่วง ${+r[1]}..${+r[2]}` : 'ค่าอยู่นอกช่วงที่ยอมรับ';
      }
      if (m[1] === 'BUSY') return `บอร์ดกำลังทำ ${m[2].trim().split(/\s+/)[0] || 'งานอื่น'} อยู่: รอให้จบ หรือกด STOP`;
      return ERR[m[1]];
    }
    for (const k of Object.keys(FAULT)) if (s.includes(k)) return FAULT[k];
    if (/BROWNOUT/i.test(s)) return POWER;
    if (/disconnected|\blost\b|หลุด/i.test(s)) return LINK;
    return '';
  };

  const worst = (a) => (a.includes('bad') ? 'bad' : a.includes('warn') ? 'warn' : 'ok');
  const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
  const make = (items, ok, warn, bad) => {
    const level = worst(items.map((i) => i.level));
    const n = items.filter((i) => i.level === 'warn').length;
    return { level, title: level === 'ok' ? `✓ ผ่าน — ${ok}` : level === 'warn' ? `! เตือน — ${warn(n)}` : `✕ ไม่ผ่าน — ${bad}`, items };
  };

  // calibration fit: o = {maeLut, maxLut, gL, gR, ambSource, nSat, gRatioUsed, rangeLo, rangeHi}
  const fitVerdict = (o) => {
    const it = [];
    const add = (level, label, value, rule) => it.push({ level, label, value, rule });
    add(!(o.maeLut < 0.6) ? 'bad' : o.maeLut < 0.3 ? 'ok' : 'warn', 'MAE (+LUT)', `${f(o.maeLut)}°`, 'ผ่าน < 0.3°, เตือน < 0.6°');
    add(o.maxLut < 1 ? 'ok' : 'warn', 'error สูงสุด', `${f(o.maxLut)}°`, '< 1°');
    add([o.gL, o.gR].every((g) => g >= 0.4 && g <= 0.9) ? 'ok' : 'warn', 'γ ซ้าย / ขวา', `${f(o.gL)} / ${f(o.gR)}`, 'ทั้งสองตัวอยู่ใน 0.4–0.9');
    add(o.ambSource === 'AMB' ? 'ok' : 'warn', 'แสงรอบข้าง', o.ambSource === 'AMB' ? 'วัดแล้ว (AMB)' : 'ไม่ได้วัดแสงรอบข้าง', 'ทำขั้นที่ 2 ก่อน Sweep');
    add(o.nSat === 0 ? 'ok' : 'warn', 'จุดที่ ADC ตัน', String(o.nSat ?? '—'), 'ต้องเป็น 0');
    add(o.gRatioUsed ? 'ok' : 'warn', 'γ สองระดับแสง', o.gRatioUsed ? 'ใช้แล้ว' : 'ยังไม่ได้วัด γ สองระดับ', 'วัดระดับ 1 และ 2 ที่ขั้นที่ 5');
    const span = o.rangeHi - o.rangeLo;
    add(span >= 50 ? 'ok' : 'warn', 'ช่วงที่วัดได้แม่น', Number.isFinite(span) ? `${f(o.rangeLo, 0)}° ถึง ${f(o.rangeHi, 0)}° (กว้าง ${f(span, 0)}°)` : '—', 'กว้าง ≥ 50°');
    return make(it, `MAE ${f(o.maeLut)}° พร้อมส่งเข้าบอร์ด`, (n) => `ใช้ได้ แต่ควรแก้ ${n} ข้อ`, `MAE ${f(o.maeLut)}° เกิน 0.6° ให้ Sweep และ Fit ใหม่`);
  };

  // validation points: m = {mae, mean, n}
  const valVerdict = (m) => {
    const it = [];
    const add = (level, label, value, rule) => it.push({ level, label, value, rule });
    add(!(m.mae < 0.6) ? 'bad' : m.mae < 0.3 ? 'ok' : 'warn', 'MAE', `${f(m.mae)}°`, 'ผ่าน < 0.3°, เตือน < 0.6°');
    add(Math.abs(m.mean) < 0.2 ? 'ok' : 'warn', 'bias เฉลี่ย', `${f(m.mean)}°`, '|bias| < 0.2° (เกินให้เพิ่ม "รอต่อจุด" หรือวัด BACKLASH ใหม่)');
    add(m.n >= 4 ? 'ok' : 'warn', 'จำนวนจุดตรวจ', String(m.n ?? '—'), 'อย่างน้อย 4 จุด');
    return make(it, `MAE ${f(m.mae)}° ตรงตามเกณฑ์`, (n) => `ยังไม่ครบเกณฑ์ ${n} ข้อ`, `MAE ${f(m.mae)}° เกิน 0.6° ให้ Sweep และ Fit ใหม่`);
  };

  // mission 1 state index (0 IDLE .. 4 LOST) -> chip text + level (muted | info | ok | bad)
  const m1Chip = (i) => ({ 0: { text: 'พัก', level: 'muted' }, 1: { text: 'ค้นหาแสง', level: 'info' }, 2: { text: 'กำลังปรับ', level: 'info' }, 3: { text: 'ล็อกแล้ว', level: 'ok' }, 4: { text: 'หาแสงไม่เจอ', level: 'bad' } }[i] || { text: '—', level: 'muted' });

  return { errHelp, fitVerdict, valVerdict, m1Chip, glyph: { ok: '✓', warn: '!', bad: '✕' } };
})();
