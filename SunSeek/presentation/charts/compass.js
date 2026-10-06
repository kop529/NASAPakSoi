// Compass (magnetometer) check from the 15:36 GS log: the body turned ~3 times, so mag x/y should trace a circle around 0.
// Organizer firmware: MAG_CAL_START/STOP only REPORTS min/max; the offsets used are #define MAG_OFFSET_* = 0 -> never applied.
'use strict';
const fs = require('fs');
const path = require('path');
const LOGS = path.join(__dirname, '../../setup_logs');
const lines = fs.readFileSync(path.join(LOGS, 'gs_20261006_1536_newww.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
const head = lines[0].split(',');
const rows = lines.slice(1).map((l) => { const t = l.split(','); const o = {}; head.forEach((k, i) => { o[k] = i ? +t[i] : t[i]; }); return o; });
const sec = (r) => { const [h, m, s] = r.timestamp.slice(11).split(':').map(Number); return h * 3600 + m * 60 + s; };
const per = {}; rows.forEach((r) => { per[sec(r)] = (per[sec(r)] || 0) + 1; });
let turn = 0, rate = 0;
const pts = [];
rows.forEach((r, i) => {
  if (i) {
    const p = rows[i - 1];
    if (r.gyro_z_dps !== p.gyro_z_dps) rate = (r.gyro_x_dps !== p.gyro_x_dps || r.gyro_y_dps !== p.gyro_y_dps) ? -r.gyro_z_dps : r.gyro_z_dps;
    turn += rate / per[sec(r)];
  }
  // keep only rows where the mag value changed (the GS repeats the last value between mag lines)
  if (!i || r.mag_x_uT !== rows[i - 1].mag_x_uT || r.mag_y_uT !== rows[i - 1].mag_y_uT) pts.push({ x: r.mag_x_uT, y: r.mag_y_uT, z: r.mag_z_uT, turn, rw: r.rw_cmd, hd: r.mag_heading_deg });
});
// algebraic circle fit (Kasa): x^2 + y^2 + D x + E y + F = 0
const fit = (P) => {
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, n = P.length, sxz = 0, syz = 0, sz = 0;
  for (const { x, y } of P) { const z = x * x + y * y; sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y; sxz += x * z; syz += y * z; sz += z; }
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], b = [-sxz, -syz, -sz];
  const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const d = det(A), sol = [0, 1, 2].map((k) => det(A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))) / d);
  const cx = -sol[0] / 2, cy = -sol[1] / 2;
  return { cx, cy, r: Math.sqrt(cx * cx + cy * cy - sol[2]) };
};
const spin = pts.filter((p) => Math.abs(p.turn) > 5);  // while it actually turned
const c = fit(spin);
const wrap = (a) => ((a + 540) % 360) - 180;
const hRaw = (p) => Math.atan2(p.y, p.x) * 180 / Math.PI;
const hCal = (p) => Math.atan2(p.y - c.cy, p.x - c.cx) * 180 / Math.PI;
// compare the change of heading with the change of the gyro angle (sign and constant offset removed)
const err = (h) => {
  const best = [1, -1].map((sg) => {
    const e = spin.map((p) => wrap(h(p) - sg * p.turn));
    const m = Math.atan2(e.reduce((a, v) => a + Math.sin(v * Math.PI / 180), 0), e.reduce((a, v) => a + Math.cos(v * Math.PI / 180), 0)) * 180 / Math.PI;
    const r = e.map((v) => wrap(v - m));
    return { sg, rms: Math.sqrt(r.reduce((a, v) => a + v * v, 0) / r.length), max: Math.max(...r.map(Math.abs)), r };
  });
  return best[0].rms < best[1].rms ? best[0] : best[1];
};
const er = err(hRaw), ec = err(hCal);
const radii = spin.map((p) => Math.hypot(p.x - c.cx, p.y - c.cy));
console.log(`mag points ${pts.length}, while turning ${spin.length}, turn range ${Math.min(...spin.map((p) => p.turn)).toFixed(0)}..${Math.max(...spin.map((p) => p.turn)).toFixed(0)} deg`);
console.log(`circle centre (${c.cx.toFixed(2)}, ${c.cy.toFixed(2)}) uT, radius ${c.r.toFixed(2)} uT (min ${Math.min(...radii).toFixed(1)} max ${Math.max(...radii).toFixed(1)}), z ${Math.min(...spin.map((p) => p.z)).toFixed(1)}..${Math.max(...spin.map((p) => p.z)).toFixed(1)}`);
console.log(`geometric max heading error with the (0,0) centre: asin(d/r) = ${(Math.asin(Math.min(1, Math.hypot(c.cx, c.cy) / c.r)) * 180 / Math.PI).toFixed(1)} deg (d ${Math.hypot(c.cx, c.cy).toFixed(1)} uT)`);
console.log(`heading vs gyro (GS whole-second stamps: timing dominates this): raw rms ${er.rms.toFixed(1)} max ${er.max.toFixed(1)} deg (sign ${er.sg}) · centred rms ${ec.rms.toFixed(1)} max ${ec.max.toFixed(1)} deg (sign ${ec.sg})`);
for (const lim of [0, 20, 39]) {
  const s = spin.filter((p) => Math.abs(p.rw) >= lim);
  if (s.length > 10) { const f = fit(s); console.log(`  |rw| >= ${lim}: n ${s.length} centre (${f.cx.toFixed(2)}, ${f.cy.toFixed(2)}) r ${f.r.toFixed(2)}`); }
}
module.exports = { pts, spin, c, er, ec };

// chart c7: mag x/y while the body turned 3 times - a circle that is NOT around (0, 0)
{
  const C = { lime: '#8E9E1F', blue: '#4F8FE8', text: '#F1F3EE', muted: '#A3AA9C', grid: '#2C3328', bg: '#0A0C09' };
  const W = 890, H = 900, ML = 110, MT = 60, S = 750, lo = -30, hi = 80;
  const X = (v) => ML + (v - lo) / (hi - lo) * S, Y = (v) => MT + S - (v - lo) / (hi - lo) * S;
  const k = S / (hi - lo);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="'IBM Plex Sans Thai',sans-serif"><rect width="${W}" height="${H}" fill="${C.bg}"/>`;
  for (let v = -20; v <= 80; v += 20) {
    svg += `<line x1="${X(v)}" x2="${X(v)}" y1="${MT}" y2="${MT + S}" stroke="${C.grid}" stroke-width="${v === 0 ? 2 : 1}"/><line x1="${ML}" x2="${ML + S}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C.grid}" stroke-width="${v === 0 ? 2 : 1}"/>`;
    svg += `<text x="${X(v)}" y="${MT + S + 34}" font-size="26" fill="${C.muted}" text-anchor="middle">${v}</text><text x="${ML - 14}" y="${Y(v) + 9}" font-size="26" fill="${C.muted}" text-anchor="end">${v}</text>`;
  }
  svg += `<text x="${ML + S / 2}" y="${H - 14}" font-size="26" fill="${C.muted}" text-anchor="middle">แม่เหล็กแกน x (µT)</text>`;
  svg += `<text x="${ML}" y="${MT - 22}" font-size="26" fill="${C.muted}">แม่เหล็กแกน y (µT) · ยานหมุน 3 รอบ 15:36</text>`;
  svg += `<circle cx="${X(c.cx)}" cy="${Y(c.cy)}" r="${c.r * k}" fill="none" stroke="${C.lime}" stroke-width="2" stroke-dasharray="8 8"/>`;
  for (const p of spin) svg += `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="5" fill="${C.blue}" opacity="0.8"/>`;
  svg += `<circle cx="${X(0)}" cy="${Y(0)}" r="10" fill="${C.bg}" stroke="${C.text}" stroke-width="3"/><text x="${X(0) + 16}" y="${Y(0) + 38}" font-size="26" fill="${C.text}">(0, 0) ที่โค้ดใช้</text>`;
  svg += `<circle cx="${X(c.cx)}" cy="${Y(c.cy)}" r="10" fill="${C.lime}" stroke="${C.bg}" stroke-width="3"/><text x="${X(c.cx) + 16}" y="${Y(c.cy) - 16}" font-size="26" fill="${C.text}">ศูนย์จริง (${c.cx.toFixed(0)}, ${c.cy.toFixed(0)})</text>`;
  svg += '</svg>';
  fs.writeFileSync(path.join(__dirname, 'c7_compass.svg'), svg);
  fs.writeFileSync(path.join(__dirname, 'c7_compass.html'), `<!doctype html><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400&display=swap" rel="stylesheet"><style>html,body{margin:0;background:${C.bg}}svg{display:block;width:${W}px;height:${H}px}</style>${svg}`);
  console.log('chart c7_compass');
}
