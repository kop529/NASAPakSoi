// Quick report of a TEAM_CDUMP file: node cdump_report.js <file>
// approach time, overshoot, HOLD, kicks (in / out of HOLD), wheel saturation, row spacing (loop jitter), last 20 s.
'use strict';
const fs = require('fs');
const f = process.argv[2];
const rows = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('TM,TEAM_CR,'))
  .map((l) => l.split(',').slice(2).map(Number))
  .map(([i, t, tgt, ang, est, err, gz, u, I, K, rw, fl]) => ({ i, t, tgt, ang, est, err, gz, u, I, K, rw, fl }));
const t0 = rows[0].t;
rows.forEach((r) => { r.s = (r.t - t0) / 1000; r.e = r.ang - r.tgt; });
const a0 = rows[0].e, sg = Math.sign(a0);
const first = (pred) => rows.find(pred);
const in3 = first((r) => Math.abs(r.e) < 3), in1 = first((r) => Math.abs(r.e) < 1);
const cross = first((r) => Math.sign(r.e) === -sg);
const after = cross ? rows.filter((r) => r.s >= cross.s && r.s <= cross.s + 10) : [];
const over = after.length ? Math.max(...after.map((r) => -sg * r.e)) : 0;
const holdOn = first((r) => r.fl & 2);
const kicks = rows.filter((r, k) => k && Math.abs(r.K - rows[k - 1].K) > 5).map((r) => ({ s: r.s, K: r.K, ang: r.ang, hold: !!(rows[rows.indexOf(r) - 1].fl & 2) }));
const sat = rows.filter((r) => r.fl & 24).length;
const d = rows.slice(1).map((r, k) => r.t - rows[k].t).sort((p, q) => p - q);
const q = (p) => d[Math.min(d.length - 1, Math.floor(p * d.length))];
const end = rows.filter((r) => r.s >= rows[rows.length - 1].s - 20);
const mean = end.reduce((a, r) => a + r.e, 0) / end.length;
const sd = Math.sqrt(end.reduce((a, r) => a + (r.e - mean) ** 2, 0) / end.length);
const big = rows.filter((r) => Math.abs(r.gz) > 30 && r.s > (in3 ? in3.s + 2 : 5));
console.log(`file ${f.split(/[\\/]/).pop()} · ${rows.length} rows · ${rows[rows.length - 1].s.toFixed(1)} s`);
console.log(`start ${a0.toFixed(1)} deg · within 3 deg at ${in3 ? in3.s.toFixed(1) : '-'} s · within 1 deg at ${in1 ? in1.s.toFixed(1) : '-'} s · overshoot ${over.toFixed(1)} deg${cross ? ` (crossed at ${cross.s.toFixed(1)} s)` : ' (never crossed)'}`);
console.log(`HOLD first ON at ${holdOn ? holdOn.s.toFixed(1) : '-'} s · rows in HOLD ${rows.filter((r) => r.fl & 2).length}/${rows.length} · wheel at limit ${sat} rows`);
console.log(`kicks ${kicks.length}: ${kicks.map((k) => `${k.s.toFixed(1)}s K${k.K} ang${k.ang}${k.hold ? ' IN-HOLD' : ''}`).join(' | ') || 'none'}`);
console.log(`row spacing ms: p50 ${q(0.5)} p95 ${q(0.95)} max ${d[d.length - 1]} (nominal 40; team-3 runs: p95 60-69, max 85-97)`);
console.log(`last 20 s: mean ${mean.toFixed(2)} sd ${sd.toFixed(2)} min ${Math.min(...end.map((r) => r.e)).toFixed(2)} max ${Math.max(...end.map((r) => r.e)).toFixed(2)} deg · rw ${end[end.length - 1].rw} I ${end[end.length - 1].I}`);
console.log(`fast body moves (|gz| > 30 deg/s after settling): ${big.length ? `${big.length} rows, first at ${big[0].s.toFixed(1)} s (hand push?)` : 'none'}`);
console.log(`EST vs ANG max gap while turning (|gz| > 20): ${Math.max(0, ...rows.filter((r) => Math.abs(r.gz) > 20).map((r) => Math.abs(r.est - r.ang))).toFixed(1)} deg (team-3 MA10: 3.7)`);
