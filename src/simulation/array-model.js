const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const shortestAngle = (from, to) => ((to - from + 540) % 360) - 180;

export const BASELINE_PROFILES = {
  COMPACT: { sensitivity: 1.16, resolution: 0.72, coherenceTolerance: 0.12, integrationMultiplier: 0.78 },
  LONG: { sensitivity: 0.92, resolution: 1.35, coherenceTolerance: 0.055, integrationMultiplier: 1.15 },
  POLAR: { sensitivity: 1.02, resolution: 1.08, coherenceTolerance: 0.075, integrationMultiplier: 1 },
};

export function createDishState(node, index) {
  return {
    id: node.id,
    name: node.name,
    currentAzimuth: node.bearing,
    currentElevation: node.elevation,
    targetAzimuth: node.bearing,
    targetElevation: node.elevation,
    slewVelocity: 0,
    servoHealth: node.health,
    phaseOffset: (index - 2.5) * 0.19,
    clockOffset: (index - 2.5) * 1.7,
    windLoad: 10 + index * 1.4,
    availability: 'AVAILABLE',
    role: node.role,
    excluded: false,
  };
}

export function updateArrayModel(array, targetSolution, resources, deltaSeconds) {
  const profile = BASELINE_PROFILES[array.baseline] ?? BASELINE_PROFILES.LONG;
  let totalError = 0;
  let available = 0;
  for (const dish of array.dishes) {
    if (dish.excluded || dish.availability !== 'AVAILABLE') continue;
    available += 1;
    dish.targetAzimuth = targetSolution.azimuthDeg;
    dish.targetElevation = clamp(targetSolution.altitudeDeg, 8, 88);
    const azError = shortestAngle(dish.currentAzimuth, dish.targetAzimuth);
    const elevationError = dish.targetElevation - dish.currentElevation;
    const maxSlew = (0.72 + dish.servoHealth / 180) * Math.max(0.45, resources.mainPower / 100);
    const azStep = clamp(azError, -maxSlew * deltaSeconds, maxSlew * deltaSeconds);
    const elevationStep = clamp(elevationError, -maxSlew * 0.72 * deltaSeconds, maxSlew * 0.72 * deltaSeconds);
    dish.currentAzimuth = (dish.currentAzimuth + azStep + 360) % 360;
    dish.currentElevation = clamp(dish.currentElevation + elevationStep, 5, 89);
    dish.slewVelocity = Math.hypot(azStep, elevationStep) / Math.max(deltaSeconds, 0.001);
    dish.windLoad += (clamp(8 + dish.currentElevation * 0.12 + array.windSpeedKph * 0.42, 5, 78) - dish.windLoad) * deltaSeconds * 0.18;
    dish.clockOffset += (-dish.clockOffset * 0.08 + Math.sin(array.elapsedSeconds * 0.13 + dish.currentAzimuth) * 0.03) * deltaSeconds;
    dish.phaseOffset += (-dish.phaseOffset * 0.11 + dish.clockOffset * 0.003) * deltaSeconds;
    totalError += Math.hypot(azError, elevationError);
  }
  array.availableDishes = available;
  array.slewProgress = clamp(1 - totalError / Math.max(1, available * 120), 0, 1);
  array.alignment = clamp(array.slewProgress * 100 - array.windSpeedKph * 0.06, 0, 99.8);
  array.phaseError = clamp(
    array.dishes.reduce((sum, dish) => sum + Math.abs(dish.phaseOffset), 0) / Math.max(1, available),
    0.08,
    8,
  );
  array.coherence = clamp(1 - array.phaseError * profile.coherenceTolerance - (6 - available) * 0.08, 0, 1);
  return array;
}
