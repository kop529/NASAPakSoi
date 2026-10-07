/* SunSeek Platform Firmware v3.0
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
  Serial.setTxBufferSize(4096);  // TEAM NasaPakSoi team-4: core 3.3.11 default 0 -> println blocks the loop
  Serial.begin(115200);
  delay(1000);
  rwBegin();
  teamParamsBegin();   // TEAM NasaPakSoi: saved team parameters, before anything that uses them
  imuBegin();
  sunSensorBegin();
  adcsBegin();
  payloadUARTBegin();
  communicationBegin(processTelecommand);
  Serial.println("SUNSEEK PLATFORM v3.0 — Training Firmware");
  Serial.println("Spacecraft ID: "+getSpacecraftID());
  Serial.println("Payload UART: TX=GPIO41 RX=GPIO42 @115200");
  Serial.println("TEAM FIRMWARE: " TEAM_FW_VERSION);  // TEAM NasaPakSoi
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
  teamMissionUpdate();  // TEAM NasaPakSoi team-6: mission 2
  teamTelemetryUpdate();  // TEAM NasaPakSoi: TM,TEAM_T over USB when team.tm > 0
  if(rwTakeManeuverCompleteEvent()){
    sendTelemetry("EVT,RW_MANEUVER_COMPLETE,"+String(rwGetTarget()));
    ttcSendRWTelemetry();
  }
  if(rwTakeBiasRecoveredEvent()){
    sendTelemetry("EVT,MOM_BIAS_RECOVERED,"+String(rwGetNominalBias()));
    ttcSendRWTelemetry();
  }
}
