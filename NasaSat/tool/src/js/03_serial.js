'use strict';
// ===== Web Serial transport =====
// same USB device (VID:PID) = the board that was lost: a board with USB built in comes back as a NEW port object
// after every reset, so it is found again by these numbers (Web Serial gives nothing more specific)
NS.samePort = (a, b) => !!a && !!b && !!a.usbVendorId && a.usbVendorId === b.usbVendorId && a.usbProductId === b.usbProductId;

NS.SerialTransport = class {
  constructor() {
    this.kind = 'serial';
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.onLine = () => {};
    this.onStatus = () => {};
    this.keep = false;
    this.enc = new TextEncoder();
    this.writeChain = Promise.resolve();
  }
  static supported() { return typeof navigator !== 'undefined' && 'serial' in navigator; }

  async connect(opt = {}) {
    const port = opt.port || (await navigator.serial.requestPort({}));
    await port.open({ baudRate: +opt.baud || 115200, bufferSize: 1 << 16 });
    this.port = port;
    if (opt.dtr === 'low') await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    else if (opt.dtr === 'high') await port.setSignals({ dataTerminalReady: true, requestToSend: true });
    this.writer = port.writable.getWriter();
    this.keep = true;
    this.readLoop();
    const info = port.getInfo ? port.getInfo() : {};
    this.onStatus('open', info);
    return info;
  }

  async readLoop() {
    const dec = new TextDecoder();
    let buf = '';
    while (this.port && this.port.readable && this.keep) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).replace(/\r$/, '');
            buf = buf.slice(i + 1);
            if (line.length) { try { this.onLine(line); } catch (e) { console.error('line handler', e); } } // a UI bug must never stop reading
          }
          if (buf.length > 1 << 20) buf = '';
        }
      } catch (e) {
        if (this.keep) this.onStatus('error', e.message);
        break;
      } finally {
        try { this.reader.releaseLock(); } catch (_) { /* ignore */ }
      }
    }
    if (this.keep) { this.keep = false; this.onStatus('lost'); }
  }

  write(line) {
    if (!this.writer) return Promise.reject(new Error('ยังไม่เชื่อมต่อ'));
    const data = this.enc.encode(line + '\n');
    this.writeChain = this.writeChain.then(() => this.writer.write(data)).catch((e) => { this.onStatus('error', e.message); });
    return this.writeChain;
  }

  async resetPulse() {
    if (!this.port) return;
    // RTS -> EN low (reset) while DTR stays false (GPIO0 high = normal boot)
    await this.port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await NS.sleep(120);
    await this.port.setSignals({ dataTerminalReady: false, requestToSend: false });
  }

  async disconnect() {
    this.keep = false;
    try { if (this.reader) await this.reader.cancel(); } catch (_) { /* ignore */ }
    try { if (this.writer) this.writer.releaseLock(); } catch (_) { /* ignore */ }
    try { if (this.port) await this.port.close(); } catch (_) { /* ignore */ }
    this.port = null;
    this.writer = null;
    this.onStatus('closed');
  }
};
