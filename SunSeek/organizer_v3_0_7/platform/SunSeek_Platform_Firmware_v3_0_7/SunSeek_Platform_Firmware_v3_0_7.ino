/* SunSeek Platform Firmware v3.0
   Reorganized training architecture: Config / Module / System.
   Runtime baseline: T07 FIX6 Estimator Continuous + MA500. */
#include "Module_ReactionWheel.h"
#include "Module_ManualSequence.h"
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
  Serial.println("SUNSEEK PLATFORM v3.0.7 — Training Firmware");
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
  manualSequenceUpdate();
  adcsUpdate();
  sensorUpdate();
  sensorADCSUpdate();
  sensorTelemetryUpdate();
  static MissionState _prevMissionState=MISSION_IDLE;
  missionUpdate();
  MissionState _ms=missionGet().state;
  if(_ms!=_prevMissionState){
    if(_ms==MISSION_READY) sendTelemetry("EVT,MISSION_READY");
    else if(_ms==MISSION_COMPLETE) sendTelemetry("EVT,MISSION_COMPLETE");
    else if(_ms==MISSION_ABORTED) sendTelemetry("EVT,MISSION_ABORTED");
    else if(_ms==MISSION_FAILED) sendTelemetry("EVT,MISSION_FAILED");
    _prevMissionState=_ms;
  }
  if(manualSequenceTakeStepEvent()) sendTelemetry("EVT,MAN_SEQ_STEP,"+String(manualSequenceIndex()+1));
  if(manualSequenceTakeDoneEvent()) sendTelemetry("EVT,MAN_SEQ_COMPLETE");
  if(rwTakeManeuverCompleteEvent()){
    sendTelemetry("EVT,RW_MANEUVER_COMPLETE,"+String(rwGetTarget()));
    ttcSendRWTelemetry();
  }
  if(rwTakeBiasRecoveredEvent()){
    sendTelemetry("EVT,MOM_BIAS_RECOVERED,"+String(rwGetNominalBias()));
    ttcSendRWTelemetry();
  }
}
