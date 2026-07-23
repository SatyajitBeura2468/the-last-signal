const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const frequencyLabel = (frequencyMHz) => frequencyMHz >= 1000
  ? `${(frequencyMHz / 1000).toFixed(6)} GHz`
  : `${frequencyMHz.toFixed(6)} MHz`;

const signalStatus = (state, signal) => {
  if (state.lockedSignal?.id === signal.id) return 'LOCKED';
  if (state.unlockedSignalIds.has(signal.id)) return 'DECODED';
  if (state.telemetry.signal?.id === signal.id && state.telemetry.lockable) return 'IN WINDOW';
  return 'UNRESOLVED';
};

const signalWave = (signal) => Array.from({ length: 34 }, (_, index) => {
  const seed = Math.sin((index + 1) * (signal.quality + 3) * 0.217) * 43758.5453;
  const random = seed - Math.floor(seed);
  const carrier = Math.exp(-((index - 17) ** 2) / (18 + signal.stability * 0.18));
  const height = clamp(12 + random * 32 + carrier * signal.quality * 0.55, 8, 88);
  return `<i style="--h:${height.toFixed(1)}%"></i>`;
}).join('');

export function dashboardView(state) {
  const signal = state.lockedSignal ?? (state.telemetry.lockable ? state.telemetry.signal : null);
  const event = state.operations.currentEvent;
  const activity = signal ? `${signal.id} / ${signal.className}` : 'DEEP FIELD SWEEP';
  return `
    <section class="command-deck">
      <header class="command-brief" data-severity="${event.severity}">
        <div class="brief-pulse"><i></i><span>LIVE OPERATIONS BRIEF</span></div>
        <strong id="dash-event-title">${event.title}</strong>
        <p id="dash-event-message">${event.message}</p>
        <time id="dash-live-clock">${new Date().toLocaleTimeString('en-GB', { hour12: false })} UTC</time>
      </header>

      <div class="command-body">
        <section class="array-plot" aria-label="Live array topology">
          <div class="array-grid"></div>
          <div class="array-orbit orbit-outer"><i></i></div>
          <div class="array-orbit orbit-mid"><i></i></div>
          <div class="array-orbit orbit-inner"><i></i></div>
          <div class="array-beam"></div>
          <div class="array-core">
            <span>DSA</span><strong>7</strong><small id="dash-array-state">${state.mode.toUpperCase()}</small>
          </div>
          <div class="plot-label label-a">HYDROGEN LINE</div>
          <div class="plot-label label-b">RELAY NODE 04</div>
          <div class="plot-label label-c">CRYO ARRAY</div>
        </section>

        <aside class="telemetry-spine">
          <div class="spine-heading"><span>RECEIVER NOW</span><b id="dash-activity">${activity}</b></div>
          <dl>
            <div><dt>Carrier strength</dt><dd id="dash-strength">${state.telemetry.strength.toFixed(1)} dBm</dd></div>
            <div><dt>Signal confidence</dt><dd id="dash-quality">${state.telemetry.quality}%</dd></div>
            <div><dt>Phase stability</dt><dd id="dash-stability">${state.telemetry.stability}%</dd></div>
            <div><dt>Noise floor</dt><dd id="dash-noise">${state.telemetry.noiseFloor?.toFixed(0) ?? '−106'} dBm</dd></div>
            <div><dt>Array alignment</dt><dd id="dash-alignment">${state.operations.alignment.toFixed(1)}%</dd></div>
            <div><dt>Frequency</dt><dd id="dash-frequency">${frequencyLabel(state.frequencyMHz)}</dd></div>
          </dl>
          <div class="confidence-track"><i id="dash-confidence" style="width:${state.telemetry.quality}%"></i></div>
          <small>OPERATIONS EVENT <b id="dash-event-number">${String(state.operations.eventNumber).padStart(3, '0')}</b></small>
        </aside>
      </div>

      <footer class="command-actions">
        <button type="button" data-command="scan"><span>01</span><b>RESUME DEEP SWEEP</b><small>Return to autonomous carrier hunting</small></button>
        <button type="button" data-command="transmissions"><span>02</span><b>OPEN SIGNAL ARCHIVE</b><small>Inspect every known transmission</small></button>
        <button type="button" data-command="logbook"><span>03</span><b>REVIEW EVENT STREAM</b><small>Trace receiver and operations history</small></button>
      </footer>
    </section>`;
}

export function transmissionsView(state, selectedId) {
  const selected = state.signals.find((signal) => signal.id === selectedId) ?? state.lockedSignal ?? state.signals[0];
  if (!selected) return '<p class="overlay-empty">No signal catalogue is available.</p>';
  const decoded = state.unlockedSignalIds.has(selected.id);
  const fragments = decoded
    ? selected.fragments.map((fragment, index) => `<p><span>${String(index + 1).padStart(2, '0')}</span>${fragment}</p>`).join('')
    : '<p class="encrypted-copy"><span>--</span>ARCHIVE PAYLOAD REMAINS ENCRYPTED. LOCK AND DECODE THIS CARRIER.</p>';

  return `
    <section class="transmission-browser">
      <nav class="signal-index" aria-label="Known signal catalogue">
        <header><span>CATALOGUE</span><b>${state.signals.length} CARRIERS</b></header>
        ${state.signals.map((signal, index) => `
          <button type="button" data-inspect-signal="${signal.id}" class="${signal.id === selected.id ? 'active' : ''}">
            <i>${String(index + 1).padStart(2, '0')}</i>
            <span><b>${signal.id}</b><small>${frequencyLabel(signal.frequencyMHz)}</small></span>
            <em class="${signalStatus(state, signal).toLowerCase().replace(' ', '-')}">${signalStatus(state, signal)}</em>
          </button>`).join('')}
      </nav>

      <article class="signal-dossier">
        <header>
          <div><span>SIGNAL DOSSIER / ${selected.className}</span><h3>${selected.id}</h3></div>
          <b class="dossier-status">${signalStatus(state, selected)}</b>
        </header>
        <div class="dossier-wave" aria-hidden="true">${signalWave(selected)}</div>
        <div class="dossier-grid">
          <dl>
            <div><dt>CARRIER</dt><dd>${frequencyLabel(selected.frequencyMHz)}</dd></div>
            <div><dt>RIGHT ASCENSION</dt><dd>${selected.ra}</dd></div>
            <div><dt>DECLINATION</dt><dd>${selected.dec}</dd></div>
            <div><dt>EST. DISTANCE</dt><dd>${selected.distance.toLocaleString()} LY</dd></div>
          </dl>
          <div class="signal-fingerprint">
            <span>FINGERPRINT</span>
            <div><i style="--v:${selected.quality}%"></i><b>QUALITY ${selected.quality}</b></div>
            <div><i style="--v:${selected.stability}%"></i><b>STABILITY ${selected.stability}</b></div>
            <small>${decoded ? 'ARCHIVE RECONSTRUCTION COMPLETE' : 'PARTIAL CARRIER PROFILE'}</small>
          </div>
        </div>
        <section class="fragment-vault"><header>RECOVERED FRAGMENTS</header>${fragments}</section>
        <button type="button" class="tune-carrier" data-tune-signal="${selected.id}">
          <span>TUNE RECEIVER</span><b>${frequencyLabel(selected.frequencyMHz)}</b><i>→</i>
        </button>
      </article>
    </section>`;
}

export function starmapView(state, selectedId) {
  const selected = state.signals.find((signal) => signal.id === selectedId) ?? state.lockedSignal ?? state.signals[0];
  const positions = [
    { x: 24, y: 68, orbit: 1 },
    { x: 63, y: 27, orbit: 2 },
    { x: 77, y: 72, orbit: 3 },
  ];
  return `
    <section class="starmap-workspace">
      <div class="map-stage">
        <div class="map-stars"></div>
        <div class="map-crosshair"></div>
        <div class="map-sweep"></div>
        <div class="map-orbit map-o1"></div>
        <div class="map-orbit map-o2"></div>
        <div class="map-orbit map-o3"></div>
        <div class="map-compass"><span>N</span><span>E</span><span>S</span><span>W</span></div>
        <div class="map-origin"><i></i><span>DEEP SPACE ARRAY 7</span></div>
        ${state.signals.map((signal, index) => {
          const position = positions[index % positions.length];
          return `<button type="button" class="signal-beacon ${selected?.id === signal.id ? 'active' : ''}" data-map-signal="${signal.id}" style="--x:${position.x}%;--y:${position.y}%;--delay:${index * -.7}s">
            <i></i><span>${signal.id}<small>${signal.className} / ${signalStatus(state, signal)}</small></span>
          </button>`;
        }).join('')}
        <div class="map-readout"><span>LIVE SKY SOLUTION</span><b id="map-solution-clock">${new Date().toLocaleTimeString('en-GB', { hour12: false })} UTC</b></div>
        <div class="map-scale"><i></i><span>5,000 LIGHT YEARS</span></div>
      </div>
      ${selected ? `
        <aside class="map-inspector">
          <span>SELECTED VECTOR</span>
          <h3>${selected.id}</h3>
          <p>${selected.className} narrowband source projected at ${selected.ra}, ${selected.dec}.</p>
          <dl>
            <div><dt>RANGE</dt><dd>${selected.distance.toLocaleString()} LY</dd></div>
            <div><dt>CARRIER</dt><dd>${frequencyLabel(selected.frequencyMHz)}</dd></div>
            <div><dt>QUALITY</dt><dd>${selected.quality}%</dd></div>
            <div><dt>ARCHIVE</dt><dd>${signalStatus(state, selected)}</dd></div>
          </dl>
          <div class="vector-line"><i style="--angle:${(state.signals.indexOf(selected) + 1) * 37}deg"></i></div>
          <button type="button" data-tune-signal="${selected.id}">ALIGN &amp; TUNE RECEIVER <b>→</b></button>
        </aside>` : ''}
    </section>`;
}

const carrierIdForLog = (log) => {
  if (String(log.id).startsWith('TLS-')) return log.id;
  return log.message?.match(/TLS-\d+/)?.[0] ?? null;
};

const isCarrierLog = (log) => !log.operational || log.frequency === 'CARRIER' || Boolean(carrierIdForLog(log));

const logMatches = (log, filter) => filter === 'all'
  || (filter === 'operations' && !isCarrierLog(log))
  || (filter === 'carriers' && isCarrierLog(log));

export function logbookView(state, filter = 'all', selectedIndex = 0) {
  const indexed = state.logs.map((log, index) => ({ log, index })).filter(({ log }) => logMatches(log, filter));
  const chosen = indexed.find(({ index }) => index === selectedIndex) ?? indexed[0];
  const log = chosen?.log;
  return `
    <section class="logbook-workspace">
      <header class="logbook-toolbar">
        <div><span>SESSION EVENT STREAM</span><b>${state.logs.length} RECORDED ENTRIES</b></div>
        <nav aria-label="Log filters">
          ${['all', 'carriers', 'operations'].map((name) => `<button type="button" data-log-filter="${name}" class="${filter === name ? 'active' : ''}">${name.toUpperCase()}</button>`).join('')}
        </nav>
      </header>
      <div class="logbook-body">
        <div class="event-rail">
          ${indexed.length ? indexed.map(({ log: entry, index }) => `
            <button type="button" data-log-index="${index}" class="${chosen?.index === index ? 'active' : ''}">
              <i class="${entry.status.toLowerCase()}"></i>
              <time>${entry.time}</time>
              <span><b>${entry.title ?? entry.id ?? 'UNCLASSIFIED EVENT'}</b><small>${isCarrierLog(entry) ? `${entry.frequency} / ${entry.status}` : entry.message}</small></span>
              <em>${entry.status}</em>
            </button>`).join('') : '<p class="overlay-empty">No events match this filter.</p>'}
        </div>
        <article class="event-detail">
          ${log ? `
            <span>ENTRY ${String(chosen.index + 1).padStart(3, '0')} / ${isCarrierLog(log) ? 'SIGNAL DETECTION' : 'OPERATIONS'}</span>
            <h3>${log.title ?? log.id ?? 'UNCLASSIFIED EVENT'}</h3>
            <p>${log.message ?? `Receiver registered ${log.status.toLowerCase()} activity around ${log.frequency}.`}</p>
            <dl>
              <div><dt>TIME CODE</dt><dd>${log.time} UTC</dd></div>
              <div><dt>CHANNEL</dt><dd>${log.frequency}</dd></div>
              <div><dt>CLASSIFICATION</dt><dd>${log.status}</dd></div>
              <div><dt>SESSION</dt><dd>${state.sessionId.slice(-8)}</dd></div>
            </dl>
            ${state.signals.some((signal) => signal.id === carrierIdForLog(log)) ? `<button type="button" data-tune-signal="${carrierIdForLog(log)}">RETURN TO THIS CARRIER <b>→</b></button>` : '<div class="event-seal">ARRAY 7 / VERIFIED OPERATIONS EVENT</div>'}
          ` : '<p class="overlay-empty">Select an event to inspect its telemetry.</p>'}
        </article>
      </div>
    </section>`;
}

export function settingsView(state) {
  const sensitivity = Number(state.settings.sensitivity);
  return `
    <form class="settings-console">
      <header class="calibration-header">
        <div><span>RECEIVER CALIBRATION BAY</span><h3>Listening profile</h3></div>
        <p>Shape how Array 7 hunts, locks, and reports the deep field.</p>
      </header>
      <div class="profile-selector" role="group" aria-label="Receiver sensitivity profiles">
        <button type="button" data-profile="precision" data-sensitivity="0.7" class="${sensitivity <= .8 ? 'active' : ''}"><i>01</i><b>PRECISION</b><small>Narrow lock window. Fewer false positives.</small></button>
        <button type="button" data-profile="discovery" data-sensitivity="1" class="${sensitivity > .8 && sensitivity < 1.3 ? 'active' : ''}"><i>02</i><b>DISCOVERY</b><small>Balanced sweep for general signal hunting.</small></button>
        <button type="button" data-profile="deep-field" data-sensitivity="1.6" class="${sensitivity >= 1.3 ? 'active' : ''}"><i>03</i><b>DEEP FIELD</b><small>Wide lock window for unstable distant carriers.</small></button>
      </div>
      <div class="calibration-grid">
        <section>
          <label class="console-toggle"><span>PROCEDURAL AUDIO<small>Static, carrier tones, and event cues</small></span><input id="setting-audio" type="checkbox" ${state.settings.audio ? 'checked' : ''}></label>
          <label class="console-toggle"><span>REDUCED MOTION<small>Freeze ambient sweeps and orbital motion</small></span><input id="setting-motion" type="checkbox" ${state.settings.reducedMotion ? 'checked' : ''}></label>
          <label class="sensitivity-control"><span>LOCK SENSITIVITY <b id="sensitivity-readout">${sensitivity.toFixed(1)}×</b></span><input id="setting-sensitivity" type="range" min="0.6" max="1.8" step="0.1" value="${sensitivity}"><small>PRECISION</small><small>DEEP FIELD</small></label>
        </section>
        <aside class="diagnostic-scope">
          <span>LIVE CALIBRATION PREVIEW</span>
          <div class="scope-rings"><i></i><i></i><i></i><b style="--spread:${sensitivity}"></b></div>
          <dl>
            <div><dt>NOISE FLOOR</dt><dd>${state.telemetry.noiseFloor?.toFixed(0) ?? '−106'} dBm</dd></div>
            <div><dt>CLOCK DRIFT</dt><dd>${state.operations.clockDrift.toFixed(3)} ms</dd></div>
            <div><dt>ARRAY POWER</dt><dd>${state.operations.power.toFixed(1)}%</dd></div>
          </dl>
        </aside>
      </div>
      <button type="submit" class="apply-calibration" data-commit-settings><span>COMMIT RECEIVER CALIBRATION</span><b>ARRAY 7</b></button>
    </form>`;
}
