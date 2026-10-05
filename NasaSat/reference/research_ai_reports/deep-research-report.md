# Thailand Young Satellite Challenge 2026 – AI-Coding-Agent Knowledge Base

## 00_MAIN_PROJECT.md
This repository compiles confirmed facts, engineering principles, and implementation guidance for the **Thailand Young Satellite Challenge 2026** Regional Round. It is structured into sections that correspond to the deliverables in the project specification, intended as a comprehensive reference for an AI code assistant. The primary confirmed competition task is building a **Sun Sensor System**: teams must use LDR light sensors, a constructed **Light Baffle**, and Arduino/C++ code to compute the angle of incident sunlight. The Regional Round is on-site (1 day per region), Arduino-based, with teams of 4 (3 students + 1 advisor). Key dates (from official timeline) include announcement of 90 qualifying teams on 11 Aug 2026 and regional competitions 18 Aug–9 Sep 2026.  

We collect *confirmed* info (rules, objectives, timeline) and then build out engineering context (hardware, sensors, algorithms, coding, calibration, etc.). Each section notes whether facts are **CONFIRMED** by official sources, **STRONGLY SUPPORTED** by multiple references, or **ENGINEERING INFERENCE/GENERAL BACKGROUND** where needed. Any competition-specific detail that cannot be verified is listed as **UNKNOWN**. The final part of this knowledge base highlights the **Top 20 critical facts** and preparation steps for the AI, likely failure modes, and **exact information** to capture once the official hardware and challenge description are known.

## 01_COMPETITION_SPEC.md
**Confirmed Competition Details:** The Regional Round challenges teams to *“ออกแบบและพัฒนาระบบเซนเซอร์ตรวจวัดทิศทางแสงอาทิตย์ (Sun Sensor System) ด้วยเซนเซอร์ LDR, สร้างกรอบกันแสง (Light Baffle), และเขียนโปรแกรมประมวลผลเพื่อคำนวณมุมองศา”*. In other words, teams must assemble light-dependent resistors (LDRs) with a light baffle and program an Arduino to compute the sun’s angle. Teams use the Arduino IDE and must bring their own laptops. The competition is 2 rounds: regional (onsite, 5 regions) and a final in Bangkok. A total of **90 teams** (18 per region) compete regionally, from which only *2 teams per region advance* to the finals. The registration and announcement timeline is: registration 20 Jul–6 Aug 2026, 90 teams announced 11 Aug, regional contests 18 Aug–9 Sep 2026. 

**Regional Round Format:** On the contest day (1 day per region), teams receive a kit (likely Arduino-compatible board, LDRs, resistors, wires, and materials to build a baffle). They must build the sun sensor hardware *onsite*, then run code to estimate the sun’s incidence angle. Scoring and exact tasks *(e.g. time limit, angle range, sample rate)* are not published; likely based on angle accuracy and speed. Known rules: must use Arduino IDE. Unknown/Not confirmed: specific board model, pin assignments, number of sensors, resistor values, baffle dimensions, lamp properties, output format, exact scoring formula, or time limits. *All these remain MUST-VERIFY at the event.* 

**Competition Constraints:** The only confirmed constraints are use of Arduino (likely an official model) and no internet; teams have laptops for coding. External libraries or internet research are unspecified. Teams should prepare for standard embedded development (C/C++), but details like allowed libraries or serial format are unknown and will be clarified onsite. 

(For confirmed details, see official timeline and challenge description. All other competition-specific parameters above are **UNKNOWN**.) 

## 02_HARDWARE.md
### Microcontroller and Development Board  
- **Likely Arduino-compatible:** Official sources only say "Arduino IDE". The exact board model is **UNKNOWN** (teams should verify at contest). It may be an Arduino Uno or newer model. We **cannot assume** Uno, but for reference: Arduino Uno (ATmega328P) runs at 16 MHz with a 10-bit ADC (0–1023 values, 0–5 V reference), 32 KB Flash, 2 KB SRAM. (If a different board is provided, e.g. Arduino Uno R4 or Mega, specs will differ.) We document both possibilities: e.g. Uno’s 10-bit ADC and PWM pins (analogWrite 8-bit on most pins) and note any relevant differences.  
- **Power:** Teams likely supply 5 V (via USB or power supply). The MCU and sensors draw negligible current (LDRs ~100 μA in bright light). Ensure stable 5V reference if using default ADC reference; verify if external reference is required.  
- **Pins and Interfaces:** The contest likely provides several analog inputs. We infer at least 2–4 analog pins for LDRs. The board may also have PWM outputs or digital pins if motor/servo is used (more likely in finals). We cover both analog and digital pin usage. A typical Arduino has I2C/SPI for future use, but not needed here. The ADC reference is probably Vcc (5 V) unless stated otherwise. 

### Light-Dependent Resistors (LDRs)  
- **Function:** LDRs (photoresistors) change resistance with illumination. A common type (e.g. CdS cell) has very high dark resistance (∼MΩ) and low bright resistance (∼100 Ω). For example, a typical GL5528 LDR is ~10–20 kΩ in bright light and ~1 MΩ in dark. Another source notes CdS LDRs vary from a few hundred Ω in strong light to >10 MΩ in darkness.  
- **Nonlinearity:** LDR response is strongly **nonlinear** (roughly inverse to light). Its sensitivity peaks around 550–600 nm (yellow-green). Because of nonlinearity and unit-to-unit variation, raw ADC values from different LDRs cannot be assumed identical without calibration.  
- **Response time:** LDRs respond in ~10–30 ms to illumination change, but **recovery** in the dark can take seconds. Teams should allow settling after any rapid changes (e.g. when calibrating or after toggling lights).  
- **Circuit:** Each LDR will be used in a voltage-divider. Typically: Vcc – [LDR] – [fixed resistor] – GND, with Vout at the junction to an analog input. The fixed resistor should be on the order of the LDR’s mid-range resistance. (For instance, if LDR ranges 1 kΩ–100 kΩ, a 10 kΩ resistor might be used.) This makes Vout vary with illumination. If configured inversely (LDR to Vcc or to GND), readings invert accordingly. The exact resistor values provided are **UNKNOWN**; teams should check kit materials and measure any values.  
- **Characteristics:** Typical specs: max power ~200 mW, max voltage ~150–200 V (not an issue here). Tolerance and temperature effects are significant: expect ±20–30% variation between units and drift with temp/light history. Hysteresis (memory of previous light) can cause slow drift, so calibrate with stable conditions.  

### Light Source and Baffle  
- **Illumination:** Likely a stable artificial light (e.g. lamp or LED) simulating the Sun, placed at various angles. Its position relative to the sensor apparatus is fixed; teams rotate or angle their sensor assembly relative to it. Lamp brightness may vary with distance/angle – this must be accounted for by algorithm (e.g. normalization). Ambient light in venue could also affect readings; using only the provided lamp in a controlled dark box or enclosure is best.  
- **Light Baffle:** A mechanical shade/block is required to make the sensors directional. For example, a small barrier of opaque card between two LDRs ensures that one sensor is shadowed when the sun is off-axis. In practice, teams use black tubes or cutouts around sensors to limit field-of-view. A taller baffle or longer tube narrows acceptance angle, improving precision but reducing max detectable angle. (Rough geometry: if two sensors are separated by distance 2L and a baffle of height H above their midpoint, the system’s ±FOV ≈ arctan(L/H).) The **exact dimensions and materials** of the provided baffle kit are **UNKNOWN**; likely simple (black cardboard/plastic). The baffle interior should be matte black to prevent reflections. Alignment and symmetry are critical; any tilt will bias readings.  

### Wiring and Circuit Board  
- **Breadboard/PCB:** Teams probably receive a breadboard or pre-made PCB. Wiring should be neat: each LDR circuit referenced to GND and 5V. Avoid floating analog pins. Use common ground for all sensors and the Arduino. Ensure no short circuits. Breadboard has parasitics; double-check connections if readings are noisy.  
- **Common failure modes:** Interchangeable with coding: shorted ground/wire, miswired resistor (LDR vs fixed resistor swapped), unpowered board. If all ADC reads are 0 or 1023, check wiring (power, ground, orientation of LDR).  

*(Hardware summary drawing or photo not provided; teams should document their exact wiring once revealed.)*

## 03_SUN_SENSOR.md
This section covers the **sun sensor principle** and baffle design.

### Sun-Sensor Concept  
A coarse sun sensor estimates the Sun’s incident direction by measuring differential illumination on multiple photodetectors behind a shade. In the Regional Challenge, likely 1-axis (two sensors) or 2-axis (four sensors) arrangements are used. Each axis uses two LDRs separated by the baffle. When the sensor assembly is *pointed directly at the light*, both LDRs receive equal illumination (via the central gap in the baffle). When off-angle, one sensor is more exposed and the other more shadowed. The difference in their outputs indicates the **angle error**. 

**Two-sensor (one-axis) design:** Two LDRs placed at equal distance from the center under a bar or tube. A centrally-placed barrier (piece of card or tube wall) casts a shadow. For small angular changes, the relative light on each sensor changes linearly. This is essentially a differential photodetector. Robin (Arduino forum) reports success with “a pair of LDRs with a small piece of card providing a barrier between them”. More formally, as Olin Lathrop explains, *“A light baffle causes the light on [the two LDRs] to be equal when pointed at the sun. When off to one side, one LDR gets more light and the other less”*, and thus the sensor voltage difference measures the alignment error.  

**Four-sensor (two-axis) design:** Four LDRs at the corners (N, S, E, W). Two separate baffles (one for each axis) or a cross-shaped baffle can create two differential pairs. The azimuth (East-West) angle is given by the E vs W difference, and elevation (North-South) by N vs S difference. In practice, we strongly infer the challenge is *1-axis only* (sun’s angle in one plane), but teams should be prepared to extend to 2D if needed (the final round involves 3-axis anyway).  

### Geometry and Baffle  
The baffle defines the field-of-view (FOV) and sensitivity. Basic relationship (symmetric 2-sensor case): if two sensors are at distance ±L from center and a baffle of height H sits above the midpoint, then when the sun angle θ satisfies tan(θ) = L/H, one sensor is just fully shadowed. Thus maximum measurable angle ≈ arctan(L/H). A taller baffle (larger H) narrows the FOV (higher resolution near center) but limits angle range; a shorter baffle increases FOV but with lower sensitivity near center. Teams may choose to adjust H or L (within given kit size) to trade off range vs precision. All surfaces should be non-reflective (black paint or felt) to prevent stray light.  

Key design points:
- **Barrier shape:** Often a simple rectangular plate or an open tube. For example, a short cylindrical or rectangular tube above the sensors, with internal vertical walls, yields a sharp cutoff. The inside must be matte black.
- **Symmetry:** Sensors should be symmetrically placed relative to the central divider to avoid bias.
- **Light leaks:** Any gaps or tilt can cause uneven lighting. If one sensor always reads higher even at 0°, calibrate for offset (see Phase 6).  
- **Examples:** The Arduino forum suggests painting the inside of toilet-paper-tube baffles black. One might use cardboard or 3D-print as black plastic.  
- **Blind zones:** If the lamp is far off axis, both sensors might be shadowed or equally lit outside useful range. The system likely expects an angle range (e.g. ±45°) where sensor difference reliably indicates direction.

No official diagrams are available for this challenge. Teams should test their baffle by scanning the lamp and observing the sensor readings: at 0°, LDR readings should match (balanced), and at ±max angle one side should saturate while the other goes low, up to the point where sunlight misses both sensors.

## 04_ALGORITHMS.md
This section covers methods to compute angle from LDR readings.

### Differential Output
The simplest *feature* is the **difference** between two sensor readings, e.g. `diff = L - R`. This raw difference indicates which side has more light (sign gives direction). However, absolute difference also grows with overall light intensity (brighter lamp → larger values). To remove intensity dependence, use a **normalized difference**:
```
D = (L - R) / (L + R)
```
This ratio is independent of overall brightness if sensors have similar responses. When pointed exactly at sun, `L≈R` so D≈0 (center). Off-angle, D→±1 (near full difference). Olin Lathrop’s analysis states that any static mismatch between sensors is “swamped by a small angular change” and that calibrating the mid-point (full-sun center) is sufficient. In other words, D gives a signed measure of the angle offset. For numerical stability, ensure L+R ≠ 0 (if both very small, angle is at extreme or nighttime; this case unlikely with lamp on). 

### Trigonometric Calibration
If the geometry is known, one can derive an analytical formula. For example, if small-angle behavior is approximately linear, one might fit:
```
θ_est ≈ k * (L - R)/(L + R)
```
for some scale factor k. For a more complete mapping, consider using arctangent to convert ratio to angle:
```
angle_rad = atan2(L - R, L + R);
angle_deg = angle_rad * (180.0/π);
```
This treats `(L-R)` as sine component and `(L+R)` as cosine-like baseline. The Arduino math library provides `atan2()` (returns radians). Note `atan2(y,x)` gives the arctan of y/x in the correct quadrant. By using `(L-R)` as y and `(L+R)` as x, `atan2` yields an angle in [–90°, +90°] roughly corresponding to sensor tilt. This method inherently normalizes by (L+R) and handles sign. It yields zero at L=R. 

### Calibration Curve
Even with `atan2`, raw sensor nonlinearity means the mapping from D to θ is not perfect. A robust solution is to **calibrate empirically** (see Phase 6). For instance, record D (or voltage ratio) at known angles and fit a curve (polynomial or piecewise linear). On Arduino, a lookup-table with linear interpolation is simple and safe. E.g., store arrays `angle_points[]` and `ratio_points[]` and interpolate. This avoids floating arithmetic except for interpolation. Alternatively, fit a 3rd-order polynomial to map D to θ, then use the resulting coefficients in code (use with care due to float precision). In summary, possible angle estimation methods:
- *Linear model:* θ ≈ a·(L-R)+b, valid only near center.
- *Normalized model:* θ ≈ a·(L-R)/(L+R)+b (compensates intensity).
- *Arctan method:* θ = atan2(L-R, L+R).
- *Empirical table:* θ = f(D) via lookup or interpolation.
- *Multi-sensor:* If 4 LDRs, compute (N-S) and (E-W) separately to get azimuth and elevation.

Arduino has floating math (`atan2`, trig), but each call is moderately costly. If speed is critical, a lookup table with linear interpolation (piecewise linear calibration) is often faster and reasonably accurate.

No existing code is given by organizers, so we must implement these ourselves. *Important:* all variables fed to `atan2` or divisions should be cast to `double` or `float` to avoid integer division truncation. Also consider saturating/clamping outputs to avoid passing out-of-range values to inverse trig.

**Summary of useful formulas:**  
- Voltage divider: $V_{\rm out} = V_{\rm in}\cdot \frac{R_{\rm fixed}}{R_{\rm fixed}+R_{\rm LDR}}$.  
- ADC conversion: `ADC = analogRead()`, then $V = ADC * (V_{ref}/1023)$. (Assume $V_{ref}=5.0$ V.)  
- Normalized diff: $D = \frac{V_L - V_R}{V_L + V_R}$.  
- Angle (radians): $\theta = \atan2(V_L - V_R,\;V_L + V_R)$. Convert to degrees.  
- Calibration mapping: $\theta_{\rm final} = f(\theta)$ or $\theta_{\rm final} = f(D)$ fitted from calibration.  

*(All above assume two-sensor, 1D case. For 2D, compute two differentials.)*

## 05_ARDUINO_CPP.md
This section outlines relevant Arduino/C++ programming concepts and common pitfalls.

### Core Arduino Concepts
- **`setup()` and `loop()`:** Use `void setup()` for initialization (e.g. `Serial.begin(9600);`, `pinMode` for any outputs). The `loop()` runs continuously to read sensors and output results. Use non-blocking timing (check `millis()`) for any delays or periodic actions.  
- **Reading Sensors:** Use `analogRead(pin)` to get a 0–1023 value. No `pinMode()` needed for analog input (it defaults to INPUT). The return is an `int` (16-bit). For example: `int L = analogRead(A0); int R = analogRead(A1);`.  
- **Serial Output:** Typically print angle or intermediate values: e.g., `Serial.print(angle); Serial.println(" deg");`. Match whatever format the judges expect (unknown until clarifications). Avoid very high baud rates; 9600 or 115200 is common. Excessive `Serial.print` can slow code or block; use sparingly once debugging is done.

### Data Types and Math
- **Integer vs Float:** ADC values are ints (0–1023). For calculations like division or `atan()`, convert to float/double: e.g. `double Ld = (double)L;`. Otherwise `(L-R)/ (L+R)` will do integer math. Cast one operand: `(L - R) / double(L + R)`.  
- **atan2:** Include `<math.h>` and use `atan2(y,x)`. It returns a *double* in radians. Convert to degrees: `float angle = atan2(y, x) * 180.0 / PI;`. On Arduino UNO, floats are 4-byte with ~7 digits precision. Sufficient for degrees.  
- **Arduino math library:** Standard C functions (`sin`, `cos`, `tan`, `atan`, `atan2`) are available. Use these to compute angles or if applying non-linear calibration. Beware that `atan()` returns –π/2..+π/2, whereas `atan2()` covers full circle (–π..+π). For a 1D sensor, `atan2(diff, sum)` is convenient.  
- **map() function:** Takes longs and returns a `long`. It linearly maps a value from one range to another. Useful to scale 0–1023 to 0–255 for PWM (as shown here), or 0–1023 to angle range. But `map()` only works on integer values (it truncates). For final-angle mapping, better use float interpolation or custom formula.  
- **Constants:** Use `const` for fixed values (e.g. pin numbers, calibration coefficients). For PI, use `M_PI` from `math.h` or define `#define PI 3.14159`.  
- **Timing:** Avoid using `delay()` inside loops except for debouncing or initial waits. Use `unsigned long prev = millis(); if (millis() - prev >= interval) { ...; prev = millis(); }` for periodic tasks.  
- **Non-blocking:** Code should continuously read sensors and update angle; don’t freeze waiting for anything.  
- **Serial.print pitfalls:** Printing floats defaults to 2 decimal places (`Serial.print(angle, 2);`). Too much serial output slows execution. Only print what is needed.

### Common Coding Mistakes
- **Integer division:** `int a=3, b=2; a/b` yields 1. Always cast: `(float)a/b`.  
- **Overflow:** On Arduino Uno, `int` is 16-bit (max 32,767). ADC is within range. But computations (like intermediate products) might overflow if using `int`. Use `long` or `float` as needed.  
- **Uninitialized variables:** Always initialize: `float angle=0;`.  
- **Wrong ADC assumptions:** By default, analog reference is 5 V. If using default, ADC=1023 ⇒ 5 V. If board is 3.3 V logic, reference may differ.  
- **Excess delay:** Using `delay(1000)` will make code unresponsive for 1 second. Use brief delays (10–50ms) only if needed for sensor stabilization.  
- **Noise and stability:** Reading only once per loop can be noisy. We will implement filtering below, so one raw read is likely too jagged.  
- **Array bounds:** If using calibration table, ensure index stays in range (check at runtime).  
- **Floating precision:** Don’t compare floats for equality (never use `==` on float). Instead check if within tolerance.  
- **Serial format:** Judges may require a specific format (e.g. `"Angle: X deg"` or just the numeric value). Ensure it matches instructions exactly. Unknown until announced; must adapt quickly when known.  

### Arduino Code Snippets
Below are example snippets illustrating points:

```cpp
// Example sensor reading and diff calculation
const int pinL = A0, pinR = A1;
int rawL = analogRead(pinL);
int rawR = analogRead(pinR);
float L = rawL;  // cast to float
float R = rawR;
float diff = L - R;
float sum = L + R;
// Avoid division by zero:
float norm = (sum != 0) ? diff/sum : 0.0;

// Compute angle using atan2 (radians to degrees):
float angleRad = atan2(diff, sum);
float angleDeg = angleRad * 180.0 / PI;

// Example safe mapping to PWM (if needed):
int pwmVal = (int)( map(rawL, 0, 1023, 0, 255) );
analogWrite(9, pwmVal);  // PWM pin

// Example calibration linear interpolation:
// assume arrays float angleCal[i], ratioCal[i] sorted by ratioCal
float D = norm; 
float angleCalibrated;
if (D <= ratioCal[0]) angleCalibrated = angleCal[0];
else if (D >= ratioCal[n-1]) angleCalibrated = angleCal[n-1];
else {
  // find segment
  for (int i=0; i<n-1; i++){
    if (D >= ratioCal[i] && D <= ratioCal[i+1]) {
      float t = (D - ratioCal[i])/(ratioCal[i+1]-ratioCal[i]);
      angleCalibrated = angleCal[i] + t*(angleCal[i+1]-angleCal[i]);
      break;
    }
  }
}
```

*(No external libraries beyond standard Arduino/math are needed. Use `Wire.h` or others only if final tasks require them.)*

## 06_CALIBRATION_TESTING.md
### Calibration Procedure
Teams should calibrate the sensor at the contest. A recommended workflow:
1. **Setup Calibration Rig:** Fix the light source and mount the sensor assembly so you can accurately set known angles (e.g. protractor or turntable). Ensure stable illumination and note distance (keep it constant during tests).  
2. **Data Collection:** For each test angle (e.g. –45°, –30°, –15°, 0°, +15°, +30°, +45°), record multiple raw readings from each LDR. Use average or median of several samples at each angle to reduce noise. (E.g. take 10 readings, drop outliers, compute average.)  
3. **Filter Noise:** Simple filtering (mean/median over N reads) at each angle is recommended. If readings fluctuate, slow down loop or add a small delay.  
4. **Compute Calibration Curve:** Compute normalized differences (or equivalent code feature) for each angle. Fit a curve: for instance, do a linear regression or spline such that normalized_diff = f(angle) (or invert it). Because sensor response is nonlinear, a higher-order fit or piecewise linear interpolation will be needed for accuracy. However, time is limited: many teams will find linear or quadratic fit adequate.  
5. **Validation:** Test the model by moving to intermediate angles (e.g. ±22.5°, ±37.5°) and check error. Compute metrics like mean absolute error (MAE) and maximum error. Adjust if error too large.  

**Metrics:** Evaluate:  
- **MAE (deg):** average absolute error over calibration/test angles.  
- **Max Error:** worst-case error within operating range.  
- **Repeatability:** variance of multiple readings at fixed angle (lower is better).  

**Robust Methods:** Outlier rejection (e.g. discard readings >3σ away) and median filtering guard against spurious spikes. If two LDRs have different gains, apply a gain factor or offset. Example: if at 0° L=1000, R=900, adjust R_up = R* (1000/900) so they match. 

Store final calibration parameters (gain, offset, or table) in code constants or arrays. Because speed matters, we advise a lookup table with linear interpolation (as shown above) or a simple polynomial. Precomputing the calibration on a PC and copying coefficients is a good strategy.

### Onsite Tips
- Calibrate under the actual lamp, not sunlight. The lamp spectrum may differ, affecting sensor response.  
- Make at least 5–7 points across the expected range. More points improve fit but take time.  
- If short on time, calibrate just 3 points (e.g. –max, 0, +max) and assume linear; refine later if time.  
- Measure the LDR in dark and brightest light to know bounds (for sanity check).  
- Document calibration data (writing it down or photographing graphs) in case AI refactoring needed.  
- Once code is written, quickly automate final tests: run a loop over a few known angles and print errors. 

*(No external references. Calibration relies on basic data-fitting and statistics concepts.)*

## 07_DEBUGGING.md
This **Troubleshooting Playbook** lists common issues and diagnostic actions:

- **All ADC readings zero (0):**  
  - Check 5 V power and GND to Arduino.  
  - Verify breadboard power rails.  
  - Ensure analog input pins correspond to actual LDR outputs.  
  - Confirm fixed resistor is not open (if LDR left floating, output floats).  
  - Try `Serial.println(analogRead(A0));` while exposing LDR to light/dark. If always 0, sensor or wiring is wrong.  
  - Suspect swapped GND/Vcc lines.

- **All ADC readings max (1023):**  
  - LDR leads or resistor may be swapped (LDR to ground instead of to Vcc).  
  - Check for a direct short from analog pin to Vcc (that saturates ADC).  
  - If using `INPUT_PULLUP`, disable it (pull-up would bias signal high).  
  - Lamp too bright close to sensor saturating LDR (unlikely to max out 0–5V scale).

- **Angle sign reversed:**  
  - Swap of L/R sensors. If output sign is flipped, just swap variables or invert final angle.  
  - Check code: maybe used `atan2(R-L, L+R)` instead of `(L-R)`. Consistency needed.

- **Works at center but fails at extremes:**  
  - Possibly baffle FOV issue: sensors get no differential at extreme angle (both shadow or lit).  
  - Ensure baffle isn’t too tall or too short. If too tall, outside small angle nothing reaches both sensors.  
  - If too much ambient light (no dark shadow), try shielding.  
  - Check ADC range: maybe at edges voltage swings saturate ADC (0 or 1023), losing linearity.

- **Results vary with lamp intensity:**  
  - If `L-R` (non-normalized) was used, changes in brightness shift all readings. The solution is to use normalized difference `(L-R)/(L+R)`.  
  - Verify analog reference stability (no fluctuation on 5 V supply).  
  - If sensor sensitivity drifts with light history (LDR hysteresis), allow settling time after any change.

- **Symmetric lighting but readings unequal:**  
  - Two nominally identical LDRs can have different resistance vs intensity.  
    - **Fix:** Calibrate the center point so that known 0° gives equal *digital* output (compute offset or scale factor). E.g. scale one sensor’s reading in code.  
  - Resistor tolerance mismatch: measure actual resistor values.  
  - Check wiring: maybe one fixed resistor value differs.  
  - Physical placement: sensors might not be exactly at same distance from center or baffle height. Re-center them precisely.

- **Noise or flickering readings:**  
  - Poor contact on breadboard, or LDR leads not firmly in place.  
  - High ADC impedance: add small capacitor across ADC input (optional fix).  
  - Floating input: always have resistor path.  
  - Using `analogRead` too fast without stabilization: add 5–10 ms delay or discard first reading after pin switch.

- **Serial output garbled or too slow:**  
  - Baud mismatch between Arduino and PC.  
  - Excessive printing (inside fast loop). Minimize prints in final run.  
  - Use `Serial.flush()` if outputs intermix.

- **Calibration weirdness:**  
  - If curve fit is poor, check data consistency (no spurious points).  
  - Mistyping calibration coefficients in code.  
  - Large zero-offset: maybe forgot to subtract mid-point.  
  - Use known reference: e.g., if pointing sensor up at 0°, output should be ~0°, and at ±30° should be ±30° (modulo mapping). Discrepancy signals calibration error.

Each of these can be tested methodically. For example, if angles jitter, compare raw LDR prints. If angle jumps abruptly, add filtering or clamp jumps. We recommend having a simple debug mode that prints raw L and R values along with computed angle, so one can correlate sensor behavior with environment.

*(The above heuristics are drawn from general LDR and embedded experience and the insights in.)*

## 08_COMPETITION_STRATEGY.md
### Team Roles and Workflow
**Team of 3 Students + 1 Advisor:** We suggest dividing labor by expertise:

- **Person A (Hardware Lead):**  
  - Assemble and wire the LDR sensor circuits and baffle.  
  - Check voltage-divider wiring (confirm resistors, sensors, and power).  
  - Align sensors symmetrically and secure baffle.  
  - Verify electrical stability (measure fixed resistor values with multimeter, ensure good connections).  

- **Person B (Software Lead):**  
  - Set up Arduino environment on laptop (IDE, drivers).  
  - Write basic code: read LDR values (`analogRead`), print to Serial.  
  - Implement diff calculation, then angle estimation.  
  - Integrate calibration (once data available) into code.  
  - Implement filtering (averaging or moving average) to smooth noise.  

- **Person C (Tester/Integrator):**  
  - Run calibration routine (rotate sensor to set angles, record data).  
  - Input data to Person B for calibration function design.  
  - Perform test runs: hold sensor at known angles and verify output.  
  - Document calibration data (notes or charts) and any unexpected behavior (to debug).  
  - Prepare final demonstration/test (e.g. a range of angles to show judge).

**Advisor (optional student):**  
  - Oversees the process, ensures tasks are synchronized.  
  - Helps with serial documentation (timing, printouts), potentially liaise with organizers if needed.

### Efficient Workflow (Time-Optimized)
1. **Setup Phase (30–60 min):** Assemble hardware and test wiring:  
   - Power on Arduino, ensure no short (no smoke!).  
   - Upload a “blink” test to confirm Arduino works.  
   - Wire LDR circuits; quickly test raw analog readings by covering/uncovering LDRs to see changed values.  
   - Person C mounts the setup on a protractor or rotates it manually.  
2. **Initial Software (30 min):**  
   - Person B codes a simple loop: `analogRead` L & R, compute and print `(L-R)/(L+R)` and angle via `atan2`.  
   - Test at 0°: adjust wires/resistors so that output ~0.  
   - Swap sensors in code if sign is wrong.  
3. **Calibration (30–45 min):**  
   - Collect data at multiple fixed angles (e.g. every 15°) under contest lamp. Use Person C to hold angles, Person B/C to record values.  
   - Derive calibration (interpolate or regression).  
   - Implement calibration in code (apply linear mapping or table).  
4. **Validation (15–30 min):**  
   - Run through angles (random or systematic) and note errors. Tune code if necessary (e.g. adjust gains).  
   - If time: test under slightly different lamp intensities or ambient light to check robustness.  
5. **Optimization (remaining time):**  
   - Add filtering if jitter found (averaging or small moving average).  
   - Ensure loop is fast (no `delay` needed beyond stability).  
   - Finalize output format (e.g., “Angle: XX°”).  
   - Document wiring (photograph/screenshot) and code (if allowed) for review.  

Crucial: set up early simple Serial prints to monitor values, and only remove them after verifying correctness. Plan to have at least one printout or display that shows the final angle result clearly for judges.

### Overlap and Communication
- All three students should cross-check: for instance, while Person A builds hardware, Person B can already test ADC reads on a spare analog pin to confirm board powering. Person C can draft the C++ structure and data logging file.  
- Avoid silos: if software is waiting, hardware person can still test sensor symmetry with a multimeter or flashlight.  
- Regularly confirm with advisors/organizers the exact output format and judging criteria if announced during the contest.  

## 09_FINAL_ROUND_PREVIEW.md 
*(Secondary Priority – basics for future final round tasks)*  
The final round involves a **CubeSat prototype with sun-tracking and imaging**. Reusable knowledge:  
- **Sun Tracking:** Use servo motors (likely small hobby servos) to orient the craft so that its sun sensor faces the light source. Arduino’s `Servo.h` library can generate 50 Hz PWM for positioning. If continuous tracking is needed, implement a simple feedback loop: e.g. if sun angle > threshold, adjust servo position incrementally (optionally with PID control, though coarse adjustments likely suffice).  
- **PID Control:** A PID loop (`pid_v = Kp*error + Ki*sumError + Kd*(error - lastError)`) can smooth motion and prevent oscillation. Use caution with integral windup.  
- **Camera Imaging:** Teams may need to trigger a camera when pointed at a target. An Arduino can control a camera shutter (via relay or digital I/O) or use a serial command if a digital camera module is present. Basic image processing is likely out of scope, but detecting a target (e.g. a bright marker) could be done with a photodiode or processed via onboard algorithm if camera images are captured (unlikely in high-school contest).  
- **FSM (Finite State Machine):** Manage modes: e.g. “Idle → Calibrating → Tracking → Imaging → Reporting”. Keep code modular to switch between tasks.  
- **Other ADCS sensors:** Final round might introduce gyros or magnetometers. Know basics: e.g. Kalman filters combine gyro and sun sensor for attitude. But in final, probably just sun sensor + motor.

These topics are more advanced; we document them briefly. Full development is for later, once final-round specifics are released. For now, focus on robust sun-sensor system. 

## 10_CODING_AGENT_CONTEXT.md
*(Brief, high-density summary for AI coding agent)*

- **Objective:** Read LDR sensors, compute sun incident angle (deg). Output angle or direction reliably.  
- **Hardware:** Arduino-compatible (likely UNO or similar); analog inputs (e.g. A0, A1 for two LDRs); common GND. Light-dependent resistors (e.g. GL5528) in voltage-dividers. Fixed resistor (unknown, likely ~10 kΩ). Baffle between LDRs to cast shadows. Lamp as light source.  
- **Electrical model:** Each LDR+fixed R forms Vout = 5V*(R_fixed/(R_fixed+R_LDR)). ADC read = round(1023*Vout/5V). Note R_LDR ≫ R_fixed in dark (Vout≈0), R_LDR≪R_fixed in bright (Vout→5V).  
- **Sensor ordering / axis:** Convention: define “left” (L) and “right” (R) sensors (or North/South etc). The difference (L–R) is positive when sun is on left side, negative on right (or vice versa depending on wiring). Clarify this once hardware known.  
- **Angle formula:** Start with normalized diff: `D = (L - R) / (L + R)`. Compute raw angle via `angle = atan2(L - R, L + R) * 180/π`. Then apply calibration mapping: e.g. linear scale or lookup such that 0→0°, ±max→±angle_range. If using lookup: e.g. array of (sensor_diff, angle) points.  
- **Calibration:** Gather (L,R) at known angles. Determine offset/gain: adjust mid-point (where L=R) to exact 0°. Fit mapping between normalized diff and angle. Store as coefficients or table.  
- **Filtering:** Use a small moving average or exponential average on raw ADC values or on `D` to reduce noise. E.g. `D_filtered = alpha*D_new + (1-alpha)*D_prev` with α≈0.1. Ensure delay/loop timing is consistent.  
- **Data types:** Use floating-point (`float` or `double`) for math. Ensure no integer division: cast to float.  
- **Serial I/O:** Likely print final angle (e.g. as integer or float). Format should match judges’ specification (unknown). Possibly simply print numeric value then newline.  
- **Timing constraints:** Code must run continuously and respond within the contest time frame (likely a few minutes to compute after orientation). Loop must not hang.  
- **Assumptions/Unknowns:**  
  - Board ADC reference (likely 5 V) and ADC resolution (likely 10-bit).  
  - Number of sensors (likely 2 for single angle measurement, but verify).  
  - Orientation: define sign (positive direction).  
  - Allowed libs: assume only standard Arduino/math.  
  - Scoring: maximize angle accuracy. Possibly time also.  
- **Common pitfalls:**  
  - Integer division: cast ADC to float.  
  - Missing calibration: leads to systematic error (see mismatch fix in).  
  - Excessive Serial prints: will slow system.  
  - Over/underflow: ensure differences computed in float.  
  - Inverting wrong axis: check sensor orientation if angle sign flips.  

This page is a quick reference. For full reasoning, see the detailed sections above. The AI should use this context to generate final code once exact parameters (pin numbers, calibration data, output format) are known.

## 11_UNKNOWNS.md
All competition-specific details not confirmed by sources (must be obtained onsite or from organizers):
- **Arduino board model** (e.g. Uno, Mega, R4, etc.) and its microcontroller specifics (clock, ADC ref).  
- **Exact sensor count and arrangement:** How many LDRs? (2 or 4) and their wiring diagram.  
- **LDR models/specs:** Are they GL5528 or another part? (Differences affect dark/light resistance ranges.)  
- **Fixed resistor values:** The value(s) used in each voltage divider.  
- **Breadboard or PCB layout:** Pin assignments (which Arduino pins connect to each LDR).  
- **Baffle dimensions & material:** Height, width, shape of light baffle.  
- **Light source specs:** Lamp type, distance to sensors, and allowed angles.  
- **Allowed libraries & tools:** Confirm if any external libraries can be used (e.g. math libs, servo libs).  
- **Software restrictions:** Are pre-written code snippets or examples allowed?  
- **Output format:** Exact serial output format expected (labelled or raw angle? units?)  
- **Scoring formula:** Weight of accuracy vs time vs presentation.  
- **Time limit:** Allowed time to code and run tests on competition day.  
- **Test protocol:** Number of test angles, hold time, any cooldown.  
- **Angle range:** Expected range of angles to measure.  
- **Refresh rate:** Are multiple readings required or just final?  
- **Communication:** Is there any messaging from judge (e.g. start/stop)? Likely manual.  

These unknowns must be clarified by careful reading of the official task statement and inspecting the provided kit at the contest start.

## 12_SOURCES.md
- *Thailand Young Satellite Challenge* – PorTCAS community site (Thailand). Title: “โจทย์การแข่งขันและกติกา… Sun Sensor System …Arduino IDE” (challenge rules). PorTCAS (student portal), 2026. **Supports:** Confirmed regional challenge task (Sun Sensor with LDR & baffle) and use of Arduino IDE. **Reliability:** Medium (third-party site but likely accurate summary of official rules). 
- *Thailand Young Satellite Challenge* – PorTCAS (Timeline). PorTCAS, 2026. **Supports:** Key dates and team counts: registration, 90 teams for regional, dates for regional and final rounds. **Reliability:** Medium.
- Agarwal, Nidhi. “Essential Guide to LDRs: Specifications and Applications.” *Electronics For You*, 16 Aug 2024. **Supports:** LDR behavior: resistance vs lux (1.8–4.5 kΩ at 10 lux, ~0.7 kΩ at 100 lux; dark resistance up to 0.25 MΩ after 5s), nonlinearity, response time (~8–12 ms light, seconds to dark). **Reliability:** High (electronics magazine).
- “Light Sensor including Photocell and LDR Sensor.” *Electronics Tutorials (various authors)*. Accessed 2026. **Supports:** Basic LDR principles: resistor divider, linearity, typical range (100 Ω in sun to >10 MΩ dark), how to wire voltage divider. **Reliability:** High (technical tutorial site).
- PedalPCB. “GL5528 LDR Photo Resistor.” *PedalPCB.com* product page. **Supports:** Typical LDR spec: GL5528 light=10–20 kΩ, dark=1 MΩ, rise 20 ms, fall 30 ms. **Reliability:** Medium (retailer quoting datasheet).
- Arduino Forum – “Sun Tracker Sensor – General Guidance.” (user Robin2 comment). 25 Sept 2016. **Supports:** Example of two-LDR baffle design: “pair of LDRs with a small piece of card providing a barrier”. **Reliability:** Community forum (low formal authority) but conceptually illustrative.
- Olin Lathrop, answer on *Electrical Engineering StackExchange* (Mar 2017). **Supports:** Differential LDR method: equal illumination at center, difference off-center; importance of calibration to handle LDR mismatch. **Reliability:** Very high (expert answer).
- Arduino Forum – “why analogRead returns 0-1023” (LarryD, Wawa). 2016–2018. **Supports:** ADC 10-bit resolution: returns 0–1023 for 0–Vcc; analogWrite uses 8-bit (0–255) because of timers. **Reliability:** Community forum but correct technical info.
- Tutorialspoint – “Arduino Math Library.” Accessed 2026. **Supports:** `atan2(y,x)` definition and range. **Reliability:** High (reference documentation).
- **All other content** (e.g. calibration methods, general embedded pitfalls) are based on standard engineering knowledge and not directly cited. These sections are **GENERAL BACKGROUND** inferences.

**Source Key:** Official Challenge details (PorTCAS); LDR behavior (Electronics For You, Electronics Tutorials); Arduino/ADC (Arduino forums); Sun sensor concept (EE.SE). Other sections synthesize this with domain expertise. 

