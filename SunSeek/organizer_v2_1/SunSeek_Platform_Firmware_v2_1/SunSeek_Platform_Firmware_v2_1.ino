/* SunSeek Platform Firmware v2.1
   Reorganized training architecture: Config / Module / System.
   Runtime baseline: T07 FIX6 Estimator Continuous + MA500. */
#include "Module_ReactionWheel.h"
#include "System_TTC.h"
#include "Module_IMU.h"
#include "Module_SunSensor.h"
#include "Module_Estimator.h"
#include "System_TelemetryManager.h"
#include "Module_Mission.h"
#include "Module_ADCS.h"
#include "System_Telemetry.h"
#include "Module_Payload.h"
#include "System_CommandRouter.h"

void setup(){
  Serial.begin(115200);
  delay(1000);
  rwBegin();
  imuBegin();
  sunSensorBegin();
  adcsBegin();
  payloadUARTBegin();
  communicationBegin(processTelecommand);
  Serial.println("SUNSEEK PLATFORM v2.1 — Training Firmware");
  Serial.println("Spacecraft ID: "+getSpacecraftID());
  Serial.println("Payload UART: TX=GPIO41 RX=GPIO42 @115200");
  sensorSendHealth();
  ttcSendADCSConfig();
  payloadSendCommand("STATUS");
}

void loop(){
  communicationUpdate();
  payloadUARTUpdate();
  rwUpdate();
  adcsUpdate();
  sensorUpdate();
  sensorADCSUpdate();
  sensorTelemetryUpdate();
  missionUpdate();
  if(rwTakeManeuverCompleteEvent()){
    sendTelemetry("EVT,RW_MANEUVER_COMPLETE,"+String(rwGetCurrentBias()));
    ttcSendRWTelemetry();
  }
}
