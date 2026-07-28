const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function updateReceiverModel(receiver, context, deltaSeconds) {
  const altitudePenalty = context.targetAltitude > 0 ? Math.max(0, 28 - context.targetAltitude) * 0.13 : 8;
  const thermal = 1.5 + Math.max(0, context.thermalLoad - 22) * 0.075;
  const rfi = 1.2 + context.rfiLevel * 12;
  const atmospheric = 1.1 + altitudePenalty + context.spaceWeatherPenalty;
  const clock = Math.abs(context.clockOffsetNs) * 0.08;
  const signal = context.signalContribution * context.arrayCoherence * context.slewProgress;
  const noiseFloorTarget = -111 + thermal + rfi + atmospheric + clock;
  receiver.noiseFloor += (noiseFloorTarget - receiver.noiseFloor) * deltaSeconds * 0.35;
  receiver.thermalContribution = thermal;
  receiver.rfiContribution = rfi;
  receiver.atmosphericContribution = atmospheric;
  receiver.clockContribution = clock;
  receiver.signalContribution = signal;
  receiver.snr = clamp(signal - (receiver.noiseFloor + 111), -12, 45);
  receiver.coherence += (clamp(context.arrayCoherence - context.rfiLevel * 0.12, 0, 1) - receiver.coherence) * deltaSeconds * 0.45;
  receiver.lockState = receiver.coherence > 0.58 && receiver.snr > 5 && context.slewProgress > 0.94 ? 'LOCKABLE' : 'SEARCHING';
  return receiver;
}
