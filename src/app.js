import { CONFIG } from './modules/config.js';
import { getSessionId, loadState, saveState } from './modules/store.js';
import { fetchSignalCatalog, requestDecode, syncSession } from './modules/api-client.js';
import { findNearestSignal, formatFrequency, frequencyFromRatio, logFrequency, deriveTelemetry } from './modules/signal-engine.js';
import { AudioEngine } from './modules/audio-engine.js';
import { createStarfield } from './modules/starfield.js';
import { SpectrumRenderer } from './modules/spectrum-renderer.js';

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
  const node = document.createElement('div');
  node.className = `toast ${tone}`;
  node.textContent = message;
  region.append(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 300);
  }, 2700);
}

function setMode(mode) {
  state.mode = mode;
  state.scanning = mode === 'scan';
  $$('.mode-button').forEach((button) => button.classList.remove('active'));
  const button = $(`#${mode}-button`);
  if (button) button.classList.add('active');
  $('#mode-value').textContent = mode === 'scan' ? 'NARROWBAND' : mode.toUpperCase();
  $('#hopping-mode').textContent = state.scanning ? 'AUTO' : 'MANUAL';
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
  const spans = Array.from({ length: 22 }, (_, i) => {
    const h = 3 + Math.abs(Math.sin(i * 1.83 + Math.random())) * 9;
    return `<i style="height:${h.toFixed(1)}px"></i>`;
  }).join('');
  return `<span class="mini-wave">${spans}</span>`;
}

function renderLogs() {
  $('#detection-log').innerHTML = state.logs.slice(0, 6).map((entry) => `
    <article>
      <div><time>${entry.time}</time><strong>${entry.frequency}</strong></div>
      <div><b class="${entry.status.toLowerCase()}">${entry.status}</b>${createMiniWave()}</div>
    </article>`).join('');
}

function addLog(signal, status = 'LOCKED') {
  const now = new Date();
  state.logs.unshift({
    time: now.toLocaleTimeString('en-GB', { hour12: false }),
    frequency: `${(signal.frequencyMHz / 1000).toFixed(3)} GHz`,
    status,
    id: signal.id,
  });
  state.logs = state.logs.slice(0, CONFIG.maxLogs);
  renderLogs();
  saveState(state);
}

function renderTransmission(signal = null) {
  if (!signal) {
    $('#transmission-title').textContent = 'TRANSMISSION SEARCH';
    $('#signal-badge').textContent = 'IDLE';
    $('#signal-id').textContent = 'TLS-UNRESOLVED';
    $('#received-time').textContent = '—';
    $('#signal-coordinates').textContent = 'RA —   DEC —';
    $('#signal-distance').textContent = '— light years';
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
  if (!signal || distance > tolerance) {
    state.lockedSignal = null;
    $('#lock-caption').textContent = 'SIGNAL LOST';
    $('#lock-caption').className = 'lost';
    toast('No coherent carrier inside lock window.', 'warning');
    addLog({ frequencyMHz: state.frequencyMHz }, 'NOISE');
    return;
  }
  state.lockedSignal = signal;
  state.scanning = false;
  state.frequencyMHz = signal.frequencyMHz;
  updateFrequency(signal.frequencyMHz);
  setMode('lock');
  $('#lock-caption').textContent = 'LOCKED SIGNAL';
  $('#lock-caption').className = 'locked';
  renderTransmission(signal);
  state.decodeProgress = state.unlockedSignalIds.has(signal.id) ? 100 : 0;
  state.decodedFragments = state.decodeProgress === 100 ? signal.fragments : [];
  renderDecode();
  addLog(signal, 'LOCKED');
  audio.pulse('lock');
  toast(`Carrier lock established: ${signal.id}`, 'success');
}

async function decodeSignal() {
  if (!state.lockedSignal) {
    toast('Lock a coherent transmission before decoding.', 'warning');
    return;
  }
  if (state.decoding) return;
  if (state.decodeProgress >= 100) {
    toast('Transmission already fully decoded.', 'info');
    return;
  }
  state.decoding = true;
  setMode('decode');
  audio.pulse('decode');
  const run = async () => {
    if (!state.decoding) return;
    state.decodeProgress = Math.min(100, state.decodeProgress + 8 + Math.random() * 5);
    const payload = await requestDecode(state.lockedSignal, state.decodeProgress, state.sessionId);
    if (payload.fragment && !state.decodedFragments.includes(payload.fragment)) state.decodedFragments.push(payload.fragment);
    renderDecode();
    if (state.decodeProgress >= 100 || payload.completed) {
      state.decodeProgress = 100;
      state.decoding = false;
      state.unlockedSignalIds.add(state.lockedSignal.id);
      renderDecode();
      saveState(state);
      syncSession({
        sessionId: state.sessionId,
        unlockedSignalIds: [...state.unlockedSignalIds],
        logs: state.logs.slice(0, 8),
      });
      toast('Decode complete. Archive fragment restored.', 'success');
      return;
    }
    setTimeout(run, CONFIG.decodeTickMs);
  };
  run();
}

function updateTelemetry(time) {
  state.telemetry = deriveTelemetry(state.frequencyMHz, state.signals, time);
  if (state.lockedSignal) {
    state.telemetry = {
      ...state.telemetry,
      strength: state.lockedSignal.strength + Math.sin(time * .002) * .8,
      quality: state.lockedSignal.quality,
      stability: state.lockedSignal.stability,
      proximity: 1,
      signal: state.lockedSignal,
    };
  }
  const { strength, quality, stability, proximity } = state.telemetry;
  $('#strength-value').textContent = strength.toFixed(1).replace('-', '−');
  $('#quality-value').textContent = `${quality}%`;
  $('#stability-value').textContent = `${stability}%`;
  $('#quality-bar').style.width = `${quality}%`;
  $('.signal-gauge').style.setProperty('--strength', `${clamp((strength + 120) / 120 * 180, 2, 178)}deg`);
  $('#noise-value').textContent = `${(-112 + proximity * 18).toFixed(0).replace('-', '−')} dBm`;
  state.buffer = clamp(86 + Math.sin(time * .0007) * 3 + proximity * 5, 0, 100);
  $('#buffer-value').textContent = `${Math.round(state.buffer)}%`;
  $('#buffer-bar').style.width = `${state.buffer}%`;
  $('#dish-value').textContent = `${(87.4 + Math.sin(time * .0005) * .6).toFixed(1)}%`;
  $('#temp-value').textContent = `−${(195.2 + Math.sin(time * .00031) * .4).toFixed(1)} °C`;
  audio.update(state.telemetry);
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
  state.decoding = false;
  setMode('tune');
  updateFrequency(frequencyFromRatio(ratio));
  $('#lock-caption').textContent = 'MANUAL TUNE';
  $('#lock-caption').className = '';
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
    const ratio = clamp(logFrequency(state.frequencyMHz) + Math.sign(event.deltaY) * .0032, 0, 1);
    updateFrequency(frequencyFromRatio(ratio));
  }, { passive: false });
  track.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    setMode('tune');
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    updateFrequency(frequencyFromRatio(logFrequency(state.frequencyMHz) + direction * (event.shiftKey ? .0006 : .0025)));
  });

  $('#step-left').addEventListener('click', () => updateFrequency(frequencyFromRatio(logFrequency(state.frequencyMHz) - .004)));
  $('#step-right').addEventListener('click', () => updateFrequency(frequencyFromRatio(logFrequency(state.frequencyMHz) + .004)));
  $('#scan-button').addEventListener('click', async () => { await audio.start(); state.lockedSignal = null; state.decoding = false; setMode('scan'); renderTransmission(); });
  $('#tune-button').addEventListener('click', async () => { await audio.start(); setMode('tune'); });
  $('#lock-button').addEventListener('click', async () => { await audio.start(); lockSignal(); });
  $('#decode-button').addEventListener('click', async () => { await audio.start(); decodeSignal(); });

  $$('.main-nav button').forEach((button) => button.addEventListener('click', () => openView(button.dataset.view, button)));
  $('#overlay-close').addEventListener('click', closeOverlay);
  $('#overlay').addEventListener('click', (event) => { if (event.target === $('#overlay')) closeOverlay(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeOverlay(); });
  $('#view-all-logs').addEventListener('click', () => openView('logbook', $('.main-nav [data-view="logbook"]')));
}

function overlayTableRows() {
  return state.logs.map((log) => `<tr><td>${log.time}</td><td>${log.frequency}</td><td><span class="table-status ${log.status.toLowerCase()}">${log.status}</span></td><td>${log.id ?? 'UNCLASSIFIED'}</td></tr>`).join('');
}

function openView(view, button) {
  if (view === 'scan' || view === 'dashboard') {
    $$('.main-nav button').forEach((item) => item.classList.toggle('active', item === button));
    return;
  }
  $$('.main-nav button').forEach((item) => item.classList.toggle('active', item === button));
  const overlay = $('#overlay');
  const title = $('#overlay-title');
  const kicker = $('#overlay-kicker');
  const content = $('#overlay-content');
  kicker.textContent = 'DEEP SPACE ARRAY 7';
  title.textContent = view.toUpperCase();
  if (view === 'transmissions') {
    content.innerHTML = `<div class="archive-grid">${state.signals.map((signal) => `<article class="archive-card ${state.unlockedSignalIds.has(signal.id) ? 'unlocked' : ''}"><span>${signal.className}</span><h3>${signal.id}</h3><p>${(signal.frequencyMHz / 1000).toFixed(6)} GHz</p><dl><div><dt>Distance</dt><dd>${signal.distance.toLocaleString()} ly</dd></div><div><dt>Status</dt><dd>${state.unlockedSignalIds.has(signal.id) ? 'DECODED' : 'UNRESOLVED'}</dd></div></dl></article>`).join('')}</div>`;
  } else if (view === 'starmap') {
    content.innerHTML = `<div class="full-starmap"><div class="map-orbit o1"></div><div class="map-orbit o2"></div><div class="map-orbit o3"></div>${state.signals.map((s, i) => `<button style="--x:${23 + i * 24}%;--y:${60 - i * 17}%" title="${s.id}"><i></i><span>${s.id}<small>${s.ra} / ${s.dec}</small></span></button>`).join('')}</div>`;
  } else if (view === 'logbook') {
    content.innerHTML = `<div class="table-wrap"><table><thead><tr><th>TIME</th><th>FREQUENCY</th><th>STATUS</th><th>IDENTIFIER</th></tr></thead><tbody>${overlayTableRows()}</tbody></table></div>`;
  } else if (view === 'settings') {
    content.innerHTML = `<form class="settings-form"><label><span>PROCEDURAL AUDIO<small>Static, carrier tones and lock cues</small></span><input id="setting-audio" type="checkbox" ${state.settings.audio ? 'checked' : ''}></label><label><span>REDUCED MOTION<small>Disable automatic frequency sweep</small></span><input id="setting-motion" type="checkbox" ${state.settings.reducedMotion ? 'checked' : ''}></label><label class="range-label"><span>LOCK SENSITIVITY<small>Receiver tolerance around coherent carriers</small></span><input id="setting-sensitivity" type="range" min="0.6" max="1.8" step="0.1" value="${state.settings.sensitivity}"></label><button type="submit" class="outline-button">APPLY RECEIVER CONFIGURATION</button></form>`;
    setTimeout(() => {
      $('.settings-form').addEventListener('submit', (event) => {
        event.preventDefault();
        state.settings.audio = $('#setting-audio').checked;
        state.settings.reducedMotion = $('#setting-motion').checked;
        state.settings.sensitivity = Number($('#setting-sensitivity').value);
        audio.setEnabled(state.settings.audio);
        saveState(state);
        toast('Receiver configuration applied.', 'success');
        closeOverlay();
      });
    });
  }
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('visible'));
}

function closeOverlay() {
  const overlay = $('#overlay');
  overlay.classList.remove('visible');
  setTimeout(() => { overlay.hidden = true; }, 240);
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
  bindControls();
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
