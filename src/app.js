import { CONFIG } from './modules/config.js';
import { getSessionId, loadState, saveState } from './modules/store.js';
import { fetchSignalCatalog, requestDecode, syncSession } from './modules/api-client.js';
import {
  createRadioState,
  findNearestSignal,
  formatFrequency,
  frequencyFromRatio,
  getSignalFrequency,
  logFrequency,
  sampleTelemetry,
} from './modules/signal-engine.js';
import { AudioEngine } from './modules/audio-engine.js';
import { createStarfield } from './modules/starfield.js?v=orbital-observatory-1';
import { SpectrumRenderer } from './modules/spectrum-renderer.js';
import { createOperationsState, getOperationsLog, updateOperations } from './modules/operations.js';
import { dashboardView, logbookView, settingsView, starmapView, transmissionsView } from './modules/overlay-views.js?v=receiver-workspaces-3';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const saved = loadState();
const state = {
  sessionId: getSessionId(),
  startTime: Date.now(),
  frequencyMHz: saved?.frequencyMHz ?? CONFIG.initialFrequencyMHz,
  signals: [],
  telemetry: { proximity: 0, strength: -112, quality: 4, stability: 8, signal: null, distance: 1 },
  mode: 'scan',
  scanning: true,
  lockedSignal: null,
  decoding: false,
  decodeProgress: 0,
  decodedFragments: [],
  logs: saved?.logs ?? [
    { time: '03:12:09', frequency: '1.582 GHz', status: 'WEAK' },
    { time: '03:03:21', frequency: '7.123 GHz', status: 'NOISE' },
    { time: '03:01:11', frequency: '3.521 GHz', status: 'WEAK' },
    { time: '02:28:54', frequency: '9.833 GHz', status: 'NOISE' },
    { time: '02:15:27', frequency: '2.113 GHz', status: 'WEAK' },
  ],
  unlockedSignalIds: new Set(saved?.unlockedSignalIds ?? []),
  settings: { audio: true, reducedMotion: false, sensitivity: 1, ...(saved?.settings ?? {}) },
  pointerTuning: false,
  lastFrame: performance.now(),
  buffer: 87,
  radio: createRadioState(),
  lastScanToast: 0,
  lockLostNotified: false,
  operations: createOperationsState(),
  lastRenderedEventNumber: 0,
  activeOverlayView: null,
  selectedSignalId: null,
  selectedMapSignalId: null,
  logFilter: 'all',
  selectedLogIndex: 0,
  lastOverlayRefresh: 0,
  overlayCloseTimer: null,
  nextAtmosphereUpdate: 0,
};

const audio = new AudioEngine();
const renderer = new SpectrumRenderer({
  frequencyCanvas: $('#frequency-canvas'),
  waterfallCanvas: $('#waterfall-canvas'),
  stabilityCanvas: $('#stability-canvas'),
  targetCanvas: $('#target-canvas'),
  noiseCanvas: $('#noise-canvas'),
  alertCanvas: $('#alert-wave'),
});

createStarfield($('#starfield'));

function toast(message, tone = 'info') {
  const region = $('#toast-region');
  const duplicate = [...region.children].find((child) => child.textContent === message);
  if (duplicate) {
    duplicate.classList.remove('show');
    requestAnimationFrame(() => duplicate.classList.add('show'));
    return;
  }
  const node = document.createElement('div');
  node.className = `toast ${tone}`;
  node.textContent = message;
  region.append(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 300);
  }, 3000);
}

function setMode(mode) {
  state.mode = mode;
  state.scanning = mode === 'scan';
  $$('.mode-button').forEach((button) => button.classList.toggle('active', button.id === `${mode}-button`));
  $('#mode-value').textContent = mode === 'scan' ? 'NARROWBAND' : mode.toUpperCase();
  $('#hopping-mode').textContent = state.scanning ? 'AUTO' : 'MANUAL';
  ['scan', 'tune', 'lock', 'decode'].forEach((name) => {
    $(`#${name}-button`).setAttribute('aria-pressed', String(mode === name));
  });
}

function updateFrequency(next) {
  state.frequencyMHz = clamp(next, CONFIG.minFrequencyMHz, CONFIG.maxFrequencyMHz);
  const ratio = logFrequency(state.frequencyMHz);
  $('#tuner-marker').style.left = `${ratio * 100}%`;
  $('#frequency-track').setAttribute('aria-valuenow', state.frequencyMHz.toFixed(6));
  const units = state.frequencyMHz >= 1000 ? 'GHz' : 'MHz';
  $('#frequency-readout').innerHTML = `${formatFrequency(state.frequencyMHz)} <small>${units}</small>`;
}

function createMiniWave() {
  const spans = Array.from({ length: 22 }, (_, index) => {
    const height = 3 + Math.abs(Math.sin(index * 1.83 + Math.random())) * 9;
    return `<i style="height:${height.toFixed(1)}px"></i>`;
  }).join('');
  return `<span class="mini-wave">${spans}</span>`;
}

function renderLogs() {
  $('#detection-log').innerHTML = state.logs.slice(0, 6).map((entry) => `
    <article>
      <div><time>${entry.time}</time><strong>${entry.frequency}</strong>${entry.message ? `<small>${entry.message}</small>` : ''}</div>
      <div><b class="${entry.status.toLowerCase()}">${entry.status}</b>${createMiniWave()}</div>
    </article>`).join('');
}

function addLog(signal, status = 'LOCKED') {
  const frequencyMHz = Number.isFinite(signal?.frequencyMHz) ? signal.frequencyMHz : state.frequencyMHz;
  state.logs.unshift({
    time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
    frequency: `${(frequencyMHz / 1000).toFixed(3)} GHz`,
    status,
    id: signal?.id,
  });
  state.logs = state.logs.slice(0, CONFIG.maxLogs);
  renderLogs();
  saveState(state);
}

function renderOperations(event = state.operations.currentEvent) {
  const alert = $('#system-alert');
  const icon = alert.querySelector('svg');
  alert.dataset.severity = event.severity;
  $('#system-alert-title').textContent = event.title;
  $('#system-alert-message').textContent = event.message;
  alert.setAttribute('aria-label', `${event.title}: ${event.message}`);
  icon.setAttribute('aria-label', event.severity === 'critical' ? 'Critical alert' : 'Operational update');
  $('#station-state').textContent = state.telemetry.interference > 0.72 ? 'DEGRADED' : event.severity === 'critical' ? 'CAUTION' : 'ONLINE';
  $('#listening-copy').textContent = event.severity === 'signal' ? 'CARRIER IN LISTENING WINDOW' : event.severity === 'critical' ? 'PROTECTING RECEIVER' : 'LISTENING TO THE UNIVERSE';
}

function addOperationalLog(event) {
  state.logs.unshift(getOperationsLog(event));
  state.logs = state.logs.slice(0, CONFIG.maxLogs);
  renderLogs();
  saveState(state);
  if (state.activeOverlayView === 'logbook' && !$('#overlay').hidden) renderActiveView();
}

function renderTransmission(signal = null) {
  if (!signal) {
    $('#transmission-title').textContent = 'TRANSMISSION SEARCH';
    $('#signal-badge').textContent = 'LISTENING';
    $('#signal-id').textContent = 'TLS-UNRESOLVED';
    $('#received-time').textContent = '--';
    $('#signal-coordinates').textContent = 'RA --   DEC --';
    $('#signal-distance').textContent = '-- light years';
    return;
  }
  $('#transmission-title').textContent = 'TRANSMISSION DETECTED';
  $('#signal-badge').textContent = signal.className;
  $('#signal-id').textContent = signal.id;
  $('#received-time').textContent = `${new Date().toISOString().replace('T', '  ').slice(0, 19)} UTC`;
  $('#signal-coordinates').textContent = `RA ${signal.ra}   DEC ${signal.dec}`;
  $('#signal-distance').textContent = `${Number(signal.distance).toLocaleString()} light years`;
}

function renderDecode() {
  $('#decode-progress-bar').style.width = `${state.decodeProgress}%`;
  $('#decode-progress-value').textContent = `${Math.round(state.decodeProgress)}%`;
  if (state.decodedFragments.length) $('#decoded-text').textContent = state.decodedFragments.join('\n');
}

function lockSignal() {
  const { signal, distance } = findNearestSignal(state.frequencyMHz, state.signals);
  const tolerance = CONFIG.lockToleranceRatio * state.settings.sensitivity;
  const candidate = state.telemetry.signal?.id === signal?.id ? signal : null;
  if (!candidate || distance > tolerance || !state.telemetry.lockable) {
    state.lockedSignal = null;
    $('#lock-caption').textContent = 'SIGNAL LOST';
    $('#lock-caption').className = 'lost';
    toast('No coherent carrier inside lock window. Tune until the carrier settles.', 'warning');
    addLog({ frequencyMHz: state.frequencyMHz }, 'NOISE');
    return;
  }
  state.lockedSignal = candidate;
  state.lockLostNotified = false;
  state.scanning = false;
  updateFrequency(getSignalFrequency(candidate, performance.now()));
  setMode('lock');
  $('#lock-caption').textContent = 'LOCKED SIGNAL';
  $('#lock-caption').className = 'locked';
  renderTransmission(candidate);
  state.decodeProgress = state.unlockedSignalIds.has(candidate.id) ? 100 : 0;
  state.decodedFragments = state.decodeProgress === 100 ? candidate.fragments : [];
  renderDecode();
  addLog(candidate, 'LOCKED');
  audio.pulse('lock');
  toast(`Carrier lock established: ${candidate.id}`, 'success');
}

function stopDecode(message = 'Decode paused. Carrier remains locked.') {
  if (!state.decoding) return;
  state.decoding = false;
  toast(message, 'info');
}

async function decodeSignal() {
  if (!state.lockedSignal) {
    toast('Lock a coherent transmission before decoding.', 'warning');
    return;
  }
  if (state.decoding) {
    stopDecode();
    setMode('lock');
    return;
  }
  if (state.decodeProgress >= 100) {
    toast('Transmission already fully decoded.', 'info');
    return;
  }
  state.decoding = true;
  setMode('decode');
  audio.pulse('decode');
  const run = async () => {
    if (!state.decoding || !state.lockedSignal) return;
    const qualityFactor = clamp(state.telemetry.quality / 100, 0.35, 1);
    state.decodeProgress = Math.min(100, state.decodeProgress + (5 + Math.random() * 5) * qualityFactor);
    const payload = await requestDecode(state.lockedSignal, state.decodeProgress, state.sessionId);
    if (payload.fragment && !state.decodedFragments.includes(payload.fragment)) state.decodedFragments.push(payload.fragment);
    renderDecode();
    if (state.decodeProgress >= 100 || payload.completed) {
      state.decodeProgress = 100;
      state.decoding = false;
      state.unlockedSignalIds.add(state.lockedSignal.id);
      renderDecode();
      saveState(state);
      syncSession({ sessionId: state.sessionId, unlockedSignalIds: [...state.unlockedSignalIds], logs: state.logs.slice(0, 8) });
      toast('Decode complete. Archive fragment restored.', 'success');
      return;
    }
    setTimeout(run, CONFIG.decodeTickMs);
  };
  run();
}

function refreshActiveOverlay(time) {
  if ($('#overlay').hidden || time - state.lastOverlayRefresh < 240) return;
  state.lastOverlayRefresh = time;
  if (state.activeOverlayView === 'dashboard') {
    const event = state.operations.currentEvent;
    const signal = state.lockedSignal ?? (state.telemetry.lockable ? state.telemetry.signal : null);
    const assignments = {
      '#dash-event-title': event.title,
      '#dash-event-message': event.message,
      '#dash-live-clock': `${new Date().toLocaleTimeString('en-GB', { hour12: false })} UTC`,
      '#dash-array-state': state.mode.toUpperCase(),
      '#dash-activity': signal ? `${signal.id} / ${signal.className}` : 'DEEP FIELD SWEEP',
      '#dash-strength': `${state.telemetry.strength.toFixed(1)} dBm`,
      '#dash-quality': `${state.telemetry.quality}%`,
      '#dash-stability': `${state.telemetry.stability}%`,
      '#dash-noise': `${state.telemetry.noiseFloor?.toFixed(0) ?? '−106'} dBm`,
      '#dash-alignment': `${state.operations.alignment.toFixed(1)}%`,
      '#dash-frequency': state.frequencyMHz >= 1000 ? `${(state.frequencyMHz / 1000).toFixed(6)} GHz` : `${state.frequencyMHz.toFixed(6)} MHz`,
      '#dash-event-number': String(state.operations.eventNumber).padStart(3, '0'),
    };
    Object.entries(assignments).forEach(([selector, value]) => {
      const node = $(selector);
      if (node) node.textContent = value;
    });
    $('.command-brief')?.setAttribute('data-severity', event.severity);
    $('#dash-confidence')?.style.setProperty('width', `${state.telemetry.quality}%`);
  } else if (state.activeOverlayView === 'starmap') {
    const clock = $('#map-solution-clock');
    if (clock) clock.textContent = `${new Date().toLocaleTimeString('en-GB', { hour12: false })} UTC`;
  }
}

function refreshAtmosphere(time) {
  if (time < state.nextAtmosphereUpdate) return;
  const quality = clamp(state.telemetry.quality / 100, 0, 1);
  const stability = clamp(state.telemetry.stability / 100, 0, 1);
  const energy = clamp(.12 + quality * .48 + stability * .18 + Math.random() * .12, .1, .86);
  const root = document.documentElement;
  root.style.setProperty('--sky-energy', energy.toFixed(3));
  root.style.setProperty('--signal-bearing', `${(logFrequency(state.frequencyMHz) * 320 - 160).toFixed(2)}deg`);
  document.body.dataset.receiverActivity = state.decoding
    ? 'decoding'
    : state.lockedSignal
      ? 'locked'
      : state.telemetry.lockable
        ? 'carrier'
        : state.scanning
          ? 'scanning'
          : 'listening';
  state.nextAtmosphereUpdate = time + 620 + Math.random() * 1280;
}

function updateTelemetry(time) {
  state.telemetry = sampleTelemetry(state.frequencyMHz, state.signals, time, state.radio, {
    bandwidth: CONFIG.lockToleranceRatio * state.settings.sensitivity,
  });
  const previousEventNumber = state.operations.eventNumber;
  updateOperations(state.operations, time, state.telemetry, state.mode);
  if (state.operations.eventNumber !== previousEventNumber && state.operations.lastEmittedEvent) {
    const event = state.operations.lastEmittedEvent;
    state.lastRenderedEventNumber = event.eventNumber;
    renderOperations(event);
    addOperationalLog(event);
    if (event.severity === 'signal' || event.severity === 'critical') toast(event.message, event.severity === 'critical' ? 'warning' : 'success');
  }
  const { strength, quality, stability, proximity } = state.telemetry;
  const detectedSignal = state.telemetry.signal;

  if (state.scanning && state.telemetry.lockable && detectedSignal) {
    if (state.radio.scanCandidateId !== detectedSignal.id) {
      state.radio.scanCandidateId = detectedSignal.id;
      state.radio.scanCandidateSince = time;
    } else if (!state.lastScanToast && time - state.radio.scanCandidateSince > 340) {
      state.lastScanToast = time;
      state.scanning = false;
      setMode('tune');
      updateFrequency(state.telemetry.centerFrequency);
      renderTransmission(detectedSignal);
      $('#lock-caption').textContent = 'CANDIDATE FOUND';
      toast(`Promising carrier found: ${detectedSignal.id}. Press LOCK to hold it.`, 'success');
      addLog(detectedSignal, 'WEAK');
    }
  } else if (!state.telemetry.lockable) {
    state.radio.scanCandidateId = null;
    state.radio.scanCandidateSince = 0;
  }

  if (state.lockedSignal && state.telemetry.signal?.id === state.lockedSignal.id && (proximity < 0.38 || quality < 22)) {
    state.lockedSignal = null;
    state.decoding = false;
    setMode('tune');
    $('#lock-caption').textContent = 'SIGNAL LOST';
    $('#lock-caption').className = 'lost';
    if (!state.lockLostNotified) {
      state.lockLostNotified = true;
      toast('Carrier drifted outside the lock window. Retune and lock again.', 'warning');
    }
  }

  $('#strength-value').textContent = strength.toFixed(1).replace('-', '−');
  $('#quality-value').textContent = `${quality}%`;
  $('#stability-value').textContent = `${stability}%`;
  $('#quality-bar').style.width = `${quality}%`;
  $('.signal-gauge').style.setProperty('--strength', `${clamp((strength + 120) / 120 * 180, 2, 178)}deg`);
  $('#noise-value').textContent = `${state.telemetry.noiseFloor.toFixed(0).replace('-', '−')} dBm`;
  state.buffer = clamp(61 + proximity * 28 + quality * 0.12 + (Math.random() - 0.5) * 7, 0, 100);
  $('#buffer-value').textContent = `${Math.round(state.buffer)}%`;
  $('#buffer-bar').style.width = `${state.buffer}%`;
  $('#dish-value').textContent = `${state.operations.alignment.toFixed(1)}%`;
  $('#dish-bar').style.setProperty('--value', `${state.operations.alignment}%`);
  $('#boost-value').textContent = `+${state.operations.boost.toFixed(1)} dB`;
  $('#boost-bar').style.setProperty('--value', `${clamp(state.operations.boost / 31 * 100, 0, 100)}%`);
  $('#power-value').textContent = `${state.operations.power.toFixed(1)}%`;
  $('#power-bar').style.setProperty('--value', `${state.operations.power}%`);
  $('#temp-value').textContent = `${state.operations.temperature.toFixed(1)} °C`;
  $('#temp-bar').style.setProperty('--value', `${clamp(100 - Math.abs(state.operations.temperature + 195) * 18, 0, 100)}%`);
  $('#bandwidth-value').textContent = `${state.telemetry.bandwidth.toFixed(1)} Hz`;
  audio.update({ ...state.telemetry, frequencyMHz: state.frequencyMHz });
  refreshAtmosphere(time);
  refreshActiveOverlay(time);
}

function animate(time) {
  const delta = Math.min(48, time - state.lastFrame);
  state.lastFrame = time;
  if (state.scanning && !state.pointerTuning && !state.settings.reducedMotion) {
    const ratio = (logFrequency(state.frequencyMHz) + CONFIG.scanSpeed * (delta / 1000)) % 1;
    updateFrequency(frequencyFromRatio(ratio));
  }
  updateTelemetry(time);
  renderer.draw(state, time);
  requestAnimationFrame(animate);
}

function tuneFromPointer(event) {
  const rect = $('#frequency-track').getBoundingClientRect();
  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  state.lockedSignal = null;
  stopDecode('Decode cancelled while tuning.');
  state.lockLostNotified = false;
  setMode('tune');
  updateFrequency(frequencyFromRatio(ratio));
  $('#lock-caption').textContent = 'MANUAL TUNE';
  $('#lock-caption').className = '';
  renderTransmission();
}

function tuneToSignal(signal) {
  state.lockedSignal = null;
  state.decoding = false;
  state.lockLostNotified = false;
  setMode('tune');
  updateFrequency(getSignalFrequency(signal, performance.now()));
  $('#lock-caption').textContent = 'TUNE TO LOCK';
  $('#lock-caption').className = '';
  renderTransmission(signal);
  closeOverlay();
  toast(`Tuned to ${signal.id}. Hold LOCK when the carrier settles.`, 'info');
}

function bindControls() {
  const track = $('#frequency-track');
  track.addEventListener('pointerdown', async (event) => {
    state.pointerTuning = true;
    track.setPointerCapture(event.pointerId);
    await audio.start();
    tuneFromPointer(event);
  });
  track.addEventListener('pointermove', (event) => state.pointerTuning && tuneFromPointer(event));
  track.addEventListener('pointerup', (event) => {
    state.pointerTuning = false;
    track.releasePointerCapture(event.pointerId);
    saveState(state);
  });
  track.addEventListener('wheel', (event) => {
    event.preventDefault();
    setMode('tune');
    updateFrequency(frequencyFromRatio(logFrequency(state.frequencyMHz) + Math.sign(event.deltaY) * 0.0032));
  }, { passive: false });
  track.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    setMode('tune');
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    updateFrequency(frequencyFromRatio(logFrequency(state.frequencyMHz) + direction * (event.shiftKey ? 0.0006 : 0.0025)));
  });

  $('#step-left').addEventListener('click', () => { setMode('tune'); updateFrequency(frequencyFromRatio(logFrequency(state.frequencyMHz) - 0.004)); });
  $('#step-right').addEventListener('click', () => { setMode('tune'); updateFrequency(frequencyFromRatio(logFrequency(state.frequencyMHz) + 0.004)); });
  $('#scan-button').addEventListener('click', async () => {
    await audio.start();
    state.lockedSignal = null;
    state.decoding = false;
    state.lastScanToast = 0;
    state.radio.scanCandidateId = null;
    renderTransmission();
    $('#lock-caption').textContent = 'SEARCHING';
    $('#lock-caption').className = '';
    setMode('scan');
    toast('Automatic sweep resumed. The receiver will pause on a promising carrier.', 'info');
  });
  $('#tune-button').addEventListener('click', async () => { await audio.start(); state.scanning = false; setMode('tune'); toast('Manual tuning engaged. Use the band, wheel, arrows, or keys.', 'info'); });
  $('#lock-button').addEventListener('click', async () => { await audio.start(); lockSignal(); });
  $('#decode-button').addEventListener('click', async () => { await audio.start(); decodeSignal(); });

  $$('.main-nav button').forEach((button) => button.addEventListener('click', () => openView(button.dataset.view, button)));
  $('#overlay-close').addEventListener('click', closeOverlay);
  $('#overlay').addEventListener('click', (event) => {
    if (event.target === $('#overlay')) closeOverlay();
    const command = event.target.closest('[data-command]')?.dataset.command;
    if (command === 'scan') {
      closeOverlay();
      state.lastScanToast = 0;
      setMode('scan');
      toast('Deep field sweep resumed from the command deck.', 'info');
      return;
    }
    if (command) {
      openView(command, $(`.main-nav [data-view="${command}"]`));
      return;
    }
    const inspectSignal = event.target.closest('[data-inspect-signal]')?.dataset.inspectSignal;
    if (inspectSignal) {
      state.selectedSignalId = inspectSignal;
      renderActiveView();
      return;
    }
    const mapSignal = event.target.closest('[data-map-signal]')?.dataset.mapSignal;
    if (mapSignal) {
      state.selectedMapSignalId = mapSignal;
      renderActiveView();
      return;
    }
    const logFilter = event.target.closest('[data-log-filter]')?.dataset.logFilter;
    if (logFilter) {
      state.logFilter = logFilter;
      state.selectedLogIndex = 0;
      renderActiveView();
      return;
    }
    const logIndex = event.target.closest('[data-log-index]')?.dataset.logIndex;
    if (logIndex !== undefined) {
      state.selectedLogIndex = Number(logIndex);
      renderActiveView();
      return;
    }
    const profile = event.target.closest('[data-sensitivity]');
    if (profile) {
      const range = $('#setting-sensitivity');
      range.value = profile.dataset.sensitivity;
      $('#sensitivity-readout').textContent = `${Number(range.value).toFixed(1)}×`;
      $$('.profile-selector button').forEach((button) => button.classList.toggle('active', button === profile));
      $('.scope-rings b').style.setProperty('--spread', range.value);
      return;
    }
    if (event.target.closest('[data-commit-settings]')) {
      event.preventDefault();
      commitReceiverSettings();
      return;
    }
    const tuneSignalId = event.target.closest('[data-tune-signal]')?.dataset.tuneSignal;
    if (tuneSignalId) {
      const signal = state.signals.find((candidate) => candidate.id === tuneSignalId);
      if (signal) tuneToSignal(signal);
    }
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeOverlay(); });
  $('#view-all-logs').addEventListener('click', () => openView('logbook', $('.main-nav [data-view="logbook"]')));
}

function renderActiveView() {
  const content = $('#overlay-content');
  if (!state.activeOverlayView || !content) return;
  if (state.activeOverlayView === 'dashboard') {
    content.innerHTML = dashboardView(state);
  } else if (state.activeOverlayView === 'transmissions') {
    content.innerHTML = transmissionsView(state, state.selectedSignalId);
  } else if (state.activeOverlayView === 'starmap') {
    content.innerHTML = starmapView(state, state.selectedMapSignalId);
  } else if (state.activeOverlayView === 'logbook') {
    content.innerHTML = logbookView(state, state.logFilter, state.selectedLogIndex);
  } else if (state.activeOverlayView === 'settings') {
    content.innerHTML = settingsView(state);
    const form = $('.settings-console');
    const range = $('#setting-sensitivity');
    const commitButton = $('[data-commit-settings]');
    range.addEventListener('input', () => {
      $('#sensitivity-readout').textContent = `${Number(range.value).toFixed(1)}×`;
      $('.scope-rings b').style.setProperty('--spread', range.value);
      $$('.profile-selector button').forEach((button) => button.classList.remove('active'));
    });
    commitButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      commitReceiverSettings();
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      commitReceiverSettings();
    });
  }
}

function openView(view, button) {
  $$('.main-nav button').forEach((item) => item.classList.toggle('active', item === button));
  if (view === 'scan') {
    closeOverlay();
    setMode('scan');
    return;
  }
  state.activeOverlayView = view;
  if (view === 'transmissions' && !state.selectedSignalId) state.selectedSignalId = state.lockedSignal?.id ?? state.signals[0]?.id;
  if (view === 'starmap' && !state.selectedMapSignalId) state.selectedMapSignalId = state.lockedSignal?.id ?? state.signals[0]?.id;
  const overlay = $('#overlay');
  if (state.overlayCloseTimer) {
    clearTimeout(state.overlayCloseTimer);
    state.overlayCloseTimer = null;
  }
  overlay.dataset.view = view;
  $('#overlay-kicker').textContent = view === 'dashboard' ? 'ARRAY COMMAND DECK' : view === 'transmissions' ? 'DEEP FIELD ARCHIVE' : view === 'starmap' ? 'CELESTIAL NAVIGATION' : view === 'logbook' ? 'SESSION MEMORY' : 'RECEIVER CONTROL';
  $('#overlay-title').textContent = view.toUpperCase();
  renderActiveView();
  $('#overlay-content').scrollTop = 0;
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('visible'));
}

function closeOverlay() {
  const overlay = $('#overlay');
  overlay.classList.remove('visible');
  if (state.overlayCloseTimer) clearTimeout(state.overlayCloseTimer);
  state.overlayCloseTimer = setTimeout(() => {
    overlay.hidden = true;
    state.overlayCloseTimer = null;
  }, 240);
}

function commitReceiverSettings() {
  const range = $('#setting-sensitivity');
  state.settings.audio = $('#setting-audio').checked;
  state.settings.reducedMotion = $('#setting-motion').checked;
  state.settings.sensitivity = Number(range.value);
  audio.setEnabled(state.settings.audio);
  document.documentElement.classList.toggle('motion-reduced', state.settings.reducedMotion);
  saveState(state);
  toast('Receiver calibration committed to Array 7.', 'success');
  closeOverlay();
}

function updateSessionTime() {
  const seconds = Math.floor((Date.now() - state.startTime) / 1000);
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  $('#session-time').textContent = `${h}:${m}:${s}`;
}

async function boot() {
  const details = ['Synchronising atomic receiver clock...', 'Calibrating hydrogen-line filters...', 'Mapping local interference...', 'Opening listening window...'];
  let progress = 0;
  const timer = setInterval(() => {
    progress = Math.min(96, progress + 7 + Math.random() * 12);
    $('#boot-progress').style.width = `${progress}%`;
    $('#boot-detail').textContent = details[Math.min(details.length - 1, Math.floor(progress / 28))];
  }, 130);
  const catalog = await fetchSignalCatalog(state.sessionId);
  state.signals = catalog.signals;
  clearInterval(timer);
  $('#boot-progress').style.width = '100%';
  $('#boot-detail').textContent = catalog.source === 'server' ? 'Receiver linked to remote telemetry service.' : 'Receiver operating in autonomous local mode.';
  updateFrequency(state.frequencyMHz);
  renderLogs();
  renderTransmission();
  renderDecode();
  renderOperations();
  bindControls();
  setMode('scan');
  setTimeout(() => {
    $('#boot-screen').classList.add('complete');
    $('#app').classList.add('ready');
    setTimeout(() => $('#boot-screen').remove(), 800);
  }, 340);
  setInterval(updateSessionTime, 1000);
  setInterval(() => saveState(state), 12_000);
  requestAnimationFrame(animate);
}

boot();
