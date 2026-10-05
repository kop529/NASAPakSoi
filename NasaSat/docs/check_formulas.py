# Independent numeric check of every formula / number used in THEORY_TH.md (numpy only).
# usage: python docs/check_formulas.py      -> prints PASS/FAIL per claim, exit code 1 if any fails
import math
import sys

import numpy as np

sys.stdout.reconfigure(encoding='utf-8')
DEG = math.pi / 180
fails = 0


def claim(name, ok, info=''):
    global fails
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{info}]' if info else ''))
    if not ok:
        fails += 1


rng = np.random.default_rng(9)

# 1. D = tan(theta) tan(alpha) for two cosine detectors at +-alpha (any brightness A)
th = rng.uniform(-50, 50, 1000) * DEG
al = rng.uniform(5, 40, 1000) * DEG
A = rng.uniform(0.1, 10, 1000)
eL = A * np.cos(th - al)
eR = A * np.cos(th + al)
D = (eL - eR) / (eL + eR)
claim('D = tan(theta)*tan(alpha), brightness A cancels', np.allclose(D, np.tan(th) * np.tan(al)))
claim('theta = atan(D / tan(alpha)) recovers the angle', np.allclose(np.arctan(D / np.tan(al)), th))

# 2. sensitivity at the null: dD/dtheta = tan(alpha)/cos^2(theta) -> tan(alpha) per rad
for a, want in [(15, 0.00468), (30, 0.01008), (45, 0.01745)]:
    h = 1e-6
    s = (math.tan(h) - math.tan(-h)) / (2 * h) * math.tan(a * DEG) * DEG
    claim(f'slope at 0 for alpha={a}: {want} per degree', abs(s - want) < 1e-4, f'{s:.5f}')

# 3. both detectors see the lamp only while |theta| < 90 - alpha (cosine > 0)
a = 30 * DEG
claim('usable range for alpha=30 is +-60 deg (ideal cosine)', math.cos(59.9 * DEG - a) > 0 and math.cos(59.9 * DEG + a) > 0 and math.cos(60.1 * DEG + a) < 0)

# 4. divider -> conductance: G = Rf/R_ldr = V/(Vcc - V)  (LDR on the 3.3 V side)
vcc, rf = 3300.0, 10000.0
for rl in [500, 5e3, 1e4, 1e5]:
    v = vcc * rf / (rf + rl)
    claim(f'G = V/(Vcc-V) = Rf/R_ldr at R_ldr={rl:g}', abs(v / (vcc - v) - rf / rl) < 1e-9)
# topo 1 (LDR on the ground side): G = (Vcc - V)/V
for rl in [500, 5e3, 1e5]:
    v = vcc * rl / (rf + rl)
    claim(f'topo 1: G = (Vcc-V)/V = Rf/R_ldr at R_ldr={rl:g}', abs((vcc - v) / v - rf / rl) < 1e-9)

# 5. best fixed resistor: dV/d(lnE) = Vcc*gamma*x/(1+x)^2, max at x = Rf/R_ldr = 1, value Vcc*gamma/4
gam = 0.6
x = np.logspace(-3, 3, 200001)
s = vcc * gam * x / (1 + x) ** 2
claim('sensitivity peak at Rf = R_ldr', abs(x[np.argmax(s)] - 1) < 1e-3, f'x*={x[np.argmax(s)]:.4f}')
claim('peak = Vcc*gamma/4 = 495 mV per e-fold of light', abs(s.max() - 495) < 0.01)
# numeric derivative check of the formula itself
E = 5.0
rl = lambda e: 1e4 * (e / 10) ** (-gam)  # noqa: E731
vv = lambda e, r: vcc * r / (r + rl(e))  # noqa: E731
num = (vv(E * (1 + 1e-6), 1e4 * (E / 10) ** (-gam)) - vv(E, 1e4 * (E / 10) ** (-gam))) / math.log(1 + 1e-6)
claim('dV/dlnE formula matches a numeric derivative (Rf = R_ldr)', abs(num - 495) < 0.05, f'{num:.3f}')
claim('10 % more light -> +47 mV at the optimum', abs(495 * math.log(1.1) - 47.18) < 0.01)
claim('ADC top 3050 mV means G = 12.2 (LDR 12x brighter-conducting than Rf)', abs(3050 / 250 - 12.2) < 1e-9)

# 6. flicker: a window of whole 10 ms periods removes 100 Hz ripple completely
t = np.linspace(0, 0.020, 200001)
for phase in [0, 0.7, 2.1]:
    ripple = np.sin(2 * math.pi * 100 * t + phase)
    claim(f'20 ms window averages 100 Hz ripple to 0 (phase {phase})', abs(np.trapezoid(ripple, t) / 0.020) < 1e-6)
t15 = np.linspace(0, 0.015, 150001)
worst = max(abs(np.trapezoid(np.sin(2 * math.pi * 100 * t15 + p), t15) / 0.015) for p in np.linspace(0, math.pi, 181))
claim('15 ms window leaves ~21 % of the ripple', abs(worst - 0.2122) < 0.002, f'{worst * 100:.1f}%')

# 7. 28BYJ-48 gear train
ratio = (31 * 32 * 26 * 22) / (11 * 10 * 9 * 9)
claim('gear ratio 63.68395:1', abs(ratio - 63.68395) < 1e-5, f'{ratio:.5f}')
claim('half-steps per output turn = 64 x ratio = 4075.77', abs(64 * ratio - 4075.7728) < 1e-3)
claim('one half-step = 0.0883 deg', abs(360 / (64 * ratio) - 0.08833) < 1e-4)
claim('assuming 4096 instead of 4076: 0.50 % scale error (0.45 deg at 90 deg)', abs((4096 / (64 * ratio) - 1) * 90 - 0.447) < 0.01)

# 8. sampled proportional control: e(n+1) = (1 - k r) e(n)
for kr, conv in [(0.5, True), (0.85, True), (1.5, True), (1.9, True), (2.1, False)]:
    e = 20.0
    for _ in range(60):
        e = (1 - kr) * e
    claim(f'k*r = {kr}: {"converges" if conv else "diverges"}', (abs(e) < 1) == conv)
n = math.log(0.3 / 75) / math.log(1 - 0.85)
claim('k*r = 0.85: 75 deg -> 0.3 deg in about 3 corrections', 2.5 < n < 3.2, f'{n:.2f}')

# 9. LDR lag: waiting 150 ms with tau = 25 ms leaves e^-6 = 0.25 % of a step
claim('exp(-150/25) = 0.25 %', abs(math.exp(-6) - 0.00248) < 1e-4)

# 10. camera pinhole: 640 px wide, 62 deg field of view
f = 320 / math.tan(31 * DEG)
claim('focal length in pixels f = 320/tan(31 deg) = 533', abs(f - 532.57) < 0.05, f'{f:.2f}')
claim('1 px at the centre = 0.108 deg', abs(math.degrees(math.atan(1 / f)) - 0.1076) < 1e-3)
claim('motion blur at 40 deg/s during 30 ms = 11 px', abs(40 * 0.030 * DEG * f - 11.15) < 0.05)
claim('pixel -> angle: x = 400 px is atan(80/f) = 8.5 deg right of centre', abs(math.degrees(math.atan(80 / f)) - 8.54) < 0.01)

# 11. image link budget
jpeg = 24578
b64 = 4 * math.ceil(jpeg / 3)
chunks = math.ceil(jpeg / 480)
line_overhead = chunks * len('IMG C 12 34 \n')
bytes_total = b64 + line_overhead
secs = bytes_total * 10 / 115200
claim('640x480 JPEG ~24.6 KB -> ~34 KB of text -> ~3.0 s at 115200 baud', 2.8 < secs < 3.2, f'{secs:.2f} s')
claim('480-byte chunk = 640 base64 characters', 4 * math.ceil(480 / 3) == 640)

# 12. CRC32 check value (same as the tool)
import zlib  # noqa: E402

claim('CRC32("123456789") = CBF43926', zlib.crc32(b'123456789') == 0xCBF43926)

# 13. backlash measured by two zero crossings: fwd - bwd = b
b = 1.4
motor = np.concatenate([np.linspace(-5, 5, 2001), np.linspace(5, -5, 2001)])
out = []
o = -5 + b / 2
for m in motor:
    if m - o > b / 2:
        o = m - b / 2
    elif m - o < -b / 2:
        o = m + b / 2
    out.append(o)
out = np.array(out)
target = 1.0  # sun direction in the output frame
fwd = motor[:2001][np.argmin(np.abs(out[:2001] - target))]
bwd = motor[2001:][np.argmin(np.abs(out[2001:] - target))]
claim('BACKLASH: forward and backward crossing differ by b', abs((fwd - bwd) - b) < 0.02, f'{fwd - bwd:.3f}')

# 14. why ambient must be removed in each LDR's own power domain: exact for the right gamma
for g in [0.5, 0.62, 0.8]:
    lamp, amb = 0.7, 0.3
    G = (lamp + amb) ** g
    a_g = amb ** g
    claim(f'(G^(1/gamma) - amb) recovers the lamp exactly when gamma is right ({g})', abs((G ** (1 / g) - a_g ** (1 / g)) - lamp) < 1e-12)
lamp, amb, gt, gu = 0.7, 0.3, 0.62, 0.57
wrong = (lamp + amb) ** (gt / gu) - amb ** (gt / gu)
claim('a wrong gamma (0.57 used, 0.62 true) mis-subtracts room light by >5 %', abs(wrong / lamp ** (gt / gu) - 1) > 0.05, f'{(wrong / lamp ** (gt / gu) - 1) * 100:.1f}%')

# 15. brightness invariance (THEORY 4.8). Each channel's value scales like K^(gamma_true / (gamma_est * q_est)).
#     A one-brightness sweep only fixes each channel's product gamma*q; matched products give K^(1/q_true): the lamp
#     brightness K cancels in eL/eR only if the two housings have the same q. With the gamma ratio measured at two
#     brightnesses and ONE q in the estimator, the two exponents are equal whatever the housings.
gL, gR = 0.62, 0.57
spread = lambda eL_, eR_: max(K ** (eL_ - eR_) for K in (0.5, 2)) / min(K ** (eL_ - eR_) for K in (0.5, 2)) - 1
for qLt, qRt in [(1.35, 1.35), (1.25, 1.45)]:
    gLe = gRe = 0.6                                   # any split that matches the products (a free fit)
    qLe, qRe = gL * qLt / gLe, gR * qRt / gRe
    s_free = spread(gL / (gLe * qLe), gR / (gRe * qRe))
    gLr, gRr, qe = 0.6, 0.6 * gR / gL, 1.35          # measured ratio, one q (any value)
    s_ratio = spread(gL / (gLr * qe), gR / (gRr * qe))
    if qLt == qRt:
        claim(f'same housings (q {qLt}): matched products already cancel K (dark room)', s_free < 1e-12)
    else:
        claim(f'uneven housings (q {qLt}/{qRt}): matched products leave K in eL/eR', s_free > 0.05, f'{s_free * 100:.1f}% between K 0.5 and 2')
    claim(f'gamma ratio + one q cancels K exactly (housings {qLt}/{qRt})', s_ratio < 1e-12)
# 16. dark room: gammaR/gammaL = ln(GR1/GR2) / ln(GL1/GL2) from two lamp levels at one pose (any c, K, s)
for c_l, c_r, K, s in [(0.7, 1.3, 1.0, 0.4), (2.0, 0.5, 3.0, 0.25)]:
    GL1, GL2 = c_l * K ** gL, c_l * (s * K) ** gL
    GR1, GR2 = c_r * K ** gR, c_r * (s * K) ** gR
    claim(f'two-level gamma ratio (c {c_l}/{c_r}, dimmed x{s})', abs(math.log(GR1 / GR2) / math.log(GL1 / GL2) - gR / gL) < 1e-12)

# 17. picture direction (THEORY 7.1, 7.8): an object at actuator angle az is at u = -s*tan(az - camAz)/t (u in -1..1,
#     t = tan(HFOV/2), s = +1 when a larger angle is further LEFT). Turning the camera by +D moves it to
#     u' = tan(atan(u t) + s D)/t, for both directions s.
t = math.tan(31 * DEG)
for s in (1, -1):
    az = rng.uniform(-25, 25, 200) * DEG
    azA, D = 3 * DEG, 8 * DEG
    uA = -s * np.tan(az - azA) / t
    uB = -s * np.tan(az - (azA + D)) / t
    claim(f'two photos {D / DEG:.0f} deg apart: u_B = tan(atan(u_A t) + s D)/t (s = {s})', np.allclose(uB, np.tan(np.arctan(uA * t) + s * D) / t))
f = 320 / math.tan(31 * DEG)
shift = f * math.tan(8 * DEG)
claim('turning 8 deg moves the picture centre by f*tan(8) = 74.9 px (640 px, 62 deg)', abs(shift - 74.85) < 0.05, f'{shift:.2f} px')
claim('HFOV back from that shift: 2*atan((W/2) tan(D) / shift) = 62 deg', abs(2 * math.atan(320 * math.tan(8 * DEG) / shift) / DEG - 62) < 1e-9)
# 18. boresight (THEORY 7.3): lamp at actuator angle lamp; LDRs read th = lamp - axis; camera boresight = axis + off;
#     the photo shows the lamp at x -> delta = s*atan((W/2 - x)/f) = lamp - boresight -> off = th - delta, either direction
for s in (1, -1):
    axis, off_true, lamp = 40 * DEG, -1.5 * DEG, 40.3 * DEG
    x = 320 - s * f * math.tan(lamp - (axis + off_true))
    delta = s * math.atan((320 - x) / f)
    claim(f'boresight: off = th - delta recovers the camera offset (s = {s})', abs(((lamp - axis) - delta) - off_true) < 1e-12)
# 19. backlash compensation by counting the compensation already done (THEORY 6.2): output shaft follows the motor
#     with play b; on each move the stepper adds max(0, -off) steps (turning +) or max(0, off + b) (turning -).
#     Whatever happened while compensation was off, the next compensated move puts the output at L - b/2 again.
def gear_run(moves, rule, b=1.4):
    motor = out = L = 0.0
    off = 0.0
    last = 0
    o = -b / 2   # engaged on the + side at the start: out = motor - b/2
    res = []
    for target, comp_on in moves:
        d = 1 if target > L else -1 if target < L else 0
        if d == 0:
            continue
        if rule == 'count':
            extra = (max(0.0, -off) if d > 0 else max(0.0, off + b)) if comp_on else 0.0
        else:  # old rule: add b on every reversal
            extra = b if comp_on and last and d != last else 0.0
        off += d * extra
        motor += d * extra + (target - L)
        L = target
        last = d
        if motor - o > b / 2:
            o = motor - b / 2
        elif motor - o < -b / 2:
            o = motor + b / 2
        if comp_on:
            res.append(o - (L - b / 2))
    return res
seq = [(10, True), (-5, True), (20, False), (-10, False), (-20, False), (-5, False), (-30, True), (15, True), (-12, True)]
claim('counting compensation: output = count - b/2 after every compensated move, even after moves without it',
      max(abs(e) for e in gear_run(seq, 'count')) < 1e-9, f'{[round(e, 3) for e in gear_run(seq, "count")]}')
claim('the old "add b on every reversal" rule ends a whole b off after the same moves',
      abs(abs(gear_run(seq, 'old')[-1]) - 1.4) < 1e-9, f'{[round(e, 3) for e in gear_run(seq, "old")]}')
# 20. battery divider (PLAYBOOK, INSTALL_CHECKLIST): 8.4 V through 100k + 47k -> pin 2.69 V (< 3.1 V ADC range), hw.vdiv 3.13
claim('2S battery 8.4 V with 100k/47k gives 2.69 V at the pin and hw.vdiv = 3.13', abs(8.4 * 47 / 147 - 2.686) < 1e-3 and abs(147 / 47 - 3.128) < 1e-3)
# 21. a 320x240 photo (~6.1 KB) over a 9600-baud radio: base64 + line headers ~8.6 KB at 960 bytes/s ~ 9 s
img = 6146
link_bytes = 4 * math.ceil(img / 3) + math.ceil(img / 480) * len('IMG C 12 34 \n')
claim('320x240 JPEG over 9600 baud ~ 9 s (the e2e radio test took 9.6 s with telemetry sharing the link)', 8.5 < link_bytes / 960 < 9.5, f'{link_bytes / 960:.1f} s')

print(f'\n{"ALL PASS" if fails == 0 else f"{fails} FAILED"}')
sys.exit(1 if fails else 0)
