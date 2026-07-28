import { CONFIG } from '../modules/config.js';
import { ARRAY_NODES } from '../modules/observatory-data.js';
import { createDishState } from '../simulation/array-model.js';
import { UNIFIED_SIGNAL_CATALOG } from '../simulation/signal-model.js';
import { createEventBus } from './event-bus.js';
import { describePersistenceMode, loadPersistedState, savePersistedState } from './persistence.js';
import { createSimulationClock } from './simulation-clock.js';

function sessionId() {
  const key = CONFIG.sessionKey;
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const id = `TLS-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  sessionStorage.setItem(key, id);
  return id;
}

function seedFromSession(id) {
  let seed = 2166136261;
  for (const character of id) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function initialLogs(saved) {
  return saved?.logs?.length ? saved.logs : [
    { time: '03:12:09', frequency: '1.582 GHz', status: 'WEAK' },
    { time: '03:03:21', frequency: '7.123 GHz', status: 'NOISE' },
    { time: '03:01:11', frequency: '3.521 GHz', status: 'WEAK' },
  ];
}

function createInitialState() {
  const saved = loadPersistedState();
  const id = sessionId();
  const target = UNIFIED_SIGNAL_CATALOG[0];
  const savedObservatory = saved?.observatory;
  const settings = {
    audio: true,
    reducedMotion: false,
    sensitivity: 1,
    renderQuality: 'AUTO',
    ...(saved?.settings ?? {}),
  };
  const eventLog = [
    {
      time: new Date().toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' }),
      severity: 'nominal',
      title: 'OBSERVATION CYCLE 07',
      message: 'Array 7 entered deterministic deep-field listening mode.',
    },
  ];

  return {
    version: 2,
    sessionId: id,
    sessionToken: saved?.sessionToken ?? '',
    sessionMode: describePersistenceMode(),
    seed: seedFromSession(id),
    startTime: Date.now(),
    frequencyMHz: saved?.frequencyMHz ?? CONFIG.initialFrequencyMHz,
    signals: [],
    telemetry: {
      proximity: 0,
      strength: -112,
      quality: 4,
      stability: 8,
      signal: null,
      distance: 1,
      interference: 0,
      noiseFloor: -106,
      bandwidth: 0.5,
      coherence: 0,
      lockable: false,
    },
    mode: 'scan',
    scanning: true,
    lockedSignal: null,
    decoding: false,
    decodeProgress: 0,
    decodedFragments: [],
    logs: initialLogs(saved),
    unlockedSignalIds: new Set(saved?.unlockedSignalIds ?? []),
    settings,
    pointerTuning: false,
    lastFrame: performance.now(),
    buffer: 42,
    radio: null,
    lastScanToast: 0,
    lockLostNotified: false,
    lastRenderedEventNumber: 0,
    activeOverlayView: null,
    selectedSignalId: null,
    selectedMapSignalId: null,
    logFilter: 'all',
    selectedLogIndex: 0,
    lastOverlayRefresh: 0,
    overlayCloseTimer: null,
    nextAtmosphereUpdate: 0,
    operations: {
      currentEvent: { severity: 'nominal', title: 'ARRAY NOMINAL', message: 'Listening window clear. Deep field telemetry is stable.' },
      eventNumber: 0,
      alignment: 87.4,
      power: 98.1,
      temperature: -195.2,
      boost: 22.7,
      clockDrift: 0.04,
      lastEmittedEvent: null,
    },
    observatory: {
      version: 2,
      cycle: 7,
      clock: createSimulationClock(),
      station: {
        name: 'Deep Space Array 7',
        fictional: true,
        coordinates: {
          latitudeDeg: 19.145,
          longitudeDeg: 82.257,
          elevationM: 1360,
          label: 'Fictional simulation coordinates',
        },
      },
      activeTarget: { ...target },
      astronomy: {
        lstHours: 0,
        hourAngleDeg: 0,
        altitudeDeg: 0,
        azimuthDeg: 0,
        airMass: Infinity,
        visible: false,
        sunAltitudeDeg: 0,
        windowLabel: 'CALCULATING',
      },
      selectedWorld: savedObservatory?.selectedWorld ?? 'live-ops',
      selectedDish: savedObservatory?.selectedDish || 'DISH-01',
      selectedCandidate: savedObservatory?.selectedCandidate || target.id,
      selectedSector: savedObservatory?.selectedSector || 'aquila',
      commandSequence: 0,
      commands: [],
      eventLog,
      array: {
        integrity: 96.4,
        phaseError: 0.82,
        clockOffsetNs: 7.4,
        alignment: 87.4,
        coherence: 0.72,
        slewProgress: 0.87,
        availableDishes: 6,
        windSpeedKph: 14,
        baseline: savedObservatory?.baseline ?? 'LONG',
        elapsedSeconds: 0,
        actions: [],
        dishes: ARRAY_NODES.map(createDishState),
      },
      receiver: {
        gain: 22.7,
        noiseFloor: -106,
        bandwidth: 0.5,
        frequencyMHz: saved?.frequencyMHz ?? CONFIG.initialFrequencyMHz,
        thermalContribution: 1.5,
        rfiContribution: 1.2,
        atmosphericContribution: 1.1,
        clockContribution: 0.4,
        signalContribution: 0,
        snr: -4,
        coherence: 0.2,
        lockState: 'SEARCHING',
      },
      resources: {
        mainPower: 98.1,
        reservePower: 31,
        cryogenicReserve: 74,
        thermalLoad: 21,
        dataBuffer: 42,
        processingLoad: 18,
      },
      environment: {
        solarWindSpeed: 388,
        protonDensity: 4.2,
        imfMagnitude: 5.7,
        bz: -1.4,
        kpIndex: 2,
        rfiLevel: 0.08,
        spaceWeatherPenalty: 0.2,
      },
      sources: {
        spaceWeather: {
          source: 'NOAA SWPC',
          fetchedAt: null,
          sourceTimestamp: null,
          status: 'SIMULATED',
          staleAfter: 900000,
          value: null,
          fallbackReason: 'Waiting for server-side source adapter',
        },
        astronomy: {
          source: 'Local IAU-style calculation',
          fetchedAt: new Date().toISOString(),
          sourceTimestamp: new Date().toISOString(),
          status: 'CALCULATED',
          staleAfter: 1000,
          value: null,
          fallbackReason: null,
        },
      },
      mission: {
        stage: 'IDLE',
        integrationSeconds: 0,
        requiredIntegrationSeconds: 8,
        sampleCount: 0,
        candidateId: null,
        correctionsApplied: 0,
        correlation: 21,
        revisitScheduled: false,
        revisitConfirmed: false,
        evidenceCommitted: false,
      },
      incidents: {
        active: null,
        history: [],
        cooldownSeconds: 18,
      },
      lab: {
        filters: { rfi: false, doppler: false, phase: false, fold: false },
        correlation: 21,
        confidenceBonus: 0,
        committed: [],
      },
      navigation: {
        scheduled: savedObservatory?.scheduled ?? [],
        baseline: savedObservatory?.baseline ?? 'LONG',
      },
      vault: {
        notes: savedObservatory?.notebook ?? '',
        sealed: savedObservatory?.sealed ?? false,
        entries: savedObservatory?.evidence ?? [],
      },
      render: {
        quality: 'HIGH',
        averageFrameMs: 0,
        hidden: document.hidden,
      },
    },
  };
}

const bus = createEventBus();
const state = createInitialState();

export const observatoryStore = {
  state,
  bus,
  persist() {
    const result = savePersistedState(state);
    bus.emit('persisted', result);
    return result;
  },
  patchSpaceWeather(payload) {
    const entry = payload?.registry;
    if (!entry || typeof entry !== 'object') return;
    state.observatory.sources.spaceWeather = entry;
    if (entry.value) {
      const environment = state.observatory.environment;
      environment.solarWindSpeed = Number(entry.value.solarWindSpeed) || environment.solarWindSpeed;
      environment.protonDensity = Number(entry.value.protonDensity) || environment.protonDensity;
      environment.imfMagnitude = Number(entry.value.imfMagnitude) || environment.imfMagnitude;
      environment.bz = Number(entry.value.bz) || environment.bz;
      environment.kpIndex = Number(entry.value.kpIndex) || environment.kpIndex;
    }
    bus.emit('source:space-weather', entry);
  },
};

export function getObservatoryState() {
  return state;
}
