// Drives a host-compiled firmware (build.js) like the web tool drives a board: line protocol on stdin/stdout,
// harness commands (!RUN / !WORLD / !TRUTH) to advance simulated time and read the hidden truth.
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const toolJs = path.join(__dirname, '..', '..', 'tool', 'src', 'js');
for (const f of ['01_util.js', '02_protocol.js', '04_estimator.js', '05_fit.js', '06_cfgdefs.js']) require(path.join(toolJs, f));
const NS = globalThis.NS;
const verbose = process.argv.includes('--verbose');

// ------------------------------------------------------------------ the board process
class Board {
  constructor(file, stateDir) {
    this.file = file;
    this.stateDir = stateDir;
    this.pending = [];        // resolvers for harness replies, answered in order
    this.cur = [];            // firmware lines of the current !RUN
    this.all = [];            // every firmware line of the session
    this.bad = [];
    this.warn = [];
    this.images = [];
    this.restarted = 0;
    this.lastDone = null;
    this.drop = null;          // Map seq -> how many times to lose that IMG C line
    this.dropped = 0;
    this.asm = new NS.ImageAssembler((img) => this.images.push(img), (id, miss) => this.send(`IMG GET ${id} ${miss.join(',')}`));
    // what a ground station on the second port (radio) receives; it asks for missing image chunks over the radio
    this.link = [];
    this.linkImages = [];
    this.linkAsm = new NS.ImageAssembler((img) => this.linkImages.push(img), (id, miss) => this.linkSend(`IMG GET ${id} ${miss.join(',')}`));
  }
  start(resume = false) {
    return new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.buf = '';
      // E2E_SEED=n changes the simulated noise: run a few seeds to see whether a result is robust or just lucky
      const args = ['--state', this.stateDir, ...(resume ? ['--resume'] : []), ...(process.env.E2E_SEED ? ['--seed', process.env.E2E_SEED] : [])];
      this.p = spawn(this.file, args, { stdio: ['pipe', 'pipe', 'inherit'] });
      this.p.stdout.setEncoding('latin1');
      this.p.stdout.on('data', (d) => this.onData(d));
      this.p.on('error', reject);
      this.p.on('close', (code) => this.onExit(code)); // 'close' = all output of this process delivered
    });
  }
  onExit(code) {
    if (code === 3) { // ESP.restart(): boot again from the saved flash + world
      this.restarted++;
      const run = this.pending.find((p) => p.kind === '!DONE');
      this.start(true).then(() => {
        if (run) { this.pending.splice(this.pending.indexOf(run), 1); run.resolve(this.take()); }
      });
    } else if (this.pending.length) {
      console.log(`board exited (${code}) with pending requests`);
      for (const p of this.pending.splice(0)) p.resolve(null);
    }
  }
  onData(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      if (line) this.onLine(line);
    }
  }
  onLine(line) {
    if (verbose) console.log('    | ' + line.slice(0, 200));
    if (line[0] === '!') {
      if (line === '!READY') { const r = this.readyResolve; this.readyResolve = null; if (r) r(); return; }
      if (line.startsWith('!LINK ')) {
        const m = NS.parseLine(line.slice(6));
        m.raw = line.slice(6);
        if (m.kind === 'img') this.linkAsm.handle(m.parts);
        this.link.push(m);
        return;
      }
      if (line.startsWith('!WDT') || line.startsWith('!WARN') || line.startsWith('!NVS')) { this.warn.push(line); return; }
      if (line === '!RESTART') return;
      const kind = line.startsWith('!DONE') ? '!DONE' : line.startsWith('!TRUTH') ? '!TRUTH' : '!OK';
      const idx = this.pending.findIndex((p) => p.kind === kind || (kind === '!OK' && p.kind === '!OK'));
      if (idx >= 0) {
        const p = this.pending.splice(idx, 1)[0];
        if (kind === '!DONE') { this.lastDone = line; p.resolve(this.take()); } else p.resolve(line);
      }
      return;
    }
    const m = NS.parseLine(line);
    m.raw = line;
    if (m.kind === 'bad' || (m.kind === 'text' && line.trim())) this.bad.push(line);
    if (m.kind === 'img' && m.parts[0] === 'C' && this.drop && (this.drop.get(+m.parts[2]) || 0) > 0) {
      this.drop.set(+m.parts[2], this.drop.get(+m.parts[2]) - 1); // simulate a chunk lost on the cable
      this.dropped++;
    } else if (m.kind === 'img') this.asm.handle(m.parts);
    this.cur.push(m);
    this.all.push(m);
  }
  take() { const c = this.cur; this.cur = []; return c; }
  send(line) { this.p.stdin.write(line + '\n'); }
  linkSend(line) { this.p.stdin.write('!LINKIN ' + line + '\n'); }
  req(line, kind) { return new Promise((resolve) => { this.pending.push({ kind, resolve }); this.send(line); }); }
  run(ms) { return this.req(`!RUN ${ms}`, '!DONE'); }
  async cmd(line, ms = 60) { this.send(line); return this.run(ms); }
  async truth() { const l = await this.req('!TRUTH', '!TRUTH'); return JSON.parse(l.slice(7)); }
  async world(k, v) { return this.req(`!WORLD ${k} ${v}`, '!OK'); }
  // run in slices until pred(line) matches; returns {hit, lines, ms}
  async until(pred, maxMs, slice = 100) {
    const lines = [];
    for (let t = 0; t < maxMs; t += slice) {
      const got = await this.run(slice);
      if (!got) break;
      lines.push(...got);
      const hit = got.find(pred);
      if (hit) return { hit, lines, ms: t + slice };
    }
    return { hit: null, lines, ms: maxMs };
  }
  quit() { return this.req('!QUIT', '!OK'); }
}

const isJ = (type) => (m) => m.kind === 'j' && m.json.type === type;
const isE = (evt, arg0) => (m) => m.kind === 'e' && m.evt === evt && (arg0 === undefined || m.args[0] === arg0);
const okOf = (lines) => lines.filter((m) => m.kind === 'ok');
const errOf = (lines) => lines.filter((m) => m.kind === 'err');
const jOf = (lines, type) => lines.filter(isJ(type)).map((m) => m.json);

module.exports = { NS, Board, isJ, isE, okOf, errOf, jOf };
