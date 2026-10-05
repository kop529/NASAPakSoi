# Figures + key numbers for docs/THEORY_TH.md and docs/PLAYBOOK_TH.md
# usage (from the project folder):  node docs/figures/figdata.js  then  python docs/figures/make_figures.py
# Needs only numpy + matplotlib. SVG text is kept as text (svg.fonttype = none) so the browser shapes Thai correctly.
import json
import math
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
plt.rcParams.update({
    'svg.fonttype': 'none',
    'font.family': ['Leelawadee UI', 'Tahoma', 'DejaVu Sans'],
    'font.size': 9,
    'axes.titlesize': 10,
    'axes.labelsize': 9,
    'legend.fontsize': 8,
    'axes.grid': True,
    'grid.color': '#dddddd',
    'grid.linewidth': 0.6,
    'axes.spines.top': False,
    'axes.spines.right': False,
    'figure.dpi': 100,
})
C1, C2, C3, C4, GREY = '#3A9BD5', '#C07F00', '#C45E99', '#1E9E7E', '#666666'
DEG = math.pi / 180
NUM = {}


def save(fig, name):
    fig.tight_layout()
    fig.savefig(os.path.join(HERE, name))
    plt.close(fig)
    print('wrote', name)


data = json.load(open(os.path.join(HERE, 'figdata.json'), encoding='utf-8'))

# ------------------------------------------------------------------ fig_response: cosine law, D = tan(theta) tan(alpha)
fig, (a1, a2) = plt.subplots(1, 2, figsize=(6.6, 2.7))
th = np.linspace(-90, 90, 721)
al = 30
eL = np.clip(np.cos((th - al) * DEG), 0, None)
eR = np.clip(np.cos((th + al) * DEG), 0, None)
a1.plot(th, eL, color=C1, label='LDR ซ้าย  cos(θ − α)')
a1.plot(th, eR, color=C2, ls='--', label='LDR ขวา  cos(θ + α)')
a1.axvspan(-60, 60, color=C4, alpha=0.08, lw=0)
a1.text(0, 0.06, 'ทั้งสองตัวเห็นหลอด\n|θ| < 90° − α', ha='center', fontsize=8, color=C4)
a1.set_xlabel('มุมแสง θ จากแกนดาวเทียม (°)')
a1.set_ylabel('แสงที่รับได้ (สัดส่วน)')
a1.set_title('(ก) กฎโคไซน์ของ LDR สองตัว (α = 30°)')
a1.set_xlim(-90, 90)
a1.set_ylim(0, 1.38)
a1.legend(loc='upper center', frameon=False, ncol=2, fontsize=7)
for alpha, col, ls in [(15, C3, ':'), (30, C1, '-'), (45, C2, '--')]:
    lim = 90 - alpha - 0.5
    t = np.linspace(-lim, lim, 400)
    a2.plot(t, np.tan(t * DEG) * math.tan(alpha * DEG), color=col, ls=ls, label=f'α = {alpha}°  ความชันที่ 0° = {math.tan(alpha * DEG) * DEG:.4f} /°')
    NUM[f'slope_alpha{alpha}_per_deg'] = math.tan(alpha * DEG) * DEG
a2.set_ylim(-3, 3)
a2.set_xlim(-90, 90)
a2.set_xlabel('มุมแสง θ (°)')
a2.set_ylabel('D = (eL − eR)/(eL + eR)')
a2.set_title('(ข) D = tan θ · tan α')
a2.legend(loc='upper left', frameon=False, fontsize=7)
save(fig, 'fig_response.svg')

# ------------------------------------------------------------------ fig_divider: choosing the fixed resistor
fig, (a1, a2) = plt.subplots(1, 2, figsize=(6.6, 2.7))
vcc, gam, r10 = 3300.0, 0.6, 14000.0
lux = np.logspace(0, 3, 400)
rldr = r10 * (lux / 10.0) ** (-gam)
for rf, col, ls in [(1e3, C3, ':'), (4.7e3, C2, '--'), (10e3, C1, '-'), (47e3, C4, '-.'), (100e3, GREY, (0, (1, 1)))]:
    v = vcc * rf / (rf + rldr)
    a2_label = f'R คงที่ {rf / 1000:g} kΩ'
    a1.semilogx(lux, v, color=col, ls=ls, label=a2_label)
a1.axhline(3050, color='#aa3333', lw=0.8)
a1.text(1.1, 3110, 'ADC ตัน (~3050 mV)', color='#aa3333', fontsize=7, ha='left')
a1.set_ylim(0, 3400)
a1.set_xlabel('ความสว่าง (lux, สเกล log)')
a1.set_ylabel('แรงดันเข้า ADC (mV)')
a1.set_title('(ก) วงจรแบ่งแรงดัน (LDR ฝั่ง 3.3 V)')
a1.legend(frameon=False, fontsize=6.5, loc='lower right')
x = np.logspace(-2, 2, 400)
sens = vcc * gam * x / (1 + x) ** 2
a2.semilogx(x, sens, color=C1)
a2.axvline(1, color=GREY, lw=0.8, ls='--')
a2.annotate(f'สูงสุดเมื่อ R คงที่ = R ของ LDR\n= Vcc·γ/4 = {vcc * gam / 4:.0f} mV ต่อแสงเปลี่ยน e เท่า', xy=(1, vcc * gam / 4), xytext=(5, 380), fontsize=7,
             arrowprops=dict(arrowstyle='->', color=GREY, lw=0.8))
a2.set_xlabel('R คงที่ / R ของ LDR ที่แสงใช้งาน')
a2.set_ylabel('ความไว dV / d(ln E) (mV)')
a2.set_title('(ข) เลือก R คงที่ให้ไวที่สุด')
save(fig, 'fig_divider.svg')
NUM['divider_peak_mv_per_efold'] = vcc * gam / 4
NUM['divider_peak_mv_per_10pct'] = vcc * gam / 4 * math.log(1.1)
NUM['G_at_sat'] = 3050 / (3300 - 3050)

# ------------------------------------------------------------------ fig_brightness: raw mV vs our estimator
fig, (a1, a2) = plt.subplots(1, 2, figsize=(6.6, 2.7))
cols = {0.5: C2, 1: C1, 2: C3}
lss = {0.5: '--', 1: '-', 2: ':'}
for row in data['bright']:
    K = row['K']
    a1.plot(row['th'], row['rawD'], color=cols[K], ls=lss[K], label=f'หลอด ×{K:g}')
    err = np.array(row['ours']) - np.array(row['th'])
    errRaw = np.array(row['raw']) - np.array(row['th'])
    a2.plot(row['th'], errRaw, color=cols[K], ls=lss[K], lw=0.9, alpha=0.55)
    a2.plot(row['th'], err, color=cols[K], ls=lss[K], lw=1.8, label=f'ของเรา หลอด ×{K:g}')
a1.set_xlabel('มุมแสงจริง θ (°)')
a1.set_ylabel('(VL − VR)/(VL + VR) จาก mV ดิบ')
a1.set_title('(ก) ใช้ mV ดิบ: เส้นเปลี่ยนตามความสว่าง')
a1.legend(frameon=False)
a2.set_xlabel('มุมแสงจริง θ (°)')
a2.set_ylabel('มุมที่คำนวณ − มุมจริง (°)')
a2.set_title('(ข) error: เส้นหนา = ของเรา, จาง = atan(D ดิบ)·k')
a2.set_ylim(-12, 12)
a2.legend(frameon=False, fontsize=7, loc='lower left')
save(fig, 'fig_brightness.svg')
for r in data['brightMae']:
    NUM[f'bright_K{r["K"]}_ours_mae'] = r['ours']
    NUM[f'bright_K{r["K"]}_raw_mae'] = r['raw']

# ------------------------------------------------------------------ fig_flicker: why a 20 ms window
fig, ax = plt.subplots(figsize=(6.6, 2.4))
T = np.linspace(0.5, 50, 1000)
f = 100.0
res = np.abs(np.sinc(f * T / 1000.0))  # numpy sinc = sin(pi x)/(pi x)
ax.plot(T, res * 100, color=C1)
for t0, lab in [(10, '10'), (20, '20 (ค่าที่ใช้)'), (30, '30'), (40, '40')]:
    ax.plot([t0], [0], 'o', color=C4, ms=5)
    ax.annotate(lab, (t0, 0), xytext=(t0, 12), ha='center', fontsize=7, color=C4)
r15 = abs(np.sinc(f * 0.015)) * 100
ax.plot([15], [r15], 'o', color=C3, ms=5)
ax.annotate(f'15 ms: เหลือ {r15:.0f}%', (15, r15), xytext=(18, r15 + 15), fontsize=7, color=C3, arrowprops=dict(arrowstyle='->', color=C3, lw=0.8))
ax.set_xlabel('ความยาวหน้าต่างเฉลี่ย (ms)')
ax.set_ylabel('ไฟกระพริบที่เหลือ (%)')
ax.set_title('ไฟบ้าน 50 Hz ทำให้หลอดกระพริบ 100 Hz: เฉลี่ยเต็มคาบ (ทุก 10 ms) ตัดทิ้งได้หมด')
ax.set_ylim(-5, 105)
save(fig, 'fig_flicker.svg')
NUM['flicker_residual_15ms_pct'] = r15

# ------------------------------------------------------------------ fig_fit: calibration data, model, errors
cal = data['cal']
fig, (a1, a2) = plt.subplots(1, 2, figsize=(6.6, 2.8))
pts = np.array(cal['pts'])
mod = np.array(cal['model'])
a1.plot(pts[:, 0], pts[:, 1], 'o', color=C1, ms=3.5, label='วัดได้ ซ้าย')
a1.plot(pts[:, 0], pts[:, 2], 's', color=C2, ms=3.2, label='วัดได้ ขวา')
a1.plot(mod[:, 0], mod[:, 1], color=C1, lw=1)
a1.plot(mod[:, 0], mod[:, 2], color=C2, lw=1, ls='--')
a1.set_xlabel('มุมตัวขับตอน sweep (°)')
a1.set_ylabel('G (conductance สัมพัทธ์)')
a1.set_title(f'(ก) sweep 25 จุด กับโมเดล (rms log = {cal["rms"]:.4f})')
a1.legend(frameon=False, loc='upper right')
lo_, hi_ = cal['range']['lo'] + 2, cal['range']['hi'] - 2
e0 = np.array([[r[0], r[1]] for r in cal['errNoLut'] if r[2] and lo_ <= r[0] <= hi_])
e1 = np.array([[r[0], r[1]] for r in cal['errLut'] if r[2] and lo_ <= r[0] <= hi_])
vt = np.array(cal['valTrue'])
a2.plot(e0[:, 0], e0[:, 1], 'o-', color=C3, ms=3, lw=0.8, label='โมเดลอย่างเดียว')
a2.plot(e1[:, 0], e1[:, 1], 's-', color=C4, ms=3, lw=0.8, label='โมเดล + LUT (เทียบ φ ที่ fit)')
a2.plot(vt[:, 0], vt[:, 1], color=C1, lw=1.2, label='โมเดล + LUT เทียบมุมจริง')
a2.axhline(0, color=GREY, lw=0.6)
a2.set_ylim(-1.2, 1.2)
a2.set_xlabel('มุมแสง θ (°)')
a2.set_ylabel('error (°)')
a2.set_title('(ข) error ในช่วงที่วัดแม่น')
a2.legend(frameon=False, fontsize=7, loc='upper left')
save(fig, 'fig_fit.svg')
NUM['cal_rms'] = cal['rms']
NUM['cal_alpha'] = cal['P']['alpha']
NUM['cal_gL'] = cal['P']['gL']
NUM['cal_gR'] = cal['P']['gR']
NUM['cal_phi_offset'] = cal['phiOffset']
NUM['cal_val_true_mae'] = cal['valTrueMetrics']['mae']
NUM['cal_val_true_max'] = cal['valTrueMetrics']['max']
NUM['cal_val_true_mean'] = cal['valTrueMetrics']['mean']
NUM['cal_range'] = [cal['range']['lo'], cal['range']['hi']]
NUM['compare'] = cal['compare']

# ------------------------------------------------------------------ fig_ambient: lit room
fig, axes = plt.subplots(1, 2, figsize=(6.6, 2.8), sharey=True)
style = {
    'legacy': ('เลือกจุด fit แบบเดิม (นับแสงห้องเป็นแสงหลอด)', C3, ':'),
    'noAmb': ('ไม่วัดแสงรอบข้าง (ข้าม AMB)', C2, '--'),
    'shared': ('วัด AMB, γ เดียว', GREY, '-.'),
    'perLdr': ('วัด AMB, γ แยกแต่ละ LDR (ที่ใช้จริง)', C4, '-'),
}
for ax, amb in zip(axes, [0.1, 0.3]):
    for row in [r for r in data['ambient'] if abs(r['amb'] - amb) < 1e-9]:
        lab, col, ls = style[row['mode']]
        ax.semilogy(row['Ks'], row['mae'], color=col, ls=ls, marker='o', ms=3, label=lab)
        NUM[f'amb{amb}_{row["mode"]}'] = row['mae']
    ax.set_xscale('log')
    ax.minorticks_off()
    ax.set_xticks([0.4, 0.5, 0.7, 1, 1.4, 2])
    ax.set_xticklabels(['0.4', '0.5', '0.7', '1', '1.4', '2'])
    ax.set_xlabel('ความสว่างหลอดเทียบตอนคาลิเบรต (เท่า)')
    ax.set_title(f'แสงห้อง = {amb * 100:.0f}% ของหลอด')
axes[0].set_ylabel('MAE ของมุม (°, สเกล log)')
h, l = axes[1].get_legend_handles_labels()
fig.legend(h, l, frameon=False, fontsize=7, loc='lower center', ncol=2)
fig.tight_layout(rect=(0, 0.16, 1, 1))
fig.savefig(os.path.join(HERE, 'fig_ambient.svg'))
plt.close(fig)
print('wrote fig_ambient.svg')

# ------------------------------------------------------------------ fig_control: move-wait-measure convergence
fig, ax = plt.subplots(figsize=(6.6, 2.7))
n = np.arange(0, 9)
for kr, col, ls, note in [(0.5, C2, '--', 'ช้า'), (0.85, C4, '-', 'ที่ใช้'), (1.0, C1, '-.', 'พอดี'), (1.5, C3, ':', 'เลยแล้วแกว่ง'), (2.1, '#aa3333', (0, (4, 1)), 'ลู่ออก')]:
    e = 20 * (1 - kr) ** n
    ax.plot(n, e, color=col, ls=ls, marker='o', ms=3, label=f'k·r = {kr:g} ({note})')
ax.axhspan(-0.3, 0.3, color=GREY, alpha=0.15, lw=0)
ax.text(8.2, 0.9, 'deadband ±0.3°', fontsize=7, color=GREY, ha='right')
ax.set_ylim(-36, 36)
ax.set_xlabel('รอบที่ (วัด → หมุน → รอ)')
ax.set_ylabel('error (°)')
ax.set_title('error รอบถัดไป = (1 − k·r) × error รอบนี้   ลู่เข้าเมื่อ 0 < k·r < 2')
ax.legend(frameon=False, fontsize=7, loc='center left', bbox_to_anchor=(1.0, 0.5))
save(fig, 'fig_control.svg')
NUM['iters_75_to_0p3_kr085'] = math.log(0.3 / 75) / math.log(0.15)

# ------------------------------------------------------------------ fig_backlash: gear play
fig, ax = plt.subplots(figsize=(6.6, 2.6))
b = 1.4
motor = np.concatenate([np.linspace(0, 6, 60), np.linspace(6, -2, 80), np.linspace(-2, 4, 60)])
out = []
o = 0.0
for m in motor:
    if m - o > b / 2:
        o = m - b / 2
    elif m - o < -b / 2:
        o = m + b / 2
    out.append(o)
ax.plot(motor, out, color=C1)
ax.plot([-2, 6], [-2, 6], color=GREY, lw=0.6, ls='--')
ax.annotate('', xy=(3, 3 - b / 2), xytext=(3, 3 + b / 2), arrowprops=dict(arrowstyle='<->', color=C3, lw=1))
ax.text(3.15, 3, f'backlash b = {b}°\n(ไป-กลับต่างกัน)', fontsize=7, color=C3, va='center')
ax.set_xlabel('มุมที่มอเตอร์หมุน (นับจาก step, °)')
ax.set_ylabel('มุมของตัวดาวเทียมจริง (°)')
ax.set_title('เฟืองมีระยะฟรี: เปลี่ยนทิศแล้วตัวดาวเทียมยังไม่ขยับจนกว่ามอเตอร์หมุนผ่านระยะ b')
save(fig, 'fig_backlash.svg')

# ------------------------------------------------------------------ fig_camera: pixel <-> angle
fig, (a1, a2) = plt.subplots(1, 2, figsize=(6.6, 2.6))
W, hfov = 640, 62.0
fpx = W / 2 / math.tan(hfov / 2 * DEG)
px = np.linspace(0, W, 400)
ang = np.degrees(np.arctan((px - W / 2) / fpx))
a1.plot(px, ang, color=C1)
a1.set_xlabel('ตำแหน่งในภาพ x (pixel)')
a1.set_ylabel('มุมจากแกนกล้อง (°)')
a1.set_title(f'(ก) 640 px, มุมรับภาพ {hfov:g}°: f = {fpx:.0f} px')
res = np.degrees(np.arctan((px + 1 - W / 2) / fpx) - np.arctan((px - W / 2) / fpx))
a2.plot(px, res, color=C4)
a2.set_xlabel('ตำแหน่งในภาพ x (pixel)')
a2.set_ylabel('องศาต่อ 1 pixel')
a2.set_title(f'(ข) กลางภาพ 1 px = {res[len(res) // 2]:.3f}°')
save(fig, 'fig_camera.svg')
NUM['cam_fpx'] = fpx
NUM['cam_deg_per_px_center'] = math.degrees(math.atan(1 / fpx))
NUM['blur_px_40dps_30ms'] = 40 * 0.030 * DEG * fpx

# ------------------------------------------------------------------ error budget
noise_mv = 4.0
dth = abs(data['noise']['dThetaPerMv'])
spr_true = 64 * (31 * 32 * 26 * 22) / (11 * 10 * 9 * 9)
budget = [
    # (label, before, after)
    ('noise ADC (4 mV ต่อครั้งอ่าน)', dth * noise_mv * math.sqrt(2), dth * noise_mv / math.sqrt(54) * math.sqrt(2)),
    ('LDR ตามไม่ทัน (วัดทันทีหลังหมุน 10°)', 10.0, 10.0 * math.exp(-150 / 25)),
    ('หลอดสว่างเปลี่ยน ×0.5–×2', max(NUM['bright_K0.5_raw_mae'], NUM['bright_K2_raw_mae']), max(NUM['bright_K0.5_ours_mae'], NUM['bright_K2_ours_mae'])),
    ('ห้องเปิดไฟ 30% (ไม่วัด AMB → วัด)', data['ambient'][-1]['mae'][3], [r for r in data['ambient'] if r['amb'] == 0.3 and r['mode'] == 'perLdr'][0]['mae'][3]),
    ('ศูนย์เยื้อง (ติดตั้ง/โมเดล)', 0.37, 0.049),
    ('step ต่อรอบผิด 4096 → 4076 (ที่ 90°)', 90 * (4096 - spr_true) / spr_true, 90 * 1 / spr_true),
    ('backlash เฟือง 1.4°', 1.4, 0.05),
    ('ความละเอียด stepper (ครึ่ง step)', 360 / spr_true / 2, 360 / spr_true / 2),
    ('deadband ของตัวควบคุม', 0.3, 0.3),
    ('กล้องติดเยื้อง (boresight)', 2.2, NUM['cam_deg_per_px_center']),
]
fig, ax = plt.subplots(figsize=(6.6, 3.4))
yy = np.arange(len(budget))[::-1]
ax.barh(yy + 0.18, [b_[1] for b_ in budget], height=0.34, color=C3, alpha=0.75, label='ถ้าไม่จัดการ')
ax.barh(yy - 0.18, [b_[2] for b_ in budget], height=0.34, color=C4, label='หลังจัดการ (ระบบของเรา)')
ax.set_yticks(yy)
ax.set_yticklabels([b_[0] for b_ in budget], fontsize=7.5)
ax.set_xscale('log')
ax.set_xlim(0.005, 40)
ax.set_xlabel('ความคลาดเคลื่อนของมุม (°, สเกล log)')
ax.legend(frameon=False, loc='lower center', bbox_to_anchor=(0.5, 1.0), ncol=2)
ax.grid(axis='y', visible=False)
save(fig, 'fig_budget.svg')
NUM['budget'] = [{'item': b_[0], 'before': b_[1], 'after': b_[2]} for b_ in budget]
NUM['m1_rss_after'] = math.sqrt(sum(v ** 2 for v in [budget[0][2], budget[2][2], budget[4][2], budget[6][2], budget[7][2], budget[8][2]]))
NUM['spr_true'] = spr_true
NUM['noise_dtheta_per_mv'] = dth

# ------------------------------------------------------------------ fig_week: official schedule (latest PDF)
days = ['5 ต.ค.', '6 ต.ค.', '7 ต.ค.', '8 ต.ค.', '9 ต.ค.']
blocks = [
    # day index, start, end, label, kind
    (0, 10.5, 11, 'ลงทะเบียน', 'x'), (0, 11, 12, 'ปฐมนิเทศ', 'x'), (0, 13, 14.5, 'พิธีเปิด+บรรยาย', 'x'),
    (0, 14.5, 18, 'ADCS พื้นฐาน (ลงมือ)', 'adcs'),
    (1, 9.5, 10.5, 'บรรยาย', 'x'), (1, 10.5, 12, 'ADCS ชี้ทิศ', 'adcs'), (1, 13, 14.5, 'สถานีภาคพื้น', 'comm'),
    (1, 14.5, 17, 'กล้อง Payload', 'cam'),
    (2, 8.5, 17, 'ดูงาน มทม. + สถานีไทยคม (ไม่มีเวลาทำงานกับบอร์ด)', 'trip'),
    (3, 9.5, 10.5, 'AIT', 'adcs'), (3, 10.75, 12, 'ปฏิบัติภารกิจ', 'adcs'), (3, 13, 17, 'ปรับจูน + ซ้อมภารกิจ (สำคัญสุด)', 'tune'),
    (4, 8.5, 9, 'ฟังโจทย์', 'brief'), (4, 9, 12, 'แข่งจริง', 'race'), (4, 13, 14.5, 'ประกาศผล', 'x'),
]
kc = {'x': '#cfcfcf', 'adcs': C1, 'comm': C3, 'cam': C2, 'trip': '#9b9b9b', 'tune': C4, 'race': '#aa3333', 'brief': '#6b4fa0'}
fig, ax = plt.subplots(figsize=(6.6, 2.6))
for d, s, e, lab, k in blocks:
    y = 4 - d
    ax.broken_barh([(s, e - s)], (y - 0.35, 0.7), color=kc[k], alpha=0.9 if k != 'x' else 0.6)
    if e - s >= 0.9:
        ax.text((s + e) / 2, y, lab, ha='center', va='center', fontsize=6.5, color='white' if k not in ('x',) else '#333333')
ax.annotate('08:30 ฟังโจทย์', (8.75, 0.35), xytext=(8.05, 0.62), fontsize=6.5, color='#6b4fa0')
ax.set_yticks(range(5))
ax.set_yticklabels(days[::-1])
ax.set_xlim(8, 18.2)
ax.set_xticks(range(8, 19))
ax.set_xticklabels([f'{h}:00' for h in range(8, 19)], fontsize=7)
ax.grid(axis='y', visible=False)
ax.set_title('ตารางรอบชิง 5–9 ต.ค. 2569 (จากกำหนดการล่าสุด)')
save(fig, 'fig_week.svg')

json.dump(NUM, open(os.path.join(HERE, 'numbers.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
for k, v in NUM.items():
    if k in ('compare', 'budget'):
        continue
    print(k, '=', v)
print('m1 RSS after =', round(NUM['m1_rss_after'], 3))
for b_ in NUM['budget']:
    print(f"  {b_['item']}: {b_['before']:.3f} -> {b_['after']:.3f}")
