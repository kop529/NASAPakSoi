// 1,000,000 mission-fuzz runs in chunks, run inside WSL: node fuzz1m.js
// - never more than nproc-1 workers; alternates between nproc-2 and nproc-1 every 10 min, and drops to nproc-2 while the
//   1-min load says something else is busy
// - each chunk is pinned (taskset) to the core that has been idle longest, so work moves over all cores
// - low priority (nice 15); board config = adcs.lock 1 (saved on the board 7 Oct 23:05)
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const DIR = __dirname, OUT = path.join(DIR, 'f1m');
const TOTAL = 1000000, CHUNK = 2500, NCPU = os.cpus().length;
const SET = process.env.MFUZZ_SET || 'adcs.lock=1';
fs.mkdirSync(OUT, { recursive: true });
const chunks = Array.from({ length: TOTAL / CHUNK }, (_, i) => i).filter((i) => !fs.existsSync(path.join(OUT, `c${String(i).padStart(3, '0')}.txt`)));
const lastUsed = Array(NCPU).fill(0), busy = Array(NCPU).fill(false);
let running = 0, done = TOTAL / CHUNK - chunks.length, t0 = Date.now();
const log = (s) => { const l = `${new Date().toTimeString().slice(0, 8)} ${s}`; console.log(l); fs.appendFileSync(path.join(OUT, 'progress.txt'), l + '\n'); };
const limit = () => {
  const phase = Math.floor((Date.now() - t0) / 600000) % 2;   // 10 min with nproc-2, 10 min with nproc-1
  let w = phase ? NCPU - 1 : NCPU - 2;
  if (os.loadavg()[0] > running + 1.5) w = NCPU - 2;          // something else wants the CPU
  return Math.max(1, w);
};
const pickCore = () => {
  let best = -1;
  for (let c = 0; c < NCPU; c++) if (!busy[c] && (best < 0 || lastUsed[c] < lastUsed[best])) best = c;
  return best;
};
const startOne = () => {
  if (!chunks.length) return false;
  const core = pickCore(); if (core < 0) return false;
  const i = chunks.shift(), seed = i * CHUNK + 1;
  busy[core] = true; lastUsed[core] = Date.now(); running++;
  const file = path.join(OUT, `c${String(i).padStart(3, '0')}.txt`), tmp = file + '.part';
  const p = spawn('nice', ['-n', '15', 'taskset', '-c', String(core), 'node', path.join(DIR, 'fuzzrun.js')],
    { env: { ...process.env, MFUZZ_N: String(CHUNK), MFUZZ_SEED: String(seed), MFUZZ_SET: SET }, stdio: ['ignore', 'pipe', 'pipe'] });
  let txt = '';
  p.stdout.on('data', (d) => { txt += d; }); p.stderr.on('data', (d) => { txt += d; });
  p.on('close', (code) => {
    fs.writeFileSync(tmp, txt); fs.renameSync(tmp, file);
    busy[core] = false; lastUsed[core] = Date.now(); running--; done++;
    const fail = /[1-9]\d* failed/.test(txt) || code !== 0;
    log(`chunk ${i} (seeds ${seed}..${seed + CHUNK - 1}) core ${core} ${fail ? 'FAIL' : 'ok'} · ${done}/${TOTAL / CHUNK} done · workers ${running}/${limit()}`);
    fill();
  });
  return true;
};
const fill = () => {
  while (running < limit() && startOne());
  if (!running && !chunks.length) { log(`ALL DONE in ${((Date.now() - t0) / 60000).toFixed(0)} min`); summarize(); clearInterval(tick); }
};
const summarize = () => {
  let runs = 0, photos = 0, worst = 0, fails = [];
  for (const f of fs.readdirSync(OUT).filter((f) => /^c\d+\.txt$/.test(f)).sort()) {
    const t = fs.readFileSync(path.join(OUT, f), 'utf8');
    const m = t.match(/(\d+) complete, (\d+) photos; .*worst photo error ([\d.]+) deg/);
    const n = t.match(/(\d+) random missions/);
    if (n) runs += +n[1]; if (m) { photos += +m[2]; worst = Math.max(worst, +m[3]); }
    t.split('\n').filter((l) => /FAIL/.test(l)).forEach((l) => fails.push(`${f}: ${l.trim()}`));
  }
  const s = [`runs ${runs}, photos ${photos}, worst photo error (|target| <= 40) ${worst} deg, board set ${SET}`, `FAIL lines: ${fails.length}`, ...fails].join('\n');
  fs.writeFileSync(path.join(OUT, 'SUMMARY.txt'), s + '\n'); console.log(s);
};
const tick = setInterval(fill, 30000);   // re-check the worker limit (10-min phases, load)
log(`start: ${chunks.length} chunks of ${CHUNK}, ${NCPU} cores, set ${SET}`);
fill();
