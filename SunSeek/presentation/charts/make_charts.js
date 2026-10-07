// Slide charts from the black box dumps (TEAM_CDUMP) -> charts/*.svg + *.html (render to PNG with headless Edge).
// Palette (validated, dark, surface #0A0C09): lime #8E9E1F, blue #4F8FE8, pink #D0689C.
'use strict';
const fs = require('fs');
const path = require('path');
const LOGS = path.join(__dirname, '../../setup_logs');
const OUT = __dirname;
const C = { lime: '#8E9E1F', blue: '#4F8FE8', pink: '#D0689C', text: '#F1F3EE', muted: '#A3AA9C', grid: '#2C3328', bg: '#0A0C09' };

const load = (f) => {
  const rows = fs.readFileSync(path.join(LOGS, f), 'utf8').split(/\r?\n/).filter((l) => l.startsWith('TM,TEAM_CR,'))
    .map((l) => l.split(',').slice(2).map(Number))
    .map(([i, t, tgt, ang, est, err, gz, u, I, K, rw, fl]) => ({ i, t, tgt, ang, est, err, gz, u, I, K, rw, fl }));
  const t0 = rows[0].t;
  let g = rows[0].ang;
  rows.forEach((r, k) => {
    r.s = (r.t - t0) / 1000;
    if (k) g += r.gz * (r.t - rows[k - 1].t) / 1000;
    r.gyro = g;  // angle from the gyro alone, started at the sun angle at AUTO entry
  });
  return rows;
};
const a = load('cdump_20261006_2013.txt');  // kd 1
const b = load('cdump_20261006_2030.txt');  // kd 2 + HOLD 1.5/3

const W = 1600, ML = 130, MR = 60, MT = 70, MB = 90;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const ticks = (lo, hi, n) => {
  const step0 = (hi - lo) / n, p = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= step0);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
};
// panels stacked on one shared x axis (small multiples, one y scale each - never a dual axis)
function chart({ name, H = 800, x: [x0, x1], xLabel, panels, legend }) {
  const mt = legend ? 110 : MT;  // room for the legend row
  const gap = 90, ph = (H - mt - MB - gap * (panels.length - 1)) / panels.length;
  const X = (v) => ML + (v - x0) / (x1 - x0) * (W - ML - MR);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="'IBM Plex Sans Thai',sans-serif">`;
  svg += `<rect width="${W}" height="${H}" fill="${C.bg}"/>`;
  if (legend) {
    let lx = ML;
    for (const [label, color] of legend) {
      svg += `<line x1="${lx}" y1="30" x2="${lx + 36}" y2="30" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`;
      svg += `<text x="${lx + 48}" y="38" font-size="29" fill="${C.text}">${esc(label)}</text>`;
      lx += 48 + label.length * 16 + 60;
    }
  }
  panels.forEach((p, k) => {
    const top = mt + k * (ph + gap), bot = top + ph;
    const [y0, y1] = p.y;
    const Y = (v) => bot - (v - y0) / (y1 - y0) * ph;
    for (const v of ticks(y0, y1, 4)) {
      svg += `<line x1="${ML}" x2="${W - MR}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C.grid}" stroke-width="${v === 0 ? 2 : 1}"/>`;
      svg += `<text x="${ML - 14}" y="${Y(v) + 8}" font-size="27" fill="${C.muted}" text-anchor="end">${v}</text>`;
    }
    svg += `<text x="${ML}" y="${top - 14}" font-size="27" fill="${C.muted}">${esc(p.yLabel)}</text>`;
    for (const band of p.bands || []) svg += `<rect x="${X(band[0])}" y="${top}" width="${X(band[1]) - X(band[0])}" height="${ph}" fill="${C.text}" opacity="0.05"/>`;
    svg += `<clipPath id="c${name}${k}"><rect x="${ML}" y="${top}" width="${W - ML - MR}" height="${ph}"/></clipPath><g clip-path="url(#c${name}${k})">`;
    for (const s of p.series) {
      const d = s.pts.filter(([u]) => u >= x0 && u <= x1).map(([u, v], i) => `${i ? 'L' : 'M'}${X(u).toFixed(1)},${Y(v).toFixed(1)}`).join('');
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w || 3}" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    for (const m of p.marks || []) svg += `<circle cx="${X(m[0])}" cy="${Y(m[1])}" r="8" fill="${m[2]}" stroke="${C.bg}" stroke-width="2"/>`;
    svg += '</g>';
    for (const n of p.notes || []) svg += `<text x="${X(n[0])}" y="${Y(n[1])}" font-size="27" fill="${C.text}" text-anchor="${n[3] || 'start'}">${esc(n[2])}</text>`;
    if (k === panels.length - 1) {
      for (const v of ticks(x0, x1, 8)) svg += `<text x="${X(v)}" y="${bot + 34}" font-size="27" fill="${C.muted}" text-anchor="middle">${v}</text>`;
      svg += `<text x="${(ML + W - MR) / 2}" y="${bot + 80}" font-size="27" fill="${C.muted}" text-anchor="middle">${esc(xLabel)}</text>`;
    }
  });
  svg += '</svg>';
  fs.writeFileSync(path.join(OUT, name + '.svg'), svg);
  fs.writeFileSync(path.join(OUT, name + '.html'), `<!doctype html><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400&display=swap" rel="stylesheet"><style>html,body{margin:0;background:${C.bg}}svg{display:block;width:${W}px;height:${H}px}</style>${svg}`);
  console.log('chart', name, H);
}
const pts = (rows, key) => rows.map((r) => [r.s, r[key]]);
const stat = (rows) => {
  const d = rows.slice(1).map((r, k) => r.t - rows[k].t).sort((p, q) => p - q);
  const q = (f) => d[Math.min(d.length - 1, Math.floor(f * d.length))];
  return { d, p50: q(0.5), p95: q(0.95), max: d[d.length - 1] };
};

// 1 (slide 45): two settings on the rig, same +-45 deg step
chart({ name: 'c1_two_runs', x: [0, 60], xLabel: 'เวลาหลังกด AUTO (วินาที)', legend: [['รอบ 20:13 (kd 1)', C.blue], ['รอบ 20:30 (kd 2 + HOLD)', C.lime]],
  panels: [{ y: [-50, 50], yLabel: 'มุมจากเซนเซอร์แสง (องศา) เป้าอยู่ที่ 0', series: [{ pts: pts(a, 'ang'), color: C.blue }, { pts: pts(b, 'ang'), color: C.lime }] }] });

// 2 (slide 48): three ways to know the angle during the fast approach (20:13)
{
  const r = a.filter((x) => x.s <= 4);
  const at = r.reduce((p, x) => (Math.abs(x.s - 0.9) < Math.abs(p.s - 0.9) ? x : p));
  chart({ name: 'c2_three_angles', x: [0, 4], xLabel: 'เวลาหลังกด AUTO (วินาที) รอบ 20:13',
    legend: [['เซนเซอร์แสง (ANG)', C.blue], ['มุมประมาณ ที่ตัวคุมใช้ (EST)', C.lime], ['gyro อย่างเดียว', C.pink]],
    panels: [{ y: [-50, 10], yLabel: 'มุม (องศา)', series: [{ pts: pts(r, 'ang'), color: C.blue }, { pts: pts(r, 'est'), color: C.lime }, { pts: pts(r, 'gyro'), color: C.pink }],
      marks: [[at.s, at.ang, C.blue], [at.s, at.est, C.lime]],
      notes: [[at.s + 0.08, (at.ang + at.est) / 2, `ที่ ${at.s.toFixed(1)} วิ: แสง ${at.ang.toFixed(1)}° ประมาณ ${at.est.toFixed(1)}° หมุน ${Math.abs(at.gz).toFixed(0)}°/วิ`]] }] });
  console.log(`   c2 at ${at.s.toFixed(2)} s ang ${at.ang} est ${at.est} gyro ${at.gyro.toFixed(1)} gz ${at.gz}`);
}

// 3 (slide 49): kicks near the target (20:13) - angle panel + kick panel, shared time
{
  const r = a.filter((x) => x.s >= 15 && x.s <= 45);
  const kicks = r.filter((x, k) => k && Math.abs(x.K - r[k - 1].K) > 5);
  chart({ name: 'c3_kicks', H: 900, x: [15, 45], xLabel: 'เวลาหลังกด AUTO (วินาที) รอบ 20:13 (kd 1 ยังไม่มี HOLD)',
    panels: [{ y: [-5, 5], yLabel: 'มุมจากเซนเซอร์แสง (องศา)', series: [{ pts: pts(r, 'ang'), color: C.blue }], marks: kicks.map((x) => [x.s, x.ang, C.pink]) },
      { y: [-40, 40], yLabel: 'kick ที่ตัวคุมเพิ่ม (% ล้อ)', series: [{ pts: pts(r, 'K'), color: C.pink }] }] });
  console.log('   c3 kicks at', kicks.map((x) => `${x.s.toFixed(1)}s K${x.K} ang${x.ang}`).join(' | '));
}

// 4 (slide 51): spacing between black-box rows (nominal 40 ms) - one panel per run
{
  const sa = stat(a), sb = stat(b);
  const hist = (d) => { const h = {}; d.forEach((v) => { const k = Math.min(100, Math.floor(v / 2) * 2); h[k] = (h[k] || 0) + 1; }); return h; };
  const bars = (h, n) => Object.keys(h).map(Number).sort((p, q) => p - q).flatMap((k) => [[k, 0], [k, 100 * h[k] / n], [k + 2, 100 * h[k] / n], [k + 2, 0]]);
  const ha = hist(sa.d), hb = hist(sb.d);
  const ymax = Math.ceil(Math.max(...Object.values(ha).map((v) => 100 * v / sa.d.length), ...Object.values(hb).map((v) => 100 * v / sb.d.length)) / 10) * 10;
  chart({ name: 'c4_loop_spacing', H: 900, x: [30, 102], xLabel: 'ระยะห่างระหว่างแถวในกล่องดำ (ms) ควรเป็น 40',
    panels: [{ y: [0, ymax], yLabel: `รอบ 20:13 (% ของแถว) 95% ไม่เกิน ${sa.p95} ms ช้าสุด ${sa.max} ms`, series: [{ pts: bars(ha, sa.d.length), color: C.blue, w: 2 }], bands: [[38, 42]] },
      { y: [0, ymax], yLabel: `รอบ 20:30 (% ของแถว) 95% ไม่เกิน ${sb.p95} ms ช้าสุด ${sb.max} ms`, series: [{ pts: bars(hb, sb.d.length), color: C.lime, w: 2 }], bands: [[38, 42]] }] });
  console.log(`   c4 20:13 p50 ${sa.p50} p95 ${sa.p95} max ${sa.max} n ${sa.d.length} · 20:30 p50 ${sb.p50} p95 ${sb.p95} max ${sb.max} n ${sb.d.length}`);
}

// 5 (slide 54): gyro alone drifts while the body sits still in HOLD (20:30, 4..60 s)
{
  const r = b.filter((x) => x.s >= 4 && x.s <= 60);
  const g0 = r[0].gyro - r[0].ang;
  const gp = r.map((x) => [x.s, x.gyro - g0]);
  const e = r[r.length - 1];
  chart({ name: 'c5_gyro_drift', x: [4, 60], xLabel: 'เวลาหลังกด AUTO (วินาที) รอบ 20:30 ยานนิ่งใน HOLD',
    legend: [['เซนเซอร์แสง (ANG)', C.blue], ['gyro อย่างเดียว (เริ่มที่ค่าเดียวกัน)', C.pink]],
    panels: [{ y: [-4, 6], yLabel: 'มุม (องศา)', series: [{ pts: pts(r, 'ang'), color: C.blue }, { pts: gp, color: C.pink }],
      notes: [[59, gp[gp.length - 1][1] + 0.6, `gyro ${(gp[gp.length - 1][1] - r[0].ang).toFixed(1)}° ใน ${(e.s - 4).toFixed(0)} วิ`, 'end'], [59, e.ang - 0.9, `แสง ${(e.ang - r[0].ang).toFixed(1)}°`, 'end']] }] });
  console.log(`   c5 gyro change ${(gp[gp.length - 1][1] - r[0].ang).toFixed(2)} sun change ${(e.ang - r[0].ang).toFixed(2)} over ${(e.s - 4).toFixed(1)} s`);
}

// 6 (slide 8): 15:36 GS log - the body turned ~3 times before AUTO pointed (GS stamps whole seconds -> rows spread evenly)
{
  const lines = fs.readFileSync(path.join(LOGS, 'gs_20261006_1536_newww.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',');
  const rows = lines.slice(1).map((l) => { const t = l.split(','); const o = {}; head.forEach((k, i) => { o[k] = i ? +t[i] : t[i]; }); return o; });
  const sec = (r) => { const [h, m, s] = r.timestamp.slice(11).split(':').map(Number); return h * 3600 + m * 60 + s; };
  const s0 = sec(rows[0]), per = {};
  rows.forEach((r) => { per[sec(r)] = (per[sec(r)] || 0) + 1; });
  const seen = {};
  let turn = 0, rate = 0, t0 = null;
  const ang = [], cmd = [];
  rows.forEach((r, i) => {
    const k = sec(r); seen[k] = (seen[k] || 0) + 1;
    const t = k - s0 + (seen[k] - 1) / per[k];
    if (i) {
      const p = rows[i - 1];
      // two GYRO_Z sources (gs_log_split.js): GYRO line = raw (body rate = -raw, imu.rsign -1), ADCS line = body rate
      if (r.gyro_z_dps !== p.gyro_z_dps) rate = (r.gyro_x_dps !== p.gyro_x_dps || r.gyro_y_dps !== p.gyro_y_dps) ? -r.gyro_z_dps : r.gyro_z_dps;
      turn += rate / per[k];
    }
    if (t0 === null && r.rw_cmd !== 0) t0 = t;
    ang.push([t, turn]); cmd.push([t, r.rw_cmd]);
  });
  const sh = (a) => a.map(([t, v]) => [t - t0, v]);
  const mn = Math.min(...ang.map((x) => x[1]));
  chart({ name: 'c6_three_turns', H: 900, x: [-2, 30], xLabel: 'เวลาหลังกด AUTO (วินาที) 6 ต.ค. 15:36 จาก log ของ GS',
    panels: [{ y: [-1200, 100], yLabel: 'ยานหมุนไปสะสม (องศา) จากอัตราหมุนของ gyro', series: [...[-360, -720, -1080].map((v) => ({ pts: [[-2, v], [30, v]], color: '#4A5345', w: 2 })), { pts: sh(ang), color: C.blue }],
      notes: [[-1.7, -360 - 60, '1 รอบ'], [-1.7, -720 - 60, '2 รอบ'], [-1.7, -1080 - 60, '3 รอบ']] },
    { y: [-60, 60], yLabel: 'คำสั่งล้อ (%)', series: [{ pts: sh(cmd), color: C.pink }] }] });
  console.log(`   c6 AUTO at ${t0.toFixed(1)} s after log start, min turned ${mn.toFixed(0)} deg, rows ${rows.length}`);
}
