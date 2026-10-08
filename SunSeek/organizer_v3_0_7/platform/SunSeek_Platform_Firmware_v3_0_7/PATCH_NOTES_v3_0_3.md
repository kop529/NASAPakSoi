# SunSeek Platform Firmware v3.0.3

- Aligns terminology with Ground Station v1.10.9 profile architecture.
- ADCS Profile is a Ground Station configuration package; firmware does not require a DRAFT/VERIFIED state.
- AUTO + REACTION continues to use PD directly.
- AUTO + MOMENTUM continues to interpret PD output as control demand and uses the loaded characterized Momentum Profile (Bias, CW/CCW Assist, Recovery, Trigger, Bias Spin-up).
- Mission PREPARE uses the Momentum Profile Bias Spin-up timer; BODY_RATE remains an indication, not a hard readiness gate.
- Protocol remains compatible with v3.0.2, including MOM_PROFILE_SPINUP,<ms>.
