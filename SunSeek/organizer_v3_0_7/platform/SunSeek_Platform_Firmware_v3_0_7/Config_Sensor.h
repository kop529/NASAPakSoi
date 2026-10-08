#pragma once
#include <Arduino.h>

/*
  Config_Sensor.h — SunSeek Platform v2.0
  TRAINING LEVEL: BASIC / INTERMEDIATE

  Learner-adjustable sensor wiring, calibration, axis/sign conventions,
  telemetry period, and the verified Sun Sensor calibration model.
*/


/*
  Config_Sensor.h — T03 spacecraft-specific IMU configuration

  WORKSHOP FLOW
    Upload #1 : leave calibration values at defaults and characterize sensors.
    Edit once : enter the team's verified characterization results below.
    Upload #2 : verify calibrated telemetry.

  Training baseline GY-89:
    LSM303D  @ 0x1D, WHO_AM_I 0x49  (accelerometer + magnetometer)
    L3GD20   @ 0x6B, WHO_AM_I 0xD4  (gyroscope)
    BMP180   @ 0x77                  (presence check only in T03)

  Alternate personal/engineering module retained for future use:
    L3G4200D @ 0x69, WHO_AM_I 0xD3
*/

#define IMU_GY89_STANDARD       1
#define IMU_GY89_L3G4200D       2
#define IMU_VARIANT IMU_GY89_STANDARD

#define IMU_I2C_SDA 8
#define IMU_I2C_SCL 9
#define IMU_I2C_CLOCK_HZ 100000UL

#define IMU_AXIS_X 0
#define IMU_AXIS_Y 1
#define IMU_AXIS_Z 2

// ---------- Gyroscope calibration: fill from GYRO_OFFSET result ----------
#define GYRO_BIAS_X_DPS 0.0f
#define GYRO_BIAS_Y_DPS 0.0f
#define GYRO_BIAS_Z_DPS 0.0f

// Baseline mechanical observation; verify sign convention during T03.
#define IMU_BODY_RATE_AXIS IMU_AXIS_Z
#define IMU_BODY_RATE_SIGN 1.0f

// ---------- Magnetometer calibration: fill from MAG_CAL_START/STOP -------
// Hard-iron offsets in raw counts.
#define MAG_OFFSET_X 0.0f
#define MAG_OFFSET_Y 0.0f
#define MAG_OFFSET_Z 0.0f

// Relative scale correction. Leave 1.0 until characterized.
#define MAG_SCALE_X 1.0f
#define MAG_SCALE_Y 1.0f
#define MAG_SCALE_Z 1.0f

// Heading convention is intentionally simple for T03 characterization.
// Verify spacecraft axis/sign before using heading as an ADCS reference.
#define MAG_HEADING_SIGN 1.0f
#define MAG_HEADING_OFFSET_DEG 0.0f

#define SENSOR_STREAM_PERIOD_MS 250UL


// -----------------------------------------------------------------------------
// SUN SENSOR CONFIGURATION
// -----------------------------------------------------------------------------
#define SUN_LEFT_PIN 17
#define SUN_RIGHT_PIN 16
#define SUN_STREAM_PERIOD_MS 250UL

/* TEAM AREA — replace only this estimator if desired.
   Input NDV=(L-R)/(L+R), output Sun angle [deg].
   Linear / polynomial / piecewise / lookup+interpolation are all allowed. */
inline float estimateSunAngle(float ndv) {
  return 90.0f * ndv; // simple default; replace with team's verified T03 model
}
