# THE LAST SIGNAL

> A deterministic, living deep-space observatory wrapped in a cinematic signal-hunting interface.

The Last Signal is a browser-based operations experience for fictional Deep Space Array 7. Tune a logarithmic receiver, point and phase a six-dish array, manage power and cryogenic reserves, diagnose incidents, build repeatable evidence, and unlock transmissions only after the observation chain is complete.

The observatory is fictional. Astronomy is calculated locally, space-weather conditions are adapted from NOAA SWPC, and any fallback or seeded value is labelled in the interface.

## Live observatory

**[Enter The Last Signal](https://the-last-signal-eosin.vercel.app/)**

## Living Observatory V2

- Six authoritative destinations: Live Ops, Receiver, Signal Lab, Sky Control, Evidence, and Systems
- Central versioned state store with schema validation, migration, persistence, and corruption recovery
- Seeded simulation clock and deterministic array, receiver, resource, incident, and mission models
- Six individually modelled dishes with azimuth, elevation, slew, phase, clock, wind, and availability state
- Causal command bus with queued, running, complete, and evidence-producing actions
- Evidence-gated mission lifecycle: target → observation → corrections → correlation → revisit → commit → decode
- Secure server-side decode progression with signed stateless session tokens
- One shared signal catalogue containing candidates and explicit false-positive controls
- NOAA SWPC server adapter with caching, freshness metadata, timeout handling, and honest fallback reasons
- Julian date, local sidereal time, equatorial-to-horizontal conversion, rise/set estimation, and solar altitude
- Deterministic temporal waterfall rendering with resize, visibility, DPR, and reduced-motion controls
- Web Audio receiver tone with smooth parameter changes and background-tab suspension
- Mobile command dock, safe-area support, touch-sized controls, and no page-level horizontal overflow

## Architecture

```text
api/                 signed session, decode, catalogue, and NOAA adapters
src/core/            event bus, schema, persistence, clock, scheduler, selectors, store
src/data/            source registry and client adapters
src/simulation/      astronomy, array, resources, receiver, incidents, mission, signals
src/modules/         interface controllers, audio, overlays, renderer, compatibility views
src/styles/          observatory responsive and accessibility layer
tests/unit/          mathematical and deterministic model tests
tests/integration/   mission lifecycle and server boundary tests
tests/e2e/           desktop/mobile workflows and accessibility checks
```

The application keeps one authoritative root state. Simulation modules are pure or state-scoped, interface modules consume selectors, and persistence stores only validated, size-bounded user state. Serverless routes never expose decoded fragments through the public catalogue.

## Data provenance

- Space-weather speed: NOAA SWPC real-time solar-wind speed product
- Interplanetary magnetic field: NOAA SWPC real-time magnetic-field product
- Planetary activity: NOAA SWPC planetary K-index product
- Proton density: deterministic fallback until a compatible upstream product is available
- Astronomy: local calculations from station coordinates and simulation UTC
- Deep Space Array 7, signals, incidents, and missions: clearly fictional deterministic simulation

Every source records status, fetch time, source timestamp, staleness, and fallback reason. The server adapter uses a bounded timeout and a 15-minute cache.

## Local development

Requires Node.js 22.

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:4173`.

## Validation

```bash
npm run check
npm test
npm run test:e2e
npm run test:all
```

The end-to-end suite validates the main evidence-gated mission workflow, mobile overflow, keyboard tuning, focus restoration, and serious/critical Axe accessibility findings.

## Persistence and privacy

The experience is anonymous and requires no account. Receiver preferences, validated observatory progress, operator notes, and the local evidence archive remain in browser storage. Oversized or invalid saved state is rejected and recovered to a known schema. No credentials or secrets are shipped to the client.

## Deployment

`vercel.json` configures static hosting, serverless API routes, clean URLs, strict browser permissions, content security policy, and source rewrites. CI runs static checks, unit/integration tests, browser workflows, and accessibility checks on Node.js 22.

## License

Apache License 2.0 © 2026 Satyajit Beura
