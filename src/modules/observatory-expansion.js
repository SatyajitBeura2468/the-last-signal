import {
  ARRAY_NODES,
  OBSERVATORY_WORLDS,
  SIGNAL_CANDIDATES,
  SKY_SECTORS,
} from './observatory-data.js';
import { observatoryStore } from '../core/observatory-store.js';
import { selectDecodeEvidence, selectDecodeReady } from '../core/selectors.js';
import { queueCommand } from '../simulation/mission-engine.js';
import { findCatalogTarget } from '../simulation/signal-model.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const formatGHz = (mhz) => mhz >= 1000 ? `${(mhz / 1000).toFixed(6)} GHz` : `${mhz.toFixed(6)} MHz`;

const rootState = observatoryStore.state;
const state = rootState.observatory;
let worldOverlay = null;
let lastFocused = null;
let lastKnownCarrier = '';
let worldCanvasFrame = null;
let lastCommandFingerprint = '';

function persist() {
  observatoryStore.persist();
}

function nowCode() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' });
}

function addEvent(title, message, severity = 'info') {
  state.eventLog.unshift({ time: nowCode(), title, message, severity });
  state.eventLog = state.eventLog.slice(0, 30);
  persist();
  updateTicker();
  if (worldOverlay && !worldOverlay.hidden && state.selectedWorld === 'live-ops') renderWorld();
}

function toast(message, tone = 'info') {
  const region = $('#toast-region');
  if (!region) return;
  const node = document.createElement('div');
  node.className = `toast ${tone}`;
  node.textContent = message;
  region.append(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 280);
  }, 3200);
}

function svgIcon(type) {
  const paths = {
    'live-ops': '<circle cx="12" cy="12" r="8"/><path d="M4 14c5-.5 9-4.5 10-10M7 18c5-1 10-6 11-11"/><circle cx="6" cy="16" r="1.4"/>',
    lab: '<path d="M3 12h3l2-6 4 12 3-9 3 6h3"/><path d="M4 20h16"/>',
    sky: '<circle cx="12" cy="12" r="9"/><path d="m12 4 2.1 5.9L20 12l-5.9 2.1L12 20l-2.1-5.9L4 12l5.9-2.1L12 4Z"/>',
    evidence: '<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h6M8 16h4"/>',
    systems: '<circle cx="12" cy="12" r="3"/><path d="M4 12h3M17 12h3M12 4v3M12 17v3"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[type]}</svg>`;
}

function injectNavigation() {
  const nav = $('.main-nav');
  if (!nav || nav.dataset.observatoryExpanded) return;
  nav.dataset.observatoryExpanded = 'true';
  $$('[data-destination]', nav).forEach((button) => button.addEventListener('click', () => {
    const destination = button.dataset.destination;
    if (destination === 'receiver') closeWorld();
    else openWorld(destination, button);
  }));

  const mobileDock = document.createElement('nav');
  mobileDock.className = 'mobile-observatory-dock';
  mobileDock.setAttribute('aria-label', 'Primary observatory destinations');
  mobileDock.innerHTML = [
    ['receiver', 'RCV', 'Receiver'],
    ['live-ops', 'OPS', 'Live Ops'],
    ['lab', 'LAB', 'Signal Lab'],
    ['sky', 'SKY', 'Sky'],
    ['evidence', 'EVD', 'Evidence'],
  ].map(([id, short, label]) => `<button type="button" data-mobile-destination="${id}" aria-label="${label}" class="${id === 'receiver' ? 'active' : ''}"><i></i><span>${short}</span></button>`).join('');
  const systems = document.createElement('button');
  systems.type = 'button';
  systems.className = 'mobile-systems-control';
  systems.dataset.mobileDestination = 'systems';
  systems.setAttribute('aria-label', 'Open Systems');
  systems.innerHTML = `${svgIcon('systems')}<span>SYSTEMS</span>`;
  document.body.append(mobileDock, systems);
  $$('[data-mobile-destination]').forEach((button) => button.addEventListener('click', () => {
    const destination = button.dataset.mobileDestination;
    if (destination === 'receiver') closeWorld();
    else openWorld(destination, button);
  }));
  document.addEventListener('tls:open-destination', (event) => openWorld(event.detail?.destination || 'live-ops'));
}

function injectLiveInstrumentation() {
  const header = $('.hero-header');
  if (header && !$('.observatory-live-strip', header)) {
    const strip = document.createElement('section');
    strip.className = 'observatory-live-strip';
    strip.setAttribute('aria-label', 'Live observatory telemetry');
    strip.innerHTML = `
      <div><span>UTC</span><b id="obs-utc">--:--:--</b></div>
      <div><span>LOCAL SIDEREAL</span><b id="obs-lst">--:--:--</b></div>
      <div><span>TARGET ALT / AZ</span><b id="obs-bary">-- / --</b></div>
      <div><span>SOLAR WIND <em id="obs-source-state">SIM</em></span><b id="obs-solar">--- km/s</b></div>
      <div><span>CLOCK OFFSET</span><b id="obs-clock">-- ns</b></div>
      <button type="button" data-open-observatory="live-ops"><i></i><span>OBSERVATORY LIVE</span><small>CYCLE ${String(state.cycle).padStart(2, '0')}</small></button>`;
    header.append(strip);
    $('[data-open-observatory="live-ops"]', strip).addEventListener('click', (event) => openWorld('live-ops', event.currentTarget));
  }

  const frequencyPanel = $('.frequency-panel');
  if (frequencyPanel && !$('.frequency-minute-readouts', frequencyPanel)) {
    const readouts = document.createElement('div');
    readouts.className = 'frequency-minute-readouts';
    readouts.innerHTML = `
      <span><i></i>FFT 16,384</span>
      <span id="obs-coherence">COHERENCE 0.18</span>
      <span id="obs-drift">DRIFT +0.00 Hz/s</span>
      <span id="obs-window">WINDOW HANN-7</span>`;
    frequencyPanel.append(readouts);

    const contacts = document.createElement('div');
    contacts.className = 'frequency-ghost-contacts';
    contacts.setAttribute('aria-hidden', 'true');
    contacts.innerHTML = [13, 27, 46, 67, 82, 93].map((position, index) => `<i style="--x:${position}%;--d:${index * -.43}s"></i>`).join('');
    frequencyPanel.append(contacts);
  }

  const rightRail = $('.detection-panel');
  if (rightRail && !$('.observatory-deck-launcher', rightRail)) {
    const launcher = document.createElement('section');
    launcher.className = 'observatory-deck-launcher';
    launcher.innerHTML = `
      <header><span>OBSERVATION CHAIN</span><b id="mission-stage">${state.mission.stage}</b></header>
      <div class="mission-lifecycle">
        <button type="button" data-open-observatory="live-ops"><i>01</i><span>TARGET + ARRAY</span><b id="mission-target-state">SLEW</b></button>
        <button type="button" data-open-observatory="lab"><i>02</i><span>FORENSIC ANALYSIS</span><b id="mission-lab-state">WAIT</b></button>
        <button type="button" data-open-observatory="sky"><i>03</i><span>REVISIT WINDOW</span><b id="mission-revisit-state">WAIT</b></button>
        <button type="button" data-open-observatory="evidence"><i>04</i><span>EVIDENCE COMMIT</span><b id="mission-evidence-state">SEALED</b></button>
      </div>`;
    rightRail.append(launcher);
    $$('[data-open-observatory]', launcher).forEach((button) => button.addEventListener('click', () => openWorld(button.dataset.openObservatory, button)));
  }

  const footer = $('.status-footer');
  if (footer && !$('.observatory-event-ticker', footer)) {
    const ticker = document.createElement('button');
    ticker.type = 'button';
    ticker.className = 'observatory-event-ticker';
    ticker.dataset.openObservatory = 'live-ops';
    ticker.innerHTML = '<i></i><span id="obs-ticker-label">ARRAY EVENT</span><b id="obs-ticker-message">Waiting for operations telemetry...</b><em>OPEN DECK</em>';
    ticker.addEventListener('click', () => openWorld('live-ops', ticker));
    footer.append(ticker);
  }
}

function createWorldOverlay() {
  if ($('#observatory-world')) return $('#observatory-world');
  const overlay = document.createElement('div');
  overlay.id = 'observatory-world';
  overlay.className = 'observatory-world';
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="observatory-world-shell panel" role="dialog" aria-modal="true" aria-labelledby="observatory-world-title">
      <header class="observatory-world-header">
        <div class="world-station-mark"><i></i><span>DEEP SPACE ARRAY 7</span><small>OPERATIONS ENVIRONMENT</small></div>
        <nav aria-label="Observatory environments">
          ${OBSERVATORY_WORLDS.map((world) => `<button type="button" data-world-tab="${world.id}"><i>${world.index}</i><span>${world.label}</span></button>`).join('')}
        </nav>
        <div class="world-clock"><span>ARRAY TIME</span><b id="world-clock">--:--:-- UTC</b></div>
        <button type="button" class="observatory-world-close" aria-label="Close observatory environment">×</button>
      </header>
      <div class="observatory-world-heading">
        <div><span id="observatory-world-index">07A / OPERATIONS</span><h2 id="observatory-world-title">ARRAY CORE</h2></div>
        <p id="observatory-world-description">Live control of the six-dish interferometric array.</p>
        <div class="world-health"><i></i><span>ARRAY INTEGRITY</span><b id="world-integrity">96.4%</b></div>
      </div>
      <main id="observatory-world-content" class="observatory-world-content"></main>
      <footer class="observatory-world-footer">
        <div><i></i><span>SECURE INTERNAL BUS</span><b id="world-bus">12.8 Gb/s</b></div>
        <div><span>OBSERVATION CYCLE</span><b>${String(state.cycle).padStart(2, '0')}</b></div>
        <div><span>EVENTS RETAINED</span><b id="world-event-count">${state.eventLog.length}</b></div>
        <div><span>LOCAL STATE</span><b>SYNCHRONISED</b></div>
      </footer>
    </section>`;
  document.body.append(overlay);
  overlay.addEventListener('click', handleWorldClick);
  overlay.addEventListener('input', handleWorldInput);
  $('.observatory-world-close', overlay).addEventListener('click', closeWorld);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) closeWorld(); });
  worldOverlay = overlay;
  return overlay;
}

function openWorld(worldId, trigger) {
  const valid = OBSERVATORY_WORLDS.some((world) => world.id === worldId) ? worldId : 'live-ops';
  state.selectedWorld = valid;
  persist();
  lastFocused = trigger || document.activeElement;
  worldOverlay = createWorldOverlay();
  worldOverlay.hidden = false;
  document.body.classList.add('observatory-world-open');
  $$('[data-destination]').forEach((item) => item.classList.toggle('active', item.dataset.destination === valid));
  $$('[data-mobile-destination]').forEach((item) => item.classList.toggle('active', item.dataset.mobileDestination === valid));
  requestAnimationFrame(() => worldOverlay.classList.add('visible'));
  renderWorld();
  $('.observatory-world-close', worldOverlay).focus();
}

function closeWorld() {
  if (!worldOverlay || worldOverlay.hidden) return;
  worldOverlay.classList.remove('visible');
  document.body.classList.remove('observatory-world-open');
  cancelAnimationFrame(worldCanvasFrame);
  setTimeout(() => { worldOverlay.hidden = true; }, 240);
  $$('[data-destination]').forEach((item) => item.classList.toggle('active', item.dataset.destination === 'receiver'));
  $$('[data-mobile-destination]').forEach((item) => item.classList.toggle('active', item.dataset.mobileDestination === 'receiver'));
  lastFocused?.focus?.();
}

function renderWorld() {
  if (!worldOverlay) return;
  const world = OBSERVATORY_WORLDS.find((item) => item.id === state.selectedWorld) || OBSERVATORY_WORLDS[0];
  $$('[data-world-tab]', worldOverlay).forEach((button) => button.classList.toggle('active', button.dataset.worldTab === world.id));
  $('#observatory-world-index', worldOverlay).textContent = `${world.index} / ${world.id === 'live-ops' ? 'OPERATIONS' : world.id === 'lab' ? 'ANALYSIS' : world.id === 'sky' ? 'ASTROMETRY' : world.id === 'evidence' ? 'PROVENANCE' : 'CONTROL'}`;
  $('#observatory-world-title', worldOverlay).textContent = world.label;
  $('#observatory-world-description', worldOverlay).textContent = {
    'live-ops': 'Live control of the six-dish interferometric array, incidents and timed commands.',
    lab: 'Forensic isolation, correction and classification of every suspicious carrier.',
    sky: 'Accurate target visibility, dish pointing and observation-window scheduling.',
    evidence: 'Persistent evidence, operator annotations and the complete chain of discovery.',
    systems: 'Rendering, data provenance, persistence and resource controls.',
  }[world.id];
  $('#world-integrity', worldOverlay).textContent = `${state.array.integrity.toFixed(1)}%`;
  $('#world-event-count', worldOverlay).textContent = String(state.eventLog.length);
  const content = $('#observatory-world-content', worldOverlay);
  content.innerHTML = world.id === 'live-ops'
    ? renderArrayCore()
    : world.id === 'lab'
      ? renderSignalLab()
      : world.id === 'sky'
        ? renderNavigation()
        : world.id === 'evidence'
          ? renderVault()
          : renderSystems();
  cancelAnimationFrame(worldCanvasFrame);
  requestAnimationFrame(() => drawWorldCanvases(world.id));
}

function renderArrayCore() {
  const liveDish = state.array.dishes.find((item) => item.id === state.selectedDish) || state.array.dishes[0];
  const dishMeta = ARRAY_NODES.find((item) => item.id === liveDish.id) || ARRAY_NODES[0];
  const dish = {
    ...dishMeta,
    bearing: liveDish.currentAzimuth,
    elevation: liveDish.currentElevation,
    health: liveDish.servoHealth,
    role: liveDish.role,
  };
  const actions = state.array.actions.slice(0, 5);
  const activeCommand = state.commands.find((command) => ['QUEUED', 'RUNNING'].includes(command.status));
  return `
    <section class="array-world-grid">
      <article class="world-module array-topology">
        <header><span>INTERFEROMETRIC TOPOLOGY</span><b>6 / 6 NODES LINKED</b></header>
        <div class="array-field">
          <div class="array-range range-a"></div><div class="array-range range-b"></div><div class="array-range range-c"></div>
          <div class="array-phase-beam"></div><div class="array-hub"><i></i><b>DSA-7</b><span>PHASE CORE</span></div>
          ${state.array.dishes.map((node, index) => `<button type="button" class="dish-node ${node.id === dish.id ? 'active' : ''}" data-select-dish="${node.id}" style="--angle:${node.currentAzimuth}deg;--radius:${index % 2 ? 38 : 45}%"><i></i><span>${node.id}<small>${node.servoHealth.toFixed(1)}%</small></span></button>`).join('')}
          <canvas id="array-link-canvas" aria-hidden="true"></canvas>
        </div>
        <footer><span>BASELINE ${state.navigation.baseline}</span><span>PHASE ERROR ${state.array.phaseError.toFixed(2)} mrad</span><span>INTEGRATION ${state.mission.integrationSeconds.toFixed(1)} / ${state.mission.requiredIntegrationSeconds.toFixed(1)} s</span></footer>
      </article>

      <aside class="world-module dish-inspector">
        <header><span>SELECTED APERTURE</span><b>${dish.role}</b></header>
        <div class="dish-identity"><i></i><div><small>${dish.id}</small><strong>${dish.name}</strong></div></div>
        <dl>
          <div><dt>AZIMUTH</dt><dd>${dish.bearing.toFixed(1)}°</dd></div>
          <div><dt>ELEVATION</dt><dd>${dish.elevation.toFixed(1)}°</dd></div>
          <div><dt>SERVO HEALTH</dt><dd>${dish.health.toFixed(1)}%</dd></div>
          <div><dt>PHASE DELAY</dt><dd>${liveDish.phaseOffset.toFixed(3)} ns</dd></div>
          <div><dt>WIND LOAD</dt><dd>${liveDish.windLoad.toFixed(1)}%</dd></div>
        </dl>
        <div class="dish-health-track"><i style="width:${dish.health}%"></i></div>
        <button type="button" data-array-action="park">PARK SELECTED DISH <b>→</b></button>
      </aside>

      <article class="world-module subsystem-rack">
        <header><span>PHYSICAL SUBSYSTEMS</span><b>LIVE CONTROL</b></header>
        <div class="subsystem-columns">
          <section><span>CRYOGENIC LOOP</span><strong>${(-196.2 + state.resources.thermalLoad * .055).toFixed(2)} °C</strong><div><i style="width:${state.resources.cryogenicReserve}%"></i></div><small>${state.resources.cryogenicReserve.toFixed(1)}% reserve / ${state.resources.thermalLoad.toFixed(1)}% thermal load</small><button type="button" data-array-action="cryo">FLUSH RESERVE LOOP</button></section>
          <section><span>PHASE DISCIPLINE</span><strong>${state.array.phaseError.toFixed(2)} mrad</strong><div><i style="width:${clamp(100 - state.array.phaseError * 26, 5, 100)}%"></i></div><small>Atomic reference / six-node convergence</small><button type="button" data-array-action="calibrate">CALIBRATE BASELINES</button></section>
          <section><span>RESERVE POWER</span><strong>${state.resources.reservePower.toFixed(1)}%</strong><div><i style="width:${state.resources.reservePower}%"></i></div><small>Main bus ${state.resources.mainPower.toFixed(1)}% / receiver-first priority</small><button type="button" data-array-action="power">REROUTE POWER</button></section>
        </div>
      </article>

      <article class="world-module operations-stream">
        <header><span>OPERATIONS STREAM</span><b>${state.eventLog.length} EVENTS</b></header>
        <div>${state.eventLog.slice(0, 7).map((event) => `<article data-severity="${event.severity}"><i></i><time>${event.time}</time><span><b>${event.title}</b><small>${event.message}</small></span></article>`).join('')}</div>
      </article>

      <article class="world-module command-sequence">
        <header><span>COMMAND EXECUTION</span><b>${activeCommand ? activeCommand.status : 'IDLE'}</b></header>
        <div>${activeCommand ? `<p class="active-command"><time>${Math.round(activeCommand.progress * 100)}%</time><span>${activeCommand.label}</span><b>${activeCommand.status}</b></p><div class="command-progress"><i style="width:${activeCommand.progress * 100}%"></i></div>` : actions.length ? actions.map((action) => `<p><time>${action.time}</time><span>${action.label}</span><b>${action.result}</b></p>`).join('') : '<p class="world-empty">No manual command has been committed during this cycle.</p>'}</div>
        <button type="button" data-array-action="diagnostic">RUN FULL ARRAY DIAGNOSTIC <b>→</b></button>
      </article>
    </section>`;
}

function selectedCandidate() {
  return SIGNAL_CANDIDATES.find((item) => item.id === state.selectedCandidate) || SIGNAL_CANDIDATES[0];
}

function filterGain() {
  return Object.values(state.lab.filters).filter(Boolean).length * 7 + state.lab.confidenceBonus;
}

function renderSignalLab() {
  const candidate = selectedCandidate();
  const confidence = clamp(candidate.confidence + filterGain(), 1, 99);
  return `
    <section class="lab-world-grid">
      <nav class="world-module candidate-index" aria-label="Candidate carrier list">
        <header><span>CANDIDATE QUEUE</span><b>${SIGNAL_CANDIDATES.length} CONTACTS</b></header>
        <div>${SIGNAL_CANDIDATES.map((item, index) => `<button type="button" data-select-candidate="${item.id}" class="${item.id === candidate.id ? 'active' : ''}"><i>${String(index + 1).padStart(2, '0')}</i><span><b>${item.id}</b><small>${formatGHz(item.frequencyMHz)} / ${item.sector}</small></span><em>${item.confidence}%</em></button>`).join('')}</div>
      </nav>

      <article class="world-module forensic-scope">
        <header><span>FORENSIC SPECTRUM / ${candidate.className}</span><b id="lab-live-state">LIVE BUFFER</b></header>
        <div class="forensic-canvas-wrap">
          <canvas id="lab-spectrum-canvas"></canvas>
          <div class="scope-scale"><span>−120</span><span>−90</span><span>−60</span><span>−30 dBm</span></div>
          <div class="scope-reticle"><i></i><b></b></div>
          <div class="scope-annotation"><span>CARRIER CENTROID</span><b>${formatGHz(candidate.frequencyMHz)}</b><small>${candidate.drift >= 0 ? '+' : ''}${candidate.drift.toFixed(2)} Hz/s drift</small></div>
        </div>
        <footer><span>FFT 65,536</span><span>WINDOW BLACKMAN-HARRIS</span><span>STACK 128 FRAMES</span><span>UTC ${nowCode()}</span></footer>
      </article>

      <aside class="world-module forensic-dossier">
        <header><span>CARRIER DOSSIER</span><b>${candidate.className}</b></header>
        <h3>${candidate.id}</h3><p>${candidate.note}</p>
        <dl>
          <div><dt>RIGHT ASCENSION</dt><dd>${candidate.ra}</dd></div>
          <div><dt>DECLINATION</dt><dd>${candidate.dec}</dd></div>
          <div><dt>EST. RANGE</dt><dd>${candidate.distance.toLocaleString()} LY</dd></div>
          <div><dt>BANDWIDTH</dt><dd>${candidate.bandwidth.toFixed(2)} Hz</dd></div>
          <div><dt>COHERENCE</dt><dd>${candidate.coherence}%</dd></div>
        </dl>
        <div class="forensic-confidence"><span>WORKING CONFIDENCE</span><strong>${confidence}%</strong><i><b style="width:${confidence}%"></b></i></div>
      </aside>

      <article class="world-module correction-stack">
        <header><span>CORRECTION STACK</span><b>${Object.values(state.lab.filters).filter(Boolean).length} ACTIVE</b></header>
        <div>
          ${[
            ['rfi', 'TERRESTRIAL RFI NOTCH', 'Reject known local emitters and horizon bursts.'],
            ['doppler', 'BARYCENTRIC DOPPLER', 'Correct Earth rotation and orbital radial velocity.'],
            ['phase', 'MULTI-BASELINE PHASE', 'Require phase agreement across independent dishes.'],
            ['fold', 'PERIOD FOLDING', 'Test whether the carrier repeats on a stable cadence.'],
          ].map(([id, label, copy]) => `<button type="button" data-toggle-filter="${id}" class="${state.lab.filters[id] ? 'active' : ''}"><i></i><span><b>${label}</b><small>${copy}</small></span><em>${state.lab.filters[id] ? 'ENGAGED' : 'STANDBY'}</em></button>`).join('')}
        </div>
      </article>

      <article class="world-module correlation-bay">
        <header><span>CROSS-CORRELATION BAY</span><b>${state.lab.correlation}% MATCH</b></header>
        <div class="correlation-plot"><canvas id="lab-correlation-canvas"></canvas><i style="left:${state.lab.correlation}%"></i></div>
        <p>Compare the candidate against the hydrogen line, known pulsars, local emitters, maser catalogues and previously recovered carriers. Evidence requires ${state.mission.sampleCount} samples, at least two corrections, a revisit and a committed chain.</p>
        <div><button type="button" data-lab-action="correlate">RUN CORRELATION</button><button type="button" data-lab-action="commit">COMMIT TO EVIDENCE</button></div>
      </article>
    </section>`;
}

function renderNavigation() {
  const sector = SKY_SECTORS.find((item) => item.id === state.selectedSector) || SKY_SECTORS[0];
  return `
    <section class="nav-world-grid">
      <article class="world-module celestial-map">
        <header><span>LIVE CELESTIAL SOLUTION</span><b>J2000 / BARYCENTRIC</b></header>
        <div class="celestial-stage">
          <div class="celestial-grid"></div><div class="celestial-equator"></div><div class="celestial-meridian"></div><div class="celestial-sweep"></div>
          ${SKY_SECTORS.map((item, index) => `<button type="button" data-select-sector="${item.id}" class="sky-sector ${item.id === sector.id ? 'active' : ''}" style="--x:${item.x}%;--y:${item.y}%;--delay:${index * -.5}s"><i></i><span>${item.name}<small>${item.visibility}% VISIBILITY</small></span></button>`).join('')}
          <div class="celestial-origin"><i></i><span>ARRAY 7</span></div>
          <div class="celestial-scale"><i></i><span>5,000 LY</span></div>
        </div>
        <footer><span>LOCAL SIDEREAL <b id="nav-lst">--:--:--</b></span><span>PARALLAX BASELINE 5,412 km</span><span>PRECESSION MODEL IAU 2006</span></footer>
      </article>

      <aside class="world-module vector-inspector">
        <header><span>SELECTED SKY VECTOR</span><b>${sector.risk}</b></header>
        <h3>${state.activeTarget.name}</h3>
        <div class="vector-compass"><i style="--bearing:${state.astronomy.azimuthDeg}deg"></i><b>N</b><span>E</span><em>S</em><small>W</small></div>
        <dl>
          <div><dt>ALTITUDE</dt><dd>${state.astronomy.altitudeDeg.toFixed(1)}°</dd></div>
          <div><dt>AZIMUTH</dt><dd>${state.astronomy.azimuthDeg.toFixed(1)}°</dd></div>
          <div><dt>OBSERVING WINDOW</dt><dd>${state.astronomy.windowLabel}</dd></div>
          <div><dt>VISIBILITY</dt><dd>${state.astronomy.visible ? 'VISIBLE' : 'BELOW LIMIT'}</dd></div>
          <div><dt>AIR MASS</dt><dd>${Number.isFinite(state.astronomy.airMass) ? state.astronomy.airMass.toFixed(2) : '—'}</dd></div>
        </dl>
        <button type="button" data-nav-action="schedule">SCHEDULE OBSERVATION <b>→</b></button>
      </aside>

      <article class="world-module baseline-console">
        <header><span>BASELINE GEOMETRY</span><b>${state.navigation.baseline}</b></header>
        <div class="baseline-choices">
          ${['COMPACT', 'LONG', 'POLAR'].map((name) => `<button type="button" data-baseline="${name}" class="${state.navigation.baseline === name ? 'active' : ''}"><i></i><span>${name}</span><small>${name === 'COMPACT' ? 'Sensitivity first' : name === 'LONG' ? 'Maximum angular resolution' : 'Declination stability'}</small></button>`).join('')}
        </div>
        <canvas id="baseline-canvas"></canvas>
      </article>

      <article class="world-module observation-queue">
        <header><span>OBSERVATION QUEUE</span><b>${state.navigation.scheduled.length} SCHEDULED</b></header>
        <div>${state.navigation.scheduled.length ? state.navigation.scheduled.map((item, index) => `<article><i>${String(index + 1).padStart(2, '0')}</i><span><b>${item.name}</b><small>${item.window} / ${item.baseline} BASELINE</small></span><em>${item.time}</em></article>`).join('') : '<p class="world-empty">No target has been committed to the observation queue.</p>'}</div>
        <button type="button" data-nav-action="optimize">OPTIMISE NIGHT SCHEDULE <b>→</b></button>
      </article>
    </section>`;
}

function renderVault() {
  const candidate = selectedCandidate();
  return `
    <section class="vault-world-grid">
      <article class="world-module evidence-board">
        <header><span>DISCOVERY EVIDENCE BOARD</span><b>${state.vault.entries.length} SEALED ITEMS</b></header>
        <div class="evidence-thread" aria-hidden="true"></div>
        <div class="evidence-cards">
          <article><i>01</i><span>RAW CARRIER</span><b>${candidate.id}</b><small>${formatGHz(candidate.frequencyMHz)} / immutable sample reference</small></article>
          <article><i>02</i><span>ARRAY AGREEMENT</span><b>${candidate.coherence}%</b><small>Independent phase agreement across available baselines</small></article>
          <article><i>03</i><span>CORRELATION</span><b>${state.lab.correlation}%</b><small>Closest match after the active forensic correction stack</small></article>
          <article><i>04</i><span>OBSERVATION VECTOR</span><b>${SKY_SECTORS.find((item) => item.id === state.selectedSector)?.name || 'UNSET'}</b><small>Current celestial solution and planned revisit window</small></article>
          <article><i>05</i><span>OPERATOR STATUS</span><b>${state.vault.sealed ? 'SEALED' : 'OPEN'}</b><small>Local evidence chain ${state.vault.sealed ? 'locked against accidental edits' : 'accepting annotations'}</small></article>
        </div>
      </article>

      <aside class="world-module chain-custody">
        <header><span>CHAIN OF CUSTODY</span><b>LOCAL SESSION</b></header>
        <div>${state.vault.entries.length ? state.vault.entries.slice().reverse().map((entry, index) => `<article><i>${String(index + 1).padStart(2, '0')}</i><span><b>${entry.title}</b><small>${entry.detail}</small></span><time>${entry.time}</time></article>`).join('') : '<p class="world-empty">No forensic result has been committed yet.</p>'}</div>
      </aside>

      <article class="world-module operator-notebook">
        <header><span>OPERATOR NOTEBOOK</span><b>${state.vault.sealed ? 'READ ONLY' : 'AUTOSAVED'}</b></header>
        <textarea id="vault-notes" ${state.vault.sealed ? 'readonly' : ''} placeholder="Record hypotheses, rejected explanations, telescope conditions and the next decisive observation...">${state.vault.notes}</textarea>
        <footer><span id="vault-note-count">${state.vault.notes.length} CHARACTERS</span><span>STORED LOCALLY</span></footer>
      </article>

      <article class="world-module provenance-ledger">
        <header><span>PROVENANCE LEDGER</span><b>SHA-256 SNAPSHOT</b></header>
        <dl>
          <div><dt>SESSION</dt><dd>${getSessionSuffix()}</dd></div>
          <div><dt>CANDIDATE</dt><dd>${candidate.id}</dd></div>
          <div><dt>ACTIVE FILTERS</dt><dd>${Object.entries(state.lab.filters).filter(([, active]) => active).map(([name]) => name.toUpperCase()).join(', ') || 'NONE'}</dd></div>
          <div><dt>EVENT COUNT</dt><dd>${state.eventLog.length}</dd></div>
          <div><dt>LAST CHANGE</dt><dd>${state.eventLog[0]?.time || '--:--:--'} UTC</dd></div>
        </dl>
        <div><button type="button" data-vault-action="export">EXPORT SESSION JSON</button><button type="button" data-vault-action="seal" ${state.vault.sealed ? 'disabled' : ''}>${state.vault.sealed ? 'SESSION SEALED' : 'SEAL EVIDENCE CHAIN'}</button></div>
      </article>

      <article class="world-module vault-event-stream">
        <header><span>COMPLETE EVENT CHRONOLOGY</span><b>${state.eventLog.length} ENTRIES</b></header>
        <div>${state.eventLog.slice(0, 12).map((event) => `<p data-severity="${event.severity}"><i></i><time>${event.time}</time><span><b>${event.title}</b><small>${event.message}</small></span></p>`).join('')}</div>
      </article>
    </section>`;
}

function renderSystems() {
  const spaceWeather = state.sources.spaceWeather;
  const astronomy = state.sources.astronomy;
  const activeCommand = state.commands.find((command) => ['QUEUED', 'RUNNING'].includes(command.status));
  const evidence = selectDecodeEvidence(rootState);
  return `
    <section class="systems-world-grid">
      <article class="world-module systems-provenance">
        <header><span>DATA SOURCE REGISTRY</span><b>PROVENANCE VISIBLE</b></header>
        <div class="source-registry">
          <article data-source-status="${spaceWeather.status}"><i></i><span><b>${spaceWeather.source}</b><small>Solar wind, IMF, Bz and Kp / ${spaceWeather.sourceTimestamp || 'no source timestamp'}</small></span><em>${spaceWeather.status}</em></article>
          <article data-source-status="${astronomy.status}"><i></i><span><b>${astronomy.source}</b><small>Sidereal time, altitude, azimuth and Sun altitude / ${state.station.coordinates.label}</small></span><em>${astronomy.status}</em></article>
        </div>
        <p class="scientific-note">Deep Space Array 7 is fictional. Coordinates are configured solely for the simulation. “14,000 years” describes signal travel time, not proven continuous broadcasting duration.</p>
      </article>
      <article class="world-module resource-console">
        <header><span>RESOURCE ENVELOPE</span><b>COUPLED</b></header>
        <dl>
          <div><dt>MAIN POWER</dt><dd>${state.resources.mainPower.toFixed(1)}%</dd></div>
          <div><dt>RESERVE POWER</dt><dd>${state.resources.reservePower.toFixed(1)}%</dd></div>
          <div><dt>CRYOGENIC RESERVE</dt><dd>${state.resources.cryogenicReserve.toFixed(1)}%</dd></div>
          <div><dt>THERMAL LOAD</dt><dd>${state.resources.thermalLoad.toFixed(1)}%</dd></div>
          <div><dt>DATA BUFFER</dt><dd>${state.resources.dataBuffer.toFixed(1)}%</dd></div>
          <div><dt>PROCESSING LOAD</dt><dd>${state.resources.processingLoad.toFixed(1)}%</dd></div>
        </dl>
      </article>
      <article class="world-module render-console">
        <header><span>RENDER QUALITY</span><b>${state.render.quality}</b></header>
        <div class="baseline-choices">
          ${['HIGH', 'BALANCED', 'BATTERY', 'REDUCED_MOTION'].map((quality) => `<button type="button" data-quality="${quality}" class="${state.render.quality === quality ? 'active' : ''}"><i></i><span>${quality}</span><small>${quality === 'HIGH' ? '60 FPS target / DPR 2' : quality === 'BALANCED' ? '30 FPS target / adaptive detail' : quality === 'BATTERY' ? 'Low-power canvases / DPR 1' : 'Static scientific views'}</small></button>`).join('')}
        </div>
      </article>
      <article class="world-module command-sequence">
        <header><span>COMMAND BUS</span><b>${activeCommand ? activeCommand.status : 'IDLE'}</b></header>
        <div>${activeCommand ? `<p><time>${Math.round(activeCommand.progress * 100)}%</time><span>${activeCommand.label}</span><b>${activeCommand.id}</b></p>` : '<p class="world-empty">The observatory command bus is clear.</p>'}</div>
        <button type="button" data-array-action="diagnostic">RUN FULL ARRAY DIAGNOSTIC <b>→</b></button>
      </article>
      <article class="world-module provenance-ledger">
        <header><span>INTEGRITY + PERSISTENCE</span><b>${rootState.sessionMode.mode}</b></header>
        <dl>
          <div><dt>DECODE READY</dt><dd>${selectDecodeReady(rootState) ? 'YES' : 'NO'}</dd></div>
          ${Object.entries(evidence).map(([key, complete]) => `<div><dt>${key.toUpperCase()}</dt><dd>${complete ? 'VERIFIED' : 'PENDING'}</dd></div>`).join('')}
          <div><dt>SESSION STORAGE</dt><dd>${rootState.sessionMode.durable ? 'DURABLE' : 'LOCAL ONLY'}</dd></div>
        </dl>
      </article>
    </section>`;
}

function getSessionSuffix() {
  try {
    return sessionStorage.getItem('tls:session-id:v1')?.slice(-12) || 'UNRESOLVED';
  } catch {
    return 'UNRESOLVED';
  }
}

function handleWorldClick(event) {
  const tab = event.target.closest('[data-world-tab]');
  if (tab) {
    state.selectedWorld = tab.dataset.worldTab;
    persist();
    renderWorld();
    return;
  }
  const dish = event.target.closest('[data-select-dish]');
  if (dish) { state.selectedDish = dish.dataset.selectDish; persist(); renderWorld(); return; }
  const candidate = event.target.closest('[data-select-candidate]');
  if (candidate) {
    state.selectedCandidate = candidate.dataset.selectCandidate;
    state.activeTarget = { ...findCatalogTarget(state.selectedCandidate) };
    state.mission.stage = 'TARGET_SELECTED';
    state.mission.integrationSeconds = 0;
    state.lab.confidenceBonus = 0;
    queueCommand(state, 'SLEW_TARGET', { targetId: state.selectedCandidate });
    persist(); renderWorld(); return;
  }
  const sector = event.target.closest('[data-select-sector]');
  if (sector) {
    state.selectedSector = sector.dataset.selectSector;
    const sectorIndex = Math.max(0, SKY_SECTORS.findIndex((item) => item.id === state.selectedSector));
    const target = SIGNAL_CANDIDATES[sectorIndex % SIGNAL_CANDIDATES.length];
    state.selectedCandidate = target.id;
    state.activeTarget = { ...findCatalogTarget(target.id) };
    state.mission.stage = 'TARGET_SELECTED';
    state.mission.integrationSeconds = 0;
    queueCommand(state, 'SLEW_TARGET', { targetId: target.id });
    persist(); renderWorld(); return;
  }
  const filter = event.target.closest('[data-toggle-filter]');
  if (filter) {
    const command = {
      rfi: 'APPLY_RFI',
      doppler: 'APPLY_DOPPLER',
      phase: 'APPLY_PHASE',
      fold: 'APPLY_FOLD',
    }[filter.dataset.toggleFilter];
    const result = queueCommand(state, command, { candidateId: state.selectedCandidate });
    toast(result.accepted ? `${result.command.label} queued.` : 'That correction is already running.', result.accepted ? 'info' : 'warning');
    persist(); renderWorld(); return;
  }
  const action = event.target.closest('[data-array-action]');
  if (action) { runArrayAction(action.dataset.arrayAction); return; }
  const labAction = event.target.closest('[data-lab-action]');
  if (labAction) { runLabAction(labAction.dataset.labAction); return; }
  const navAction = event.target.closest('[data-nav-action]');
  if (navAction) { runNavigationAction(navAction.dataset.navAction); return; }
  const baseline = event.target.closest('[data-baseline]');
  if (baseline) {
    state.navigation.baseline = baseline.dataset.baseline;
    state.array.baseline = baseline.dataset.baseline;
    addEvent('BASELINE GEOMETRY CHANGED', `${baseline.dataset.baseline} array geometry selected for the next integration.`, 'info');
    persist(); renderWorld(); return;
  }
  const vaultAction = event.target.closest('[data-vault-action]');
  if (vaultAction) { runVaultAction(vaultAction.dataset.vaultAction); return; }
  const quality = event.target.closest('[data-quality]')?.dataset.quality;
  if (quality) {
    state.render.quality = quality;
    rootState.settings.renderQuality = quality;
    rootState.settings.reducedMotion = quality === 'REDUCED_MOTION';
    document.documentElement.classList.toggle('motion-reduced', rootState.settings.reducedMotion);
    document.dispatchEvent(new CustomEvent('tls:render-quality', { detail: { quality } }));
    persist();
    renderWorld();
  }
}

function handleWorldInput(event) {
  if (event.target.id !== 'vault-notes' || state.vault.sealed) return;
  state.vault.notes = event.target.value.slice(0, 5000);
  const count = $('#vault-note-count', worldOverlay);
  if (count) count.textContent = `${state.vault.notes.length} CHARACTERS`;
  persist();
}

function recordArrayAction(label, result) {
  state.array.actions.unshift({ time: nowCode(), label, result });
  state.array.actions = state.array.actions.slice(0, 8);
}

function runArrayAction(action) {
  const dish = ARRAY_NODES.find((item) => item.id === state.selectedDish) || ARRAY_NODES[0];
  const type = {
    calibrate: 'CALIBRATE_BASELINES',
    cryo: 'FLUSH_CRYO',
    power: 'REROUTE_POWER',
    park: 'PARK_DISH',
    diagnostic: 'FULL_DIAGNOSTIC',
  }[action];
  const result = queueCommand(state, type, { dishId: dish.id });
  if (result.accepted) {
    recordArrayAction(result.command.label, 'QUEUED');
    toast(`${result.command.label} queued on the timed command bus.`, 'info');
  } else {
    toast('That command is already queued or running.', 'warning');
  }
  persist(); renderWorld();
}

function runLabAction(action) {
  const candidate = selectedCandidate();
  if (action === 'correlate') {
    const result = queueCommand(state, 'RUN_CORRELATION', { candidateId: candidate.id });
    toast(result.accepted ? 'Catalogue correlation queued.' : 'Correlation is already running.', result.accepted ? 'info' : 'warning');
  } else if (action === 'commit') {
    const result = queueCommand(state, 'COMMIT_EVIDENCE', { candidateId: candidate.id });
    toast(
      result.accepted ? 'Evidence commit queued; prerequisites will be validated on completion.' : 'Evidence commit is already running.',
      result.accepted ? 'info' : 'warning',
    );
  }
  persist(); renderWorld();
}

function runNavigationAction(action) {
  const sector = SKY_SECTORS.find((item) => item.id === state.selectedSector) || SKY_SECTORS[0];
  if (action === 'schedule') {
    const result = queueCommand(state, 'SCHEDULE_REVISIT', { sectorId: sector.id });
    toast(result.accepted ? `${sector.name} revisit queued.` : 'That revisit is already queued.', result.accepted ? 'info' : 'warning');
  } else if (action === 'optimize') {
    const result = queueCommand(state, 'CONFIRM_REVISIT', { sectorId: sector.id });
    toast(result.accepted ? 'Independent revisit confirmation queued.' : 'Revisit confirmation is already running.', result.accepted ? 'info' : 'warning');
  }
  persist(); renderWorld();
}

function runVaultAction(action) {
  if (action === 'seal') {
    state.vault.sealed = true;
    addEvent('EVIDENCE CHAIN SEALED', 'Operator notebook and committed results were frozen for this local session.', 'signal');
    toast('Evidence chain sealed.', 'success');
    persist(); renderWorld();
  } else if (action === 'export') {
    const payload = {
      exportedAt: new Date().toISOString(),
      session: getSessionSuffix(),
      observatory: 'Deep Space Array 7',
      state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `last-signal-session-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    addEvent('SESSION SNAPSHOT EXPORTED', 'A complete local observatory snapshot was generated as JSON.', 'nominal');
    toast('Session snapshot exported.', 'success');
  }
}

function drawWorldCanvases(world) {
  if (!worldOverlay || worldOverlay.hidden) return;
  if (world === 'live-ops') drawArrayLinks();
  if (world === 'lab') { drawLabSpectrum(); drawCorrelation(); }
  if (world === 'sky') drawBaseline();
}

function fitCanvas(canvas) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const dprCap = state.render.quality === 'BATTERY' ? 1 : state.render.quality === 'BALANCED' ? 1.5 : 2;
  const ratio = Math.min(window.devicePixelRatio || 1, dprCap);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio; canvas.height = height * ratio;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
}

function drawArrayLinks() {
  const canvas = $('#array-link-canvas', worldOverlay);
  const fitted = fitCanvas(canvas); if (!fitted) return;
  const { ctx, width, height } = fitted;
  ctx.clearRect(0, 0, width, height);
  const cx = width / 2, cy = height / 2;
  ARRAY_NODES.forEach((node, index) => {
    const angle = (node.bearing - 90) * Math.PI / 180;
    const radius = Math.min(width, height) * (index % 2 ? .32 : .39);
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const gradient = ctx.createLinearGradient(cx, cy, x, y);
    gradient.addColorStop(0, 'rgba(67,235,201,.7)'); gradient.addColorStop(1, 'rgba(54,219,232,.08)');
    ctx.strokeStyle = gradient; ctx.lineWidth = index === 0 ? 1.4 : .7;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
  });
}

function drawLabSpectrum() {
  const canvas = $('#lab-spectrum-canvas', worldOverlay);
  const fitted = fitCanvas(canvas); if (!fitted) return;
  const { ctx, width, height } = fitted;
  const candidate = selectedCandidate();
  const active = Object.values(state.lab.filters).filter(Boolean).length;
  const time = performance.now();
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(51,117,133,.19)'; ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 38) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  for (let y = 0; y < height; y += 34) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, 'rgba(41,157,189,.48)'); gradient.addColorStop(.5, 'rgba(77,237,218,.96)'); gradient.addColorStop(1, 'rgba(220,166,65,.55)');
  ctx.strokeStyle = gradient; ctx.lineWidth = 1.2; ctx.shadowBlur = 9; ctx.shadowColor = 'rgba(54,219,232,.28)'; ctx.beginPath();
  for (let x = 0; x <= width; x += 2) {
    const normalized = x / width;
    const carrier = Math.exp(-((normalized - .53) ** 2) / (.00018 + candidate.bandwidth * .000012)) * (height * .58);
    const sideband = Math.exp(-((normalized - .59) ** 2) / .00034) * height * .18;
    const deterministicNoise = Math.sin(x * 1.91 + time * .007) * .5 + Math.sin(x * .173 - time * .003) * .5;
    const noise = (Math.sin(x * .41 + time * .004) + Math.sin(x * .083 - time * .002)) * (7 - active * .9) + deterministicNoise * (11 - active);
    const y = height * .76 - carrier - sideband + noise;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke(); ctx.shadowBlur = 0;
  if (state.render.quality !== 'REDUCED_MOTION' && !document.hidden) worldCanvasFrame = requestAnimationFrame(drawLabSpectrum);
}

function drawCorrelation() {
  const canvas = $('#lab-correlation-canvas', worldOverlay);
  const fitted = fitCanvas(canvas); if (!fitted) return;
  const { ctx, width, height } = fitted;
  ctx.clearRect(0, 0, width, height);
  for (let i = 0; i < 44; i += 1) {
    const x = i / 43 * width;
    const match = Math.exp(-((i - 27) ** 2) / 22) * state.lab.correlation / 100;
    const bar = 6 + Math.abs(Math.sin(i * 2.71)) * 13 + match * (height - 20);
    ctx.fillStyle = i === 27 ? 'rgba(221,166,65,.9)' : 'rgba(54,219,232,.32)';
    ctx.fillRect(x, height - bar, Math.max(1, width / 70), bar);
  }
}

function drawBaseline() {
  const canvas = $('#baseline-canvas', worldOverlay);
  const fitted = fitCanvas(canvas); if (!fitted) return;
  const { ctx, width, height } = fitted;
  ctx.clearRect(0, 0, width, height);
  const center = { x: width / 2, y: height / 2 };
  const spread = state.navigation.baseline === 'COMPACT' ? .22 : state.navigation.baseline === 'LONG' ? .42 : .34;
  ARRAY_NODES.forEach((node, index) => {
    const angle = (node.bearing - 90) * Math.PI / 180;
    const x = center.x + Math.cos(angle) * Math.min(width, height) * spread;
    const y = center.y + Math.sin(angle) * Math.min(width, height) * spread;
    ctx.strokeStyle = 'rgba(54,219,232,.26)'; ctx.beginPath(); ctx.moveTo(center.x, center.y); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = index === 0 ? 'rgba(221,166,65,.95)' : 'rgba(67,235,201,.85)'; ctx.beginPath(); ctx.arc(x, y, index === 0 ? 4 : 3, 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = 'rgba(236,249,249,.9)'; ctx.beginPath(); ctx.arc(center.x, center.y, 4, 0, Math.PI * 2); ctx.fill();
}

function updateLiveTelemetry() {
  const date = new Date(state.clock.utcMs);
  const utc = date.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' });
  const lst = state.sources.astronomy.value?.lst || '--:--:--';
  const solar = state.environment.solarWindSpeed;
  const coherence = state.receiver.coherence;
  const drift = rootState.telemetry.signal ? Math.sin(state.clock.elapsedMs * .00017) * .84 : 0;
  if ($('#obs-utc')) $('#obs-utc').textContent = utc;
  if ($('#obs-lst')) $('#obs-lst').textContent = lst;
  if ($('#obs-bary')) $('#obs-bary').textContent = `${state.astronomy.altitudeDeg.toFixed(1)}° / ${state.astronomy.azimuthDeg.toFixed(1)}°`;
  if ($('#obs-solar')) $('#obs-solar').textContent = `${Math.round(solar)} km/s`;
  if ($('#obs-source-state')) $('#obs-source-state').textContent = state.sources.spaceWeather.status === 'LIVE' ? 'NOAA' : 'SIM';
  if ($('#obs-clock')) $('#obs-clock').textContent = `${state.array.clockOffsetNs.toFixed(1)} ns`;
  if ($('#obs-coherence')) $('#obs-coherence').textContent = `COHERENCE ${coherence.toFixed(2)}`;
  if ($('#obs-drift')) $('#obs-drift').textContent = `DRIFT ${drift >= 0 ? '+' : ''}${drift.toFixed(2)} Hz/s`;
  if ($('#world-clock')) $('#world-clock').textContent = `${utc} UTC`;
  if ($('#nav-lst')) $('#nav-lst').textContent = lst;
  if ($('#world-bus')) $('#world-bus').textContent = `${(11.8 + coherence * 2.4).toFixed(1)} Gb/s`;
  document.documentElement.style.setProperty('--observatory-pulse', coherence.toFixed(3));
  if ($('#mission-stage')) $('#mission-stage').textContent = state.mission.stage;
  if ($('#mission-target-state')) $('#mission-target-state').textContent = state.mission.integrationSeconds >= state.mission.requiredIntegrationSeconds ? 'SAMPLED' : `${Math.round(state.array.slewProgress * 100)}%`;
  if ($('#mission-lab-state')) $('#mission-lab-state').textContent = `${state.mission.correctionsApplied}/2`;
  if ($('#mission-revisit-state')) $('#mission-revisit-state').textContent = state.mission.revisitConfirmed ? 'CONFIRMED' : state.mission.revisitScheduled ? 'QUEUED' : 'WAIT';
  if ($('#mission-evidence-state')) $('#mission-evidence-state').textContent = state.mission.evidenceCommitted ? 'COMMITTED' : 'SEALED';

  const currentCarrier = $('#signal-id')?.textContent?.trim() || '';
  if (currentCarrier.startsWith('TLS-') && currentCarrier !== 'TLS-UNRESOLVED' && currentCarrier !== lastKnownCarrier) {
    lastKnownCarrier = currentCarrier;
    addEvent('MAIN RECEIVER CONTACT', `${currentCarrier} entered the active transmission panel.`, 'signal');
  }
  const activeCommand = state.commands.find((command) => ['QUEUED', 'RUNNING'].includes(command.status));
  document.body.dataset.commandState = activeCommand?.status || 'IDLE';
  document.body.dataset.commandType = activeCommand?.type || '';
  const fingerprint = `${activeCommand?.id || 'idle'}:${activeCommand?.status || 'idle'}:${Math.round((activeCommand?.progress || 0) * 10)}`;
  if (fingerprint !== lastCommandFingerprint && worldOverlay && !worldOverlay.hidden && document.activeElement?.id !== 'vault-notes') {
    lastCommandFingerprint = fingerprint;
    renderWorld();
  }
  updateTicker();
}

function updateTicker() {
  const event = state.eventLog[0] || INCIDENT_LIBRARY[0];
  const label = $('#obs-ticker-label');
  const message = $('#obs-ticker-message');
  if (label) label.textContent = event.title;
  if (message) message.textContent = event.message;
  const ticker = $('.observatory-event-ticker');
  if (ticker) ticker.dataset.severity = event.severity;
}

function trapOverlayFocus(event) {
  if (event.key === 'Escape' && worldOverlay && !worldOverlay.hidden) { closeWorld(); return; }
  if (event.key.toLowerCase() === 'o' && !event.metaKey && !event.ctrlKey && !event.altKey && !/input|textarea|select/i.test(event.target.tagName)) {
    if (worldOverlay && !worldOverlay.hidden) closeWorld(); else openWorld(state.selectedWorld, document.activeElement);
    return;
  }
  if (event.key !== 'Tab' || !worldOverlay || worldOverlay.hidden) return;
  const focusable = $$('button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', worldOverlay).filter((node) => node.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function waitForMainApp() {
  const app = $('#app');
  if (app?.classList.contains('ready')) { initialiseExpansion(); return; }
  const observer = new MutationObserver(() => {
    if (app?.classList.contains('ready')) { observer.disconnect(); initialiseExpansion(); }
  });
  if (app) observer.observe(app, { attributes: true, attributeFilter: ['class'] });
  else setTimeout(waitForMainApp, 100);
}

function initialiseExpansion() {
  if (document.body.dataset.observatoryExpansionReady) return;
  document.body.dataset.observatoryExpansionReady = 'true';
  injectNavigation();
  injectLiveInstrumentation();
  createWorldOverlay();
  updateLiveTelemetry();
  updateTicker();
  setInterval(updateLiveTelemetry, 1000);
  document.addEventListener('keydown', trapOverlayFocus);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(worldCanvasFrame);
    else if (worldOverlay && !worldOverlay.hidden) drawWorldCanvases(state.selectedWorld);
  });
}

waitForMainApp();
