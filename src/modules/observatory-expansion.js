import {
  ARRAY_NODES,
  INCIDENT_LIBRARY,
  OBSERVATORY_WORLDS,
  SIGNAL_CANDIDATES,
  SKY_SECTORS,
} from './observatory-data.js';

const STORAGE_KEY = 'tls:observatory-expansion:v1';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const formatGHz = (mhz) => mhz >= 1000 ? `${(mhz / 1000).toFixed(6)} GHz` : `${mhz.toFixed(6)} MHz`;

const DEFAULT_STATE = {
  version: 1,
  cycle: 7,
  selectedWorld: 'array',
  selectedDish: 'DISH-01',
  selectedCandidate: 'CND-19K-204',
  selectedSector: 'aquila',
  array: {
    integrity: 96.4,
    phaseError: 0.82,
    cryoReserve: 74,
    reservePower: 31,
    actions: [],
  },
  lab: {
    filters: { rfi: false, doppler: false, phase: false, fold: false },
    correlation: 21,
    confidenceBonus: 0,
    committed: [],
  },
  navigation: {
    scheduled: [],
    baseline: 'LONG',
  },
  vault: {
    notes: '',
    sealed: false,
    entries: [],
  },
  eventLog: [
    { time: '00:00:02', severity: 'nominal', title: 'OBSERVATION CYCLE 07', message: 'Array 7 entered autonomous deep-field listening mode.' },
  ],
};

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed || parsed.version !== 1) return structuredClone(DEFAULT_STATE);
    return {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      array: { ...DEFAULT_STATE.array, ...(parsed.array || {}) },
      lab: {
        ...DEFAULT_STATE.lab,
        ...(parsed.lab || {}),
        filters: { ...DEFAULT_STATE.lab.filters, ...(parsed.lab?.filters || {}) },
      },
      navigation: { ...DEFAULT_STATE.navigation, ...(parsed.navigation || {}) },
      vault: { ...DEFAULT_STATE.vault, ...(parsed.vault || {}) },
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

const state = loadState();
let worldOverlay = null;
let lastFocused = null;
let incidentIndex = 0;
let lastKnownCarrier = '';
let worldCanvasFrame = null;

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function nowCode() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' });
}

function addEvent(title, message, severity = 'info') {
  state.eventLog.unshift({ time: nowCode(), title, message, severity });
  state.eventLog = state.eventLog.slice(0, 30);
  persist();
  updateTicker();
  if (worldOverlay && !worldOverlay.hidden && state.selectedWorld === 'array') renderWorld();
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
    array: '<circle cx="12" cy="12" r="8"/><path d="M4 14c5-.5 9-4.5 10-10M7 18c5-1 10-6 11-11"/><circle cx="6" cy="16" r="1.4"/>',
    lab: '<path d="M3 12h3l2-6 4 12 3-9 3 6h3"/><path d="M4 20h16"/>',
    nav: '<circle cx="12" cy="12" r="9"/><path d="m12 4 2.1 5.9L20 12l-5.9 2.1L12 20l-2.1-5.9L4 12l5.9-2.1L12 4Z"/>',
    vault: '<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h6M8 16h4"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[type]}</svg>`;
}

function injectNavigation() {
  const nav = $('.main-nav');
  if (!nav || nav.dataset.observatoryExpanded) return;
  nav.dataset.observatoryExpanded = 'true';
  const divider = document.createElement('div');
  divider.className = 'observatory-nav-divider';
  divider.innerHTML = '<span>OBSERVATORY DECKS</span><i></i>';
  nav.append(divider);

  for (const world of OBSERVATORY_WORLDS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'observatory-nav-button';
    button.dataset.observatoryWorld = world.id;
    button.innerHTML = `${svgIcon(world.id)}<span>${world.short}</span><small>${world.index}</small>`;
    button.addEventListener('click', (event) => {
      event.stopImmediatePropagation();
      openWorld(world.id, button);
    });
    nav.append(button);
  }
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
      <div><span>BARYCENTRIC Δ</span><b id="obs-bary">+0.00 km/s</b></div>
      <div><span>SOLAR WIND</span><b id="obs-solar">--- km/s</b></div>
      <div><span>CLOCK OFFSET</span><b id="obs-clock">-- ns</b></div>
      <button type="button" data-open-observatory="array"><i></i><span>OBSERVATORY LIVE</span><small>CYCLE ${String(state.cycle).padStart(2, '0')}</small></button>`;
    header.append(strip);
    $('[data-open-observatory="array"]', strip).addEventListener('click', (event) => openWorld('array', event.currentTarget));
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
      <header><span>CONNECTED DECKS</span><b>04</b></header>
      <div>${OBSERVATORY_WORLDS.map((world) => `<button type="button" data-open-observatory="${world.id}"><i>${world.index}</i><span>${world.label}</span><b>→</b></button>`).join('')}</div>`;
    rightRail.append(launcher);
    $$('[data-open-observatory]', launcher).forEach((button) => button.addEventListener('click', () => openWorld(button.dataset.openObservatory, button)));
  }

  const footer = $('.status-footer');
  if (footer && !$('.observatory-event-ticker', footer)) {
    const ticker = document.createElement('button');
    ticker.type = 'button';
    ticker.className = 'observatory-event-ticker';
    ticker.dataset.openObservatory = 'array';
    ticker.innerHTML = '<i></i><span id="obs-ticker-label">ARRAY EVENT</span><b id="obs-ticker-message">Waiting for operations telemetry...</b><em>OPEN DECK</em>';
    ticker.addEventListener('click', () => openWorld('array', ticker));
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
  const valid = OBSERVATORY_WORLDS.some((world) => world.id === worldId) ? worldId : 'array';
  state.selectedWorld = valid;
  persist();
  lastFocused = trigger || document.activeElement;
  worldOverlay = createWorldOverlay();
  worldOverlay.hidden = false;
  document.body.classList.add('observatory-world-open');
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
  lastFocused?.focus?.();
}

function renderWorld() {
  if (!worldOverlay) return;
  const world = OBSERVATORY_WORLDS.find((item) => item.id === state.selectedWorld) || OBSERVATORY_WORLDS[0];
  $$('[data-world-tab]', worldOverlay).forEach((button) => button.classList.toggle('active', button.dataset.worldTab === world.id));
  $('#observatory-world-index', worldOverlay).textContent = `${world.index} / ${world.id === 'array' ? 'OPERATIONS' : world.id === 'lab' ? 'ANALYSIS' : world.id === 'nav' ? 'ASTROMETRY' : 'PROVENANCE'}`;
  $('#observatory-world-title', worldOverlay).textContent = world.label;
  $('#observatory-world-description', worldOverlay).textContent = {
    array: 'Live control of the six-dish interferometric array and its physical subsystems.',
    lab: 'Forensic isolation, correction and classification of every suspicious carrier.',
    nav: 'Sky-vector planning, baseline geometry and observation-window scheduling.',
    vault: 'Persistent evidence, operator annotations and the complete chain of discovery.',
  }[world.id];
  $('#world-integrity', worldOverlay).textContent = `${state.array.integrity.toFixed(1)}%`;
  $('#world-event-count', worldOverlay).textContent = String(state.eventLog.length);
  const content = $('#observatory-world-content', worldOverlay);
  content.innerHTML = world.id === 'array' ? renderArrayCore() : world.id === 'lab' ? renderSignalLab() : world.id === 'nav' ? renderNavigation() : renderVault();
  cancelAnimationFrame(worldCanvasFrame);
  requestAnimationFrame(() => drawWorldCanvases(world.id));
}

function renderArrayCore() {
  const dish = ARRAY_NODES.find((item) => item.id === state.selectedDish) || ARRAY_NODES[0];
  const actions = state.array.actions.slice(0, 5);
  return `
    <section class="array-world-grid">
      <article class="world-module array-topology">
        <header><span>INTERFEROMETRIC TOPOLOGY</span><b>6 / 6 NODES LINKED</b></header>
        <div class="array-field">
          <div class="array-range range-a"></div><div class="array-range range-b"></div><div class="array-range range-c"></div>
          <div class="array-phase-beam"></div><div class="array-hub"><i></i><b>DSA-7</b><span>PHASE CORE</span></div>
          ${ARRAY_NODES.map((node, index) => `<button type="button" class="dish-node ${node.id === dish.id ? 'active' : ''}" data-select-dish="${node.id}" style="--angle:${node.bearing}deg;--radius:${index % 2 ? 38 : 45}%"><i></i><span>${node.id}<small>${node.health.toFixed(1)}%</small></span></button>`).join('')}
          <canvas id="array-link-canvas" aria-hidden="true"></canvas>
        </div>
        <footer><span>BASELINE ${state.navigation.baseline}</span><span>PHASE ERROR ${state.array.phaseError.toFixed(2)} mrad</span><span>INTEGRATION 18.4 s</span></footer>
      </article>

      <aside class="world-module dish-inspector">
        <header><span>SELECTED APERTURE</span><b>${dish.role}</b></header>
        <div class="dish-identity"><i></i><div><small>${dish.id}</small><strong>${dish.name}</strong></div></div>
        <dl>
          <div><dt>AZIMUTH</dt><dd>${dish.bearing.toFixed(1)}°</dd></div>
          <div><dt>ELEVATION</dt><dd>${dish.elevation.toFixed(1)}°</dd></div>
          <div><dt>SERVO HEALTH</dt><dd>${dish.health.toFixed(1)}%</dd></div>
          <div><dt>PHASE DELAY</dt><dd>${(dish.bearing / 91).toFixed(3)} ns</dd></div>
          <div><dt>WIND LOAD</dt><dd>${(12 + dish.elevation / 17).toFixed(1)}%</dd></div>
        </dl>
        <div class="dish-health-track"><i style="width:${dish.health}%"></i></div>
        <button type="button" data-array-action="park">PARK SELECTED DISH <b>→</b></button>
      </aside>

      <article class="world-module subsystem-rack">
        <header><span>PHYSICAL SUBSYSTEMS</span><b>LIVE CONTROL</b></header>
        <div class="subsystem-columns">
          <section><span>CRYOGENIC LOOP</span><strong>−${(194.8 + (100 - state.array.cryoReserve) * .018).toFixed(2)} °C</strong><div><i style="width:${state.array.cryoReserve}%"></i></div><small>${state.array.cryoReserve}% reserve / helium circuit nominal</small><button type="button" data-array-action="cryo">FLUSH RESERVE LOOP</button></section>
          <section><span>PHASE DISCIPLINE</span><strong>${state.array.phaseError.toFixed(2)} mrad</strong><div><i style="width:${clamp(100 - state.array.phaseError * 26, 5, 100)}%"></i></div><small>Atomic reference / six-node convergence</small><button type="button" data-array-action="calibrate">CALIBRATE BASELINES</button></section>
          <section><span>RESERVE POWER</span><strong>${state.array.reservePower}%</strong><div><i style="width:${state.array.reservePower}%"></i></div><small>Independent bus / receiver-first priority</small><button type="button" data-array-action="power">REROUTE POWER</button></section>
        </div>
      </article>

      <article class="world-module operations-stream">
        <header><span>OPERATIONS STREAM</span><b>${state.eventLog.length} EVENTS</b></header>
        <div>${state.eventLog.slice(0, 7).map((event) => `<article data-severity="${event.severity}"><i></i><time>${event.time}</time><span><b>${event.title}</b><small>${event.message}</small></span></article>`).join('')}</div>
      </article>

      <article class="world-module command-sequence">
        <header><span>RECENT COMMANDS</span><b>${actions.length ? 'COMMITTED' : 'IDLE'}</b></header>
        <div>${actions.length ? actions.map((action) => `<p><time>${action.time}</time><span>${action.label}</span><b>${action.result}</b></p>`).join('') : '<p class="world-empty">No manual command has been committed during this cycle.</p>'}</div>
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
        <p>Compare the candidate against the hydrogen line, known pulsars, local emitters, maser catalogues and previously recovered carriers.</p>
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
        <h3>${sector.name}</h3>
        <div class="vector-compass"><i style="--bearing:${sector.x * 2.8}deg"></i><b>N</b><span>E</span><em>S</em><small>W</small></div>
        <dl>
          <div><dt>VISIBILITY</dt><dd>${sector.visibility}%</dd></div>
          <div><dt>OBSERVING WINDOW</dt><dd>${sector.window}</dd></div>
          <div><dt>RANGE MARKER</dt><dd>${sector.range.toLocaleString()} LY</dd></div>
          <div><dt>FIELD CONDITION</dt><dd>${sector.risk}</dd></div>
          <div><dt>AIR MASS</dt><dd>${(1.04 + (100 - sector.visibility) / 73).toFixed(2)}</dd></div>
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
  if (candidate) { state.selectedCandidate = candidate.dataset.selectCandidate; state.lab.confidenceBonus = 0; persist(); renderWorld(); return; }
  const sector = event.target.closest('[data-select-sector]');
  if (sector) { state.selectedSector = sector.dataset.selectSector; persist(); renderWorld(); return; }
  const filter = event.target.closest('[data-toggle-filter]');
  if (filter) {
    state.lab.filters[filter.dataset.toggleFilter] = !state.lab.filters[filter.dataset.toggleFilter];
    addEvent('FORENSIC STACK UPDATED', `${filter.dataset.toggleFilter.toUpperCase()} correction ${state.lab.filters[filter.dataset.toggleFilter] ? 'engaged' : 'removed'}.`, 'info');
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
    addEvent('BASELINE GEOMETRY CHANGED', `${baseline.dataset.baseline} array geometry selected for the next integration.`, 'info');
    persist(); renderWorld(); return;
  }
  const vaultAction = event.target.closest('[data-vault-action]');
  if (vaultAction) runVaultAction(vaultAction.dataset.vaultAction);
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
  if (action === 'calibrate') {
    state.array.phaseError = clamp(state.array.phaseError * .43, .12, 3);
    state.array.integrity = clamp(state.array.integrity + 1.1, 0, 99.8);
    recordArrayAction('CALIBRATE BASELINES', `${state.array.phaseError.toFixed(2)} mrad`);
    addEvent('BASELINE CALIBRATION COMPLETE', `Phase disagreement reduced to ${state.array.phaseError.toFixed(2)} milliradians.`, 'nominal');
    toast('Six-node baseline calibration committed.', 'success');
  } else if (action === 'cryo') {
    state.array.cryoReserve = clamp(state.array.cryoReserve - 9, 8, 100);
    state.array.integrity = clamp(state.array.integrity + .5, 0, 99.8);
    recordArrayAction('FLUSH CRYO LOOP', `${state.array.cryoReserve}% reserve`);
    addEvent('CRYOGENIC RESERVE ENGAGED', 'Receiver temperature returned inside the narrowband stability envelope.', 'nominal');
    toast('Reserve cryogenic loop flushed.', 'success');
  } else if (action === 'power') {
    state.array.reservePower = clamp(state.array.reservePower - 7, 5, 100);
    state.array.integrity = clamp(state.array.integrity + .8, 0, 99.8);
    recordArrayAction('REROUTE POWER', `${state.array.reservePower}% reserve`);
    addEvent('POWER BUS REROUTED', 'Non-essential lighting was isolated; receiver gain now has priority.', 'info');
    toast('Power routed to receiver systems.', 'success');
  } else if (action === 'park') {
    recordArrayAction(`PARK ${dish.id}`, 'SAFE ELEVATION');
    addEvent('APERTURE PARK COMMAND', `${dish.id} moved to its low-wind safe elevation.`, 'warning');
    toast(`${dish.id} parked.`, 'info');
  } else if (action === 'diagnostic') {
    state.array.integrity = clamp(state.array.integrity - .2 + Math.random() * .8, 0, 99.8);
    recordArrayAction('FULL ARRAY DIAGNOSTIC', '6/6 PASS');
    addEvent('DIAGNOSTIC SEQUENCE COMPLETE', 'Servo, timing, cryogenic and receiver paths passed all local checks.', 'nominal');
    toast('Full array diagnostic passed.', 'success');
  }
  persist(); renderWorld();
}

function runLabAction(action) {
  const candidate = selectedCandidate();
  if (action === 'correlate') {
    const active = Object.values(state.lab.filters).filter(Boolean).length;
    const gain = 7 + active * 4 + Math.round(Math.random() * 8);
    state.lab.correlation = clamp(state.lab.correlation + gain, 1, 96);
    state.lab.confidenceBonus = clamp(state.lab.confidenceBonus + Math.max(2, active * 2), 0, 18);
    addEvent('CROSS-CORRELATION COMPLETE', `${candidate.id} reached a ${state.lab.correlation}% nearest-catalogue match.`, state.lab.correlation > 70 ? 'signal' : 'info');
    toast(`Correlation result: ${state.lab.correlation}% match.`, 'success');
  } else if (action === 'commit') {
    if (!state.lab.committed.includes(candidate.id)) state.lab.committed.push(candidate.id);
    const entry = {
      time: nowCode(),
      title: `${candidate.id} FORENSIC COMMIT`,
      detail: `${state.lab.correlation}% correlation / ${Object.values(state.lab.filters).filter(Boolean).length} corrections active`,
    };
    state.vault.entries.unshift(entry);
    state.vault.entries = state.vault.entries.slice(0, 20);
    addEvent('EVIDENCE ITEM COMMITTED', `${candidate.id} analysis entered the local provenance chain.`, 'signal');
    toast('Forensic result committed to Evidence Vault.', 'success');
  }
  persist(); renderWorld();
}

function runNavigationAction(action) {
  const sector = SKY_SECTORS.find((item) => item.id === state.selectedSector) || SKY_SECTORS[0];
  if (action === 'schedule') {
    if (!state.navigation.scheduled.some((item) => item.id === sector.id)) {
      state.navigation.scheduled.push({ ...sector, baseline: state.navigation.baseline, time: nowCode() });
      addEvent('OBSERVATION SCHEDULED', `${sector.name} entered the queue using the ${state.navigation.baseline} baseline.`, 'nominal');
      toast(`${sector.name} added to the observing queue.`, 'success');
    } else {
      toast('That sky vector is already scheduled.', 'info');
    }
  } else if (action === 'optimize') {
    state.navigation.scheduled.sort((a, b) => b.visibility - a.visibility);
    addEvent('NIGHT SCHEDULE OPTIMISED', 'Targets reordered by visibility, air mass and receiver transition cost.', 'info');
    toast('Observation queue optimised.', 'success');
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
  if (world === 'array') drawArrayLinks();
  if (world === 'lab') { drawLabSpectrum(); drawCorrelation(); }
  if (world === 'nav') drawBaseline();
}

function fitCanvas(canvas) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
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
    const noise = (Math.sin(x * .41 + time * .004) + Math.sin(x * .083 - time * .002)) * (7 - active * .9) + (Math.random() - .5) * (11 - active);
    const y = height * .76 - carrier - sideband + noise;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke(); ctx.shadowBlur = 0;
  worldCanvasFrame = requestAnimationFrame(drawLabSpectrum);
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
  const date = new Date();
  const seconds = date.getUTCSeconds();
  const utc = date.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' });
  const lstHours = (date.getUTCHours() + date.getUTCMinutes() / 60 + 6.72) % 24;
  const lst = `${String(Math.floor(lstHours)).padStart(2, '0')}:${String(Math.floor((lstHours % 1) * 60)).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const solar = Math.round(382 + Math.sin(Date.now() * .00007) * 39 + Math.sin(Date.now() * .000019) * 17);
  const bary = 18.4 + Math.sin(Date.now() * .000021) * 7.6;
  const clock = 7 + Math.abs(Math.sin(Date.now() * .00013)) * 8;
  const coherence = .18 + Math.abs(Math.sin(Date.now() * .00031)) * .67;
  const drift = Math.sin(Date.now() * .00017) * .84;
  if ($('#obs-utc')) $('#obs-utc').textContent = utc;
  if ($('#obs-lst')) $('#obs-lst').textContent = lst;
  if ($('#obs-bary')) $('#obs-bary').textContent = `${bary >= 0 ? '+' : ''}${bary.toFixed(2)} km/s`;
  if ($('#obs-solar')) $('#obs-solar').textContent = `${solar} km/s`;
  if ($('#obs-clock')) $('#obs-clock').textContent = `${clock.toFixed(1)} ns`;
  if ($('#obs-coherence')) $('#obs-coherence').textContent = `COHERENCE ${coherence.toFixed(2)}`;
  if ($('#obs-drift')) $('#obs-drift').textContent = `DRIFT ${drift >= 0 ? '+' : ''}${drift.toFixed(2)} Hz/s`;
  if ($('#world-clock')) $('#world-clock').textContent = `${utc} UTC`;
  if ($('#nav-lst')) $('#nav-lst').textContent = lst;
  if ($('#world-bus')) $('#world-bus').textContent = `${(11.8 + coherence * 2.4).toFixed(1)} Gb/s`;
  document.documentElement.style.setProperty('--observatory-pulse', coherence.toFixed(3));

  const currentCarrier = $('#signal-id')?.textContent?.trim() || '';
  if (currentCarrier.startsWith('TLS-') && currentCarrier !== 'TLS-UNRESOLVED' && currentCarrier !== lastKnownCarrier) {
    lastKnownCarrier = currentCarrier;
    addEvent('MAIN RECEIVER CONTACT', `${currentCarrier} entered the active transmission panel.`, 'signal');
  }
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

function emitAmbientIncident() {
  const incident = INCIDENT_LIBRARY[incidentIndex % INCIDENT_LIBRARY.length];
  incidentIndex += 1;
  addEvent(incident.title, incident.message, incident.severity);
  const alert = $('#system-alert');
  if (alert && !document.body.classList.contains('observatory-world-open')) {
    alert.classList.add('observatory-echo');
    setTimeout(() => alert.classList.remove('observatory-echo'), 1200);
  }
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
  setInterval(emitAmbientIncident, 22000);
  document.addEventListener('keydown', trapOverlayFocus);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(worldCanvasFrame);
    else if (worldOverlay && !worldOverlay.hidden) drawWorldCanvases(state.selectedWorld);
  });
}

waitForMainApp();
