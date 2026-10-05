'use strict';
// ===== camera geometry: pixel <-> actuator angle, and the picture's direction + field of view from two photos =====
// A photo taken with the camera boresight at actuator angle camAz (img_meta cam_az_cmd) shows an object at actuator
// angle az in column  x = W/2 - s * f * tan(az - camAz),  f = (W/2) / tan(hfov/2).
// s = +1 when an object at a LARGER actuator angle appears further LEFT in the picture. It depends on how the camera is
// mounted (cam.dir, measured by turning between two photos) and flips with the sensor's mirror setting (cam.hmirror).
NS.cam = {
  effDir: (camDir, hm) => (camDir || 0) * (hm ? -1 : 1),
  focal: (W, hfov) => W / 2 / Math.tan((hfov / 2) * NS.DEG),
  pixelToAz: (x, W, camAz, hfov, s) => camAz + s * Math.atan((W / 2 - x) / NS.cam.focal(W, hfov)) * NS.RAD,
  azToPixel: (az, W, camAz, hfov, s) => W / 2 - s * NS.cam.focal(W, hfov) * Math.tan((az - camAz) * NS.DEG),

  // cam.off from a photo of the lamp taken while mission 1 holds: the LDRs say the lamp is th degrees from the
  // satellite axis, the photo says it is delta from the camera boresight, so (boresight - axis) = th - delta
  boresight(cx, W, th, hfov, s) {
    const delta = s * Math.atan((W / 2 - cx) / NS.cam.focal(W, hfov)) * NS.RAD;
    return { delta, off: th - delta };
  },

  // The second photo was taken after turning the actuator by +moveDeg. Try both directions and every field of view
  // (20..140 deg): map each column of photo A to where that object must be in photo B and correlate the brightness
  // GRADIENTS (an auto-exposure change between the photos scales them, the correlation does not care).
  // Returns the best direction s, its field of view, the score (correlation 0..1) and the best score of the other
  // direction: a scene without detail (bare wall) gives low, similar scores and is refused by `ok`.
  dirFromProfiles(pa, pb, moveDeg, o = {}) {
    const n = Math.min(pa.length, pb.length);
    if (n < 40 || !(Math.abs(moveDeg) > 0.5)) throw new Error('bad input');
    const ga = new Float64Array(n - 1);
    const gb = new Float64Array(n - 1);
    for (let i = 0; i < n - 1; i++) { ga[i] = pa[i + 1] - pa[i]; gb[i] = pb[i + 1] - pb[i]; }
    const gAt = (u) => { // gradient of B at normalised column u (-1 = left edge, +1 = right edge)
      const fi = ((u + 1) / 2) * n - 1;
      if (!(fi >= 0 && fi <= n - 2)) return NaN;
      const i0 = Math.min(n - 3, Math.floor(fi));
      const a = fi - i0;
      return gb[i0] * (1 - a) + gb[i0 + 1] * a;
    };
    const D = moveDeg * NS.DEG;
    const score = (s, hfov) => {
      const t = Math.tan((hfov / 2) * NS.DEG);
      let sx = 0; let sy = 0; let sxx = 0; let syy = 0; let sxy = 0; let m = 0;
      for (let i = 0; i < n - 1; i++) {
        const u = ((i + 1) / n) * 2 - 1;
        const ub = Math.tan(Math.atan(u * t) + s * D) / t;
        if (!(ub > -1 && ub < 1)) continue;
        const y = gAt(ub);
        if (!Number.isFinite(y)) continue;
        const x = ga[i];
        sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; m++;
      }
      if (m < 0.3 * n) return -1;
      const vx = sxx / m - (sx / m) ** 2;
      const vy = syy / m - (sy / m) ** 2;
      return vx > 1e-12 && vy > 1e-12 ? (sxy / m - (sx / m) * (sy / m)) / Math.sqrt(vx * vy) : -1;
    };
    const lo = o.lo ?? 20;
    const hi = o.hi ?? 140;
    const step = 0.5;
    const best = { 1: { sc: -2, h: NaN }, '-1': { sc: -2, h: NaN } };
    for (const s of [1, -1]) {
      for (let h = lo; h <= hi + 1e-9; h += step) {
        const sc = score(s, h);
        if (sc > best[s].sc) best[s] = { sc, h };
      }
    }
    const s = best[1].sc >= best[-1].sc ? 1 : -1;
    let hfov = best[s].h;
    const y0 = score(s, hfov - step);
    const y1 = best[s].sc;
    const y2 = score(s, hfov + step);
    const den = y0 - 2 * y1 + y2;
    if (y0 > -1 && y2 > -1 && den < 0) hfov += NS.clamp((0.5 * step * (y0 - y2)) / den, -step, step); // parabola peak
    const other = best[-s].sc;
    const ok = y1 >= (o.minScore ?? 0.6) && y1 - other >= (o.minMargin ?? 0.2);
    return { s, hfov, score: y1, other, ok };
  },
};

if (typeof document !== 'undefined') {
  // column brightness profile of a decoded image, scaled down to at most maxW columns (rows rowFrom..rowTo of the height)
  NS.cam.profile = (img, maxW = 320, rowFrom = 0, rowTo = 0.85) => {
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const n = Math.min(maxW, W);
    const h = Math.max(8, Math.round((H * n) / W));
    const cv = document.createElement('canvas');
    cv.width = n;
    cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, n, h);
    const d = g.getImageData(0, 0, n, h).data;
    const p = new Float64Array(n);
    for (let y = Math.floor(h * rowFrom); y < Math.ceil(h * rowTo); y++) {
      for (let x = 0; x < n; x++) { const k = (y * n + x) * 4; p[x] += 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]; }
    }
    return p;
  };
  NS.cam.load = (url) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('decode')); im.src = url; });
}
