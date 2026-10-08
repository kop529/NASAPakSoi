'use strict';
// ===== SunSeek camera pictures (ESP32-CAM web server, http://<ip>/image?name=/IMG_0001.JPG) =====
// The camera sends no CORS header, so a page opened from a file can SHOW its pictures (<img>, canvas) but cannot read the
// bytes: saving = open the full picture in a new tab (Ctrl+S) or the PowerShell line from "คัดลอกคำสั่งบันทึก".
// Its web server answers one request at a time (and the GS fetches mission images too): pictures load one after another.
(function () {
  if (typeof document === 'undefined') return;
  const g = (id) => document.getElementById(id);
  const name = (n) => `IMG_${String(n).padStart(4, '0')}.JPG`;
  const url = (n) => `http://${(g('ciIp').value || '192.168.4.1').trim()}/image?name=/${name(n)}`;
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem('ci.' + k); localStorage.setItem('ci.' + k, v); } catch (e) { /* storage off */ } return null; };
  let busy = false;
  let view = null; // { img, n }

  const say = (t, bad) => { const o = g('ciOut'); o.textContent = t; o.className = 'kv' + (bad ? ' bad' : ''); };
  // load one picture; resolves the <img> or null (404 / no camera / timeout)
  const load = (n, ms = 12000) => new Promise((res) => {
    const im = new Image();
    let done = false;
    const end = (v) => { if (!done) { done = true; clearTimeout(t); res(v); } };
    const t = setTimeout(() => { im.src = ''; end(null); }, ms);
    im.onload = () => end(im.naturalWidth ? im : null);
    im.onerror = () => end(null);
    im.src = url(n) + `&t=${Date.now()}`;
  });

  // draw a picture turned by rot degrees, with the judges' centre line (vertical) and a light horizontal one
  function draw(cv, im, rot, big) {
    const turn = rot % 180 !== 0;
    const w = turn ? im.naturalHeight : im.naturalWidth;
    const h = turn ? im.naturalWidth : im.naturalHeight;
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    c.save();
    c.translate(w / 2, h / 2);
    c.rotate((rot * Math.PI) / 180);
    c.drawImage(im, -im.naturalWidth / 2, -im.naturalHeight / 2);
    c.restore();
    c.lineWidth = big ? 2 : 3;
    c.strokeStyle = '#ff2d55';
    c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.stroke();
    c.strokeStyle = 'rgba(255,45,85,.45)';
    c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
  }
  const rot = () => +g('ciRot').value || 0;
  function show(im, n) {
    view = { im, n };
    draw(g('ciBig'), im, rot(), true);
    g('ciBigName').textContent = `${name(n)} · ${im.naturalWidth}×${im.naturalHeight} · หมุน ${rot()}° · เส้นแดง = กลางภาพ`;
    g('ciBigOpen').href = url(n);
    g('ciViewer').hidden = false;
  }

  async function fetchRange() {
    if (busy) return;
    const last = Math.round(+g('ciLast').value);
    const cnt = Math.max(1, Math.min(40, Math.round(+g('ciN').value) || 6));
    if (!(last >= 1)) { say('ใส่เลขรูปล่าสุดก่อน (ดูจาก IMAGE_COUNT ใน GS หรือกด "หาเลขล่าสุด")', true); return; }
    store('last', last);
    busy = true;
    const grid = g('ciGrid');
    grid.textContent = '';
    let ok = 0;
    for (let n = last; n > last - cnt && n >= 1; n--) {
      const card = document.createElement('div');
      card.className = 'ci-card';
      const cv = document.createElement('canvas');
      const cap = document.createElement('div');
      cap.className = 'ci-cap';
      cap.textContent = `${name(n)} · กำลังโหลด…`;
      card.append(cv, cap);
      grid.append(card);
      say(`กำลังโหลด ${name(n)} (${last - n + 1}/${cnt})`);
      const im = await load(n);
      if (!im) { cap.textContent = `${name(n)} · ไม่มีรูป / กล้องไม่ตอบ`; card.classList.add('ci-miss'); continue; }
      ok++;
      draw(cv, im, rot(), false);
      cap.textContent = '';
      const a = document.createElement('a');
      a.href = url(n); a.target = '_blank'; a.rel = 'noopener'; a.textContent = name(n);
      cap.append(a, ` · ${im.naturalWidth}×${im.naturalHeight}`);
      cv.title = 'คลิกเพื่อดูภาพใหญ่';
      cv.onclick = () => show(im, n);
      if (n === last) show(im, n);
    }
    busy = false;
    say(ok ? `โหลดได้ ${ok}/${cnt} รูป · คลิกรูปเพื่อดูใหญ่ · บันทึก: กดชื่อไฟล์ (เปิดแท็บใหม่) แล้ว Ctrl+S` :
      'โหลดไม่ได้สักรูป: โน้ตบุ๊กต่อ Wi-Fi กล้อง (SUNSEEK-PAYLOAD-…) อยู่ไหม? ถ้า Live View เปิดอยู่ ให้ STOP LIVE VIEW ก่อน', !ok);
  }

  // galloping search for the newest picture with <img> probes (a missing name answers 404 at once)
  async function findLast() {
    if (busy) return;
    busy = true;
    say('กำลังหาเลขรูปล่าสุด…');
    const has = async (n) => !!(await load(n));
    let lo = Math.max(1, Math.round(+store('last') || +g('ciLast').value || 1));
    if (!(await has(lo))) {
      if (!(await has(1))) { busy = false; say('ไม่เจอรูป IMG_0001: กล้องไม่ตอบ หรือ SD ว่าง', true); return; }
      lo = 1;
    }
    let step = 1, hi = lo + 1;
    while (await has(hi)) { lo = hi; step *= 2; hi = lo + step; if (hi > 9999) break; }
    while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (await has(m)) lo = m; else hi = m; }
    g('ciLast').value = lo;
    store('last', lo);
    busy = false;
    say(`รูปล่าสุด = ${name(lo)}`);
  }

  function copySave() {
    const last = Math.round(+g('ciLast').value);
    const cnt = Math.max(1, Math.round(+g('ciN').value) || 6);
    if (!(last >= 1)) { say('ใส่เลขรูปล่าสุดก่อน', true); return; }
    const ip = (g('ciIp').value || '192.168.4.1').trim();
    const first = Math.max(1, last - cnt + 1);
    const ps = `$d="$env:USERPROFILE\\Desktop\\sunseek_img"; New-Item -ItemType Directory -Force $d | Out-Null; ${first}..${last} | ForEach-Object { $n='IMG_{0:D4}.JPG' -f $_; curl.exe -s -o "$d\\$n" "http://${ip}/image?name=/$n"; "$n " + (Get-Item "$d\\$n").Length }`;
    const done = () => say(`คัดลอกแล้ว: วางใน PowerShell แล้วกด Enter รูป ${name(first)}–${name(last)} จะไปอยู่ที่ Desktop\\sunseek_img (ปิด Live View ก่อน)`);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ps).then(done, () => { g('ciPs').value = ps; g('ciPs').hidden = false; say('คัดลอกเองจากกล่องด้านล่าง'); });
    else { g('ciPs').value = ps; g('ciPs').hidden = false; say('คัดลอกเองจากกล่องด้านล่าง'); }
  }

  function init() {
    if (!g('ciGo')) return;
    const ip = store('ip'); if (ip) g('ciIp').value = ip;
    const last = store('last'); if (last) g('ciLast').value = last;
    const r = store('rot'); if (r) g('ciRot').value = r;
    g('ciIp').addEventListener('change', () => store('ip', g('ciIp').value.trim()));
    g('ciRot').addEventListener('change', () => { store('rot', g('ciRot').value); if (view) show(view.im, view.n); });
    g('ciGo').addEventListener('click', fetchRange);
    g('ciFind').addEventListener('click', findLast);
    g('ciCopy').addEventListener('click', copySave);
    g('ciLatest').addEventListener('click', async () => { await findLast(); g('ciN').value = 1; await fetchRange(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
