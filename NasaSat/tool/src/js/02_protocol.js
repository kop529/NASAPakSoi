'use strict';
// ===== protocol: line format shared by firmware, tool and simulator =====
// host -> board : "[@id] CMD args..."
// board -> host : "@id OK ..." | "@id ERR code msg" | "TH,cols..." | "T,vals..." | "J {json}"
//                 | "E EVENT args" | "# text" | "IMG B|C|E ..."  (optional "*XXXX" CRC-16 suffix)

NS.crc16 = function (str) { // CRC-16/CCITT-FALSE over the ASCII bytes of a line
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= (str.charCodeAt(i) & 0xff) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
};

NS.crc32 = (() => {
  const tbl = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tbl[n] = c >>> 0;
  }
  return (bytes) => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = tbl[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

NS.b64ToBytes = (b64) => {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};
NS.bytesToB64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};

NS.withCrc = (line) => `${line}*${NS.crc16(line).toString(16).toUpperCase().padStart(4, '0')}`;

NS.parseLine = function (raw) {
  let line = String(raw).replace(/\r$/, '');
  const out = { raw: line, kind: 'text', id: null };
  const mc = line.match(/^(.*)\*([0-9A-Fa-f]{4})$/);
  if (mc) {
    if (NS.crc16(mc[1]) !== parseInt(mc[2], 16)) { out.kind = 'bad'; out.why = 'crc'; return out; }
    line = mc[1];
  }
  const mi = line.match(/^@(\d+)\s+(.*)$/);
  if (mi) { out.id = +mi[1]; line = mi[2]; }
  if (line === 'OK' || line.startsWith('OK ')) { out.kind = 'ok'; out.text = line.slice(2).trim(); }
  else if (line === 'ERR' || line.startsWith('ERR ')) {
    out.kind = 'err';
    const rest = line.slice(3).trim();
    const sp = rest.indexOf(' ');
    out.code = sp < 0 ? rest : rest.slice(0, sp);
    out.text = sp < 0 ? '' : rest.slice(sp + 1);
  } else if (line.startsWith('TH,')) { out.kind = 'th'; out.cols = line.slice(3).split(',').map((s) => s.trim()); }
  else if (line.startsWith('T,')) { out.kind = 't'; out.vals = line.slice(2).split(',').map(Number); }
  else if (line.startsWith('J ')) {
    try { out.json = JSON.parse(line.slice(2)); out.kind = 'j'; } catch (e) { out.kind = 'bad'; out.why = 'json'; }
  } else if (line.startsWith('E ')) {
    const p = line.slice(2).trim().split(/\s+/);
    out.kind = 'e'; out.evt = p[0]; out.args = p.slice(1);
  } else if (line.startsWith('IMG ')) { out.kind = 'img'; out.parts = line.slice(4).trim().split(/\s+/); }
  else if (line.startsWith('#')) { out.kind = 'info'; out.text = line.slice(1).trim(); }
  return out;
};

// Re-assembles "IMG B id bytes nchunks crc32hex" / "IMG C id seq base64" / "IMG E id".
// Never throws: a chunk that cannot be decoded counts as missing; after `maxRetries` resend requests the image
// finishes as { ok: false } so the caller can report a failed photo and keep going. Call poll() about once a
// second so an image whose "IMG E" line was lost (cable, reset) also ends instead of waiting forever.
NS.ImageAssembler = class {
  constructor(onImage, requestMissing, o = {}) {
    this.onImage = onImage;
    this.requestMissing = requestMissing;
    this.cur = new Map();
    this.maxRetries = o.maxRetries ?? 3;
    this.stallMs = o.stallMs ?? 6000;
  }
  handle(parts) {
    const kind = parts[0];
    const id = parts[1];
    const t = Date.now();
    if (kind === 'B') {
      const n = Math.max(0, Math.floor(+parts[3]) || 0);
      this.cur.set(id, { id, bytes: +parts[2], n, crc: parseInt(parts[4], 16) >>> 0, chunks: new Array(n).fill(null), got: 0, t0: t, last: t, retries: 0 });
    } else if (kind === 'C') {
      const img = this.cur.get(id);
      if (!img) return;
      img.last = t;
      const seq = Number(parts[2]);
      if (!Number.isInteger(seq) || seq < 0 || seq >= img.n || img.chunks[seq] !== null) return;
      let u8 = null;
      try { u8 = NS.b64ToBytes(parts[3] || ''); } catch (_) { u8 = null; } // damaged line = still missing
      if (u8 && u8.length) { img.chunks[seq] = u8; img.got++; }
    } else if (kind === 'E') {
      const img = this.cur.get(id);
      if (img) this.settle(img, t);
    }
  }
  missing(img) {
    const m = [];
    for (let i = 0; i < img.n; i++) if (img.chunks[i] === null) m.push(i);
    return m;
  }
  settle(img, t) {
    const miss = this.missing(img);
    if (miss.length && img.retries < this.maxRetries) {
      img.retries++;
      img.last = t;
      try { this.requestMissing(img.id, miss); } catch (_) { /* transport gone: the stall timer ends it */ }
      return;
    }
    this.finish(img, miss);
  }
  finish(img, miss) {
    this.cur.delete(img.id);
    let total = 0;
    for (const c of img.chunks) if (c) total += c.length;
    const u8 = new Uint8Array(total);
    let o = 0;
    for (const c of img.chunks) if (c) { u8.set(c, o); o += c.length; }
    const crc = NS.crc32(u8);
    this.onImage({ id: img.id, bytes: u8, ok: !miss.length && crc === img.crc && total === img.bytes, crc, ms: Date.now() - img.t0, missing: miss.length, retries: img.retries });
  }
  poll(t = Date.now()) {
    for (const img of [...this.cur.values()]) if (t - img.last > this.stallMs) this.settle(img, t);
  }
};
