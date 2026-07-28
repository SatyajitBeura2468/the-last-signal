const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function updateResourceModel(resources, context, deltaSeconds) {
  const slewing = context.slewProgress < 0.98;
  const observing = context.missionStage === 'OBSERVING' || context.missionStage === 'LOCKED';
  const decoding = context.missionStage === 'DECODING';
  const powerDrain = (slewing ? 0.024 : 0.006) + (observing ? 0.008 : 0) + (decoding ? 0.012 : 0);
  const powerRecovery = context.solarCharging ? 0.01 : 0.003;
  resources.mainPower = clamp(resources.mainPower + (powerRecovery - powerDrain) * deltaSeconds, 58, 100);

  const cryoDrain = observing ? 0.012 + Math.max(0, context.thermalContribution - 1) * 0.003 : -0.006;
  resources.cryogenicReserve = clamp(resources.cryogenicReserve - cryoDrain * deltaSeconds, 5, 100);
  const thermalTarget = 18
    + (100 - resources.cryogenicReserve) * 0.28
    + (slewing ? 4 : 0)
    + (decoding ? 6 : 0);
  resources.thermalLoad += (thermalTarget - resources.thermalLoad) * deltaSeconds * 0.08;

  const bufferTarget = observing ? 92 : decoding ? 74 : 38;
  resources.dataBuffer += (bufferTarget - resources.dataBuffer) * deltaSeconds * (observing ? 0.025 : 0.04);
  const processingTarget = decoding ? 86 : observing ? 57 : 24;
  resources.processingLoad += (processingTarget - resources.processingLoad) * deltaSeconds * 0.12;
  resources.reservePower = clamp(resources.reservePower + (resources.mainPower < 70 ? -0.01 : 0.002) * deltaSeconds, 10, 100);
  return resources;
}
