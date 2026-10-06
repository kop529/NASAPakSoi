// Read a Ground Station v1.10.x "START LOG" CSV and tell the two GYRO_Z sources apart.
//   node gs_log_split.js <log.csv> [fromHH:MM:SS] [toHH:MM:SS]
// Firmware before commit 10548b5 sent GYRO_Z twice with different meanings: the GYRO stream line (raw gyro, also
// carries GYRO_X/GYRO_Y) and the ADCS snapshot line (body rate = raw x imu.rsign). The GS stores whichever came last,
// so the log's gyro_z zig-zags. A row whose gyro_x/gyro_y changed with gyro_z came from the GYRO line; otherwise from
// the ADCS line. 6 Oct 15:36 (newww.csv): raw +7..+236, body rate -8..-235 while the sun angle fell -18.4 -> -42.4
// in the first second -> d(angle)/dt has the sign of the body rate (imu.rsign -1 right).
const fs = require('fs');
const [file, from = '00:00:00', to = '99:99:99'] = process.argv.slice(2);
if (!file) { console.log('usage: node gs_log_split.js <log.csv> [from] [to]'); process.exit(1); }
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
const head = lines[0].split(',');
const rows = lines.slice(1).map((l) => { const t = l.split(','); const o = {}; head.forEach((k, i) => { o[k] = i === 0 ? t[i] : +t[i]; }); return o; });
const count = { GYRO: 0, ADCS: 0 };
for (let i = 1; i < rows.length; i++) {
  const r = rows[i], p = rows[i - 1];
  if (r.gyro_z_dps === p.gyro_z_dps) continue;
  const src = (r.gyro_x_dps !== p.gyro_x_dps || r.gyro_y_dps !== p.gyro_y_dps) ? 'GYRO' : 'ADCS';
  count[src]++;
  const hms = r.timestamp.slice(11);
  if (hms >= from && hms <= to) {
    console.log(`${hms} row ${String(i).padStart(5)} ${src.padEnd(4)} gz ${String(r.gyro_z_dps).padStart(9)}  ang ${String(r.sun_angle_deg).padStart(7)}  L ${r.sun_l} R ${r.sun_r}  rw ${r.rw_cmd}`);
  }
}
console.log('gyro_z changes by source:', count);
