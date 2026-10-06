'use strict';
// ===== Web Bluetooth transport (Nordic UART service of the SunSeek board) =====
// Same interface as NS.SerialTransport (kind, connect, write, onLine, onStatus, disconnect, keep) so every page that talks
// SunSeek over USB talks it over Bluetooth through the same path. Used when the USB cable would hold the satellite on its
// turntable. Only ONE BLE central can be connected to the board: the organizer's Ground Station has to be disconnected first.
//   board -> host : notifications on TX, one line + "\n" each (<= 182 bytes); buffered and split on "\n" anyway
//   host -> board : writes on RX; the firmware rebuilds lines at "\n", so a line may be cut into pieces (<= 100 bytes each)
NS.BLE = {
  NAME_PREFIX: 'SUNSEEK',
  SERVICE: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  RX: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', // we write here (WRITE and WRITE_NR)
  TX: '6e400003-b5a3-f393-e0a9-e50e24dcca9e', // the board notifies here
  CHUNK: 100,
};

// bytes -> pieces of at most `max` bytes (the last one may be shorter); never empty pieces
NS.bleChunks = (data, max = NS.BLE.CHUNK) => {
  const u = data instanceof Uint8Array ? data : new Uint8Array(data);
  const m = Math.max(1, Math.floor(max) || NS.BLE.CHUNK);
  const out = [];
  for (let i = 0; i < u.length; i += m) out.push(u.subarray(i, Math.min(u.length, i + m)));
  return out;
};

// notification bytes -> complete lines. A line may arrive in several pieces, several lines in one piece; "\r" at the end is
// dropped; an empty line is dropped; a character split between two pieces is decoded whole.
NS.LineBuffer = class {
  constructor(maxLen = 1 << 16) { this.maxLen = maxLen; this.reset(); }
  reset() { this.dec = new TextDecoder(); this.buf = ''; }
  push(x) { // Uint8Array | DataView | ArrayBuffer | string -> [line, ...]
    let s;
    if (typeof x === 'string') s = x;
    else {
      const u = x instanceof Uint8Array ? x : ArrayBuffer.isView(x) ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength) : new Uint8Array(x);
      s = this.dec.decode(u, { stream: true });
    }
    this.buf += s;
    const out = [];
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      if (line.length) out.push(line);
    }
    if (this.buf.length > this.maxLen) this.buf = ''; // a stream that never ends a line must not grow without limit
    return out;
  }
};

// Short Thai hint for the error of requestDevice / gatt.connect (the browser's own text is English)
NS.bleErrHelp = (e) => {
  const n = e && e.name ? e.name : '';
  const m = e && e.message ? e.message : String(e || '');
  if (/cancel/i.test(m) || (n === 'NotFoundError' && /chooser|selected/i.test(m))) return '';
  if (/adapter|not available|powered|turned off/i.test(m)) return 'เปิด Bluetooth ของคอมพิวเตอร์ (Windows: Settings > Bluetooth) แล้วลองใหม่';
  if (n === 'NotFoundError') return 'ไม่พบบริการ Nordic UART ในอุปกรณ์นี้: เลือกบอร์ดที่ชื่อ SUNSEEK-… (ถ้าเลือกอุปกรณ์อื่นจะต่อไม่ได้)';
  if (n === 'SecurityError') return 'เบราว์เซอร์ไม่ให้ใช้ Bluetooth ในหน้านี้: เปิดไฟล์ด้วย Chrome หรือ Edge โดยตรง (ไม่ใช่ใน iframe)';
  if (/GATT|connect|Network|disconnected|timeout|Unsupported/i.test(n + ' ' + m)) return 'ต่อบอร์ดไม่ติด: ตรวจว่า Ground Station ของผู้จัด (หรือแอปอื่น) ตัดการเชื่อมต่อแล้ว บอร์ดมีไฟ และอยู่ใกล้คอม แล้วลองใหม่';
  return '';
};

NS.BleTransport = class {
  // o.bluetooth: the object that has requestDevice() (navigator.bluetooth; tests pass a fake)
  constructor(o = {}) {
    this.kind = 'ble';
    this.bt = o.bluetooth || (typeof navigator !== 'undefined' ? navigator.bluetooth : null);
    this.chunk = o.chunk > 0 ? o.chunk : NS.BLE.CHUNK;
    this.device = null;
    this.server = null;
    this.rx = null;
    this.tx = null;
    this.onLine = () => {};
    this.onStatus = () => {};
    this.keep = false; // true while the link is up and wanted (same meaning as the serial transport)
    this.enc = new TextEncoder();
    this.lines = new NS.LineBuffer();
    this.writeChain = Promise.resolve();
    this.noResp = false; // writeValueWithResponse refused once: use writeValue
    this._hooked = null;
    this._onNotify = (ev) => this._notify(ev);
    this._onGone = () => {
      if (!this.keep) return; // a close we asked for, or a connection attempt that failed
      this.keep = false;
      this._release();
      this.onStatus('lost');
    };
  }
  static supported() { return typeof navigator !== 'undefined' && !!navigator.bluetooth; }

  // opt.device: a BluetoothDevice that was chosen before (no chooser) · opt.all: list every device, not only SUNSEEK-*
  async connect(opt = {}) {
    let device = opt.device;
    if (!device) {
      if (!this.bt) throw new Error('เบราว์เซอร์นี้ไม่มี Web Bluetooth');
      const req = { optionalServices: [NS.BLE.SERVICE] };
      if (opt.all) req.acceptAllDevices = true; else req.filters = [{ namePrefix: NS.BLE.NAME_PREFIX }];
      device = await this.bt.requestDevice(req);
    }
    this.device = device;
    if (this._hooked !== device) {
      if (this._hooked) { try { this._hooked.removeEventListener('gattserverdisconnected', this._onGone); } catch (_) { /* ignore */ } }
      device.addEventListener('gattserverdisconnected', this._onGone);
      this._hooked = device;
    }
    return this._open();
  }

  async _open() {
    const device = this.device;
    try {
      this.lines.reset();
      const server = await device.gatt.connect();
      const svc = await server.getPrimaryService(NS.BLE.SERVICE);
      const rx = await svc.getCharacteristic(NS.BLE.RX);
      const tx = await svc.getCharacteristic(NS.BLE.TX);
      tx.addEventListener('characteristicvaluechanged', this._onNotify);
      await tx.startNotifications();
      this.server = server; this.rx = rx; this.tx = tx;
      this.writeChain = Promise.resolve();
      this.keep = true;
    } catch (e) {
      this._teardown();
      throw e;
    }
    const info = { name: device.name || '', id: device.id || '' };
    this.onStatus('open', info);
    return info;
  }

  _notify(ev) {
    const v = ev && ev.target && ev.target.value;
    if (!v) return;
    for (const line of this.lines.push(v)) { try { this.onLine(line); } catch (e) { console.error('line handler', e); } } // a UI bug must never stop reading
  }

  _release() {
    try { if (this.tx) this.tx.removeEventListener('characteristicvaluechanged', this._onNotify); } catch (_) { /* ignore */ }
    this.tx = null;
    this.rx = null;
    this.server = null;
  }
  _teardown() { // half-open link after a failed attempt: leave nothing behind
    this.keep = false;
    const tx = this.tx;
    this._release();
    try { if (tx) Promise.resolve(tx.stopNotifications()).catch(() => {}); } catch (_) { /* ignore */ }
    try { if (this.device && this.device.gatt && this.device.gatt.connected) this.device.gatt.disconnect(); } catch (_) { /* ignore */ }
  }

  // Lines go out one at a time (Chrome refuses a second GATT write while one is running); each line + "\n" is cut into
  // pieces of at most `chunk` bytes. The promise rejects when the write fails, the chain itself goes on.
  write(line) {
    if (!this.rx || !this.keep) return Promise.reject(new Error('ยังไม่เชื่อมต่อ'));
    const data = this.enc.encode(line + '\n');
    const p = this.writeChain.then(() => this._writeLine(data));
    this.writeChain = p.catch(() => {});
    return p;
  }
  async _writeLine(data) {
    for (const piece of NS.bleChunks(data, this.chunk)) {
      if (!this.rx || !this.keep) throw new Error('ยังไม่เชื่อมต่อ');
      await this._writePiece(piece);
    }
  }
  async _writePiece(piece) {
    for (let attempt = 0; ; attempt++) {
      const rx = this.rx;
      if (!rx) throw new Error('ยังไม่เชื่อมต่อ');
      try {
        if (!this.noResp && typeof rx.writeValueWithResponse === 'function') await rx.writeValueWithResponse(piece);
        else await rx.writeValue(piece);
        return;
      } catch (e) {
        const msg = e && e.message ? e.message : '';
        if (/in progress/i.test(msg) && attempt < 4) { await NS.sleep(40 * (attempt + 1)); continue; } // another GATT operation is still running
        if (!this.noResp && typeof rx.writeValue === 'function' && (e && (e.name === 'NotSupportedError' || e.name === 'TypeError'))) { this.noResp = true; continue; }
        throw e;
      }
    }
  }

  // The same device again, without the chooser. One attempt: resolves when the link and the notifications are up.
  reopen() {
    if (!this.device) return Promise.reject(new Error('ยังไม่เคยเชื่อมต่ออุปกรณ์'));
    return this._open();
  }
  // Tries again every `every` ms for `ms` ms (like the serial transport looking for the lost port); stop() = give up now.
  // One attempt that hangs (device out of range) is cut after `attemptMs`.
  async reconnect({ ms = 30000, every = 1500, attemptMs = 10000, stop = () => false } = {}) {
    const t0 = Date.now();
    let last = new Error('ต่อไม่สำเร็จ');
    while (Date.now() - t0 < ms && !stop()) {
      let timer;
      try {
        const attempt = this.reopen();
        const guard = new Promise((_, rej) => { timer = setTimeout(() => { try { this.device.gatt.disconnect(); } catch (_) { /* ignore */ } rej(new Error('หมดเวลาต่อ')); }, attemptMs); });
        const info = await Promise.race([attempt, guard]);
        clearTimeout(timer);
        return info;
      } catch (e) {
        clearTimeout(timer);
        last = e;
      }
      if (stop()) break;
      await NS.sleep(every);
    }
    throw last;
  }

  async disconnect() {
    const wasUp = this.keep;
    this.keep = false; // before the disconnect: our own close must not look like a lost link
    const tx = this.tx;
    const up = !!(this.device && this.device.gatt && this.device.gatt.connected);
    this._release();
    try { if (tx && up) await tx.stopNotifications(); } catch (_) { /* ignore */ }
    try { if (up) this.device.gatt.disconnect(); } catch (_) { /* ignore */ }
    this.onStatus('closed', wasUp ? 'ble' : '');
  }
  close() { return this.disconnect(); }
};
