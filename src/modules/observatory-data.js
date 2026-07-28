export const OBSERVATORY_WORLDS = [
  { id: 'array', label: 'ARRAY CORE', short: 'CORE', index: '07A' },
  { id: 'lab', label: 'SIGNAL FORENSICS', short: 'LAB', index: '07B' },
  { id: 'nav', label: 'CELESTIAL NAVIGATION', short: 'NAV', index: '07C' },
  { id: 'vault', label: 'EVIDENCE VAULT', short: 'VAULT', index: '07D' },
];

export const ARRAY_NODES = [
  { id: 'DISH-01', name: 'North Baseline', bearing: 18, elevation: 62, health: 98.7, role: 'PRIMARY' },
  { id: 'DISH-02', name: 'East Horizon', bearing: 74, elevation: 51, health: 96.2, role: 'PHASE' },
  { id: 'DISH-03', name: 'Cryo Reference', bearing: 132, elevation: 44, health: 93.8, role: 'REFERENCE' },
  { id: 'DISH-04', name: 'Long Baseline', bearing: 201, elevation: 38, health: 97.5, role: 'PRIMARY' },
  { id: 'DISH-05', name: 'South Relay', bearing: 257, elevation: 47, health: 91.6, role: 'RELAY' },
  { id: 'DISH-06', name: 'Western Aperture', bearing: 318, elevation: 58, health: 95.4, role: 'PHASE' },
];

export const SIGNAL_CANDIDATES = [
  {
    id: 'CND-04A-771', frequencyMHz: 1420.405752, className: 'H-LINE', confidence: 42,
    coherence: 61, drift: -0.32, bandwidth: 0.82, ra: '04h 29m 18.4s', dec: '+18° 14′ 03″',
    distance: 417, sector: 'Taurus Molecular Edge',
    note: 'Persistent narrowband shoulder embedded beside local neutral-hydrogen emission.',
  },
  {
    id: 'CND-19K-204', frequencyMHz: 4217.812651, className: 'T7N', confidence: 78,
    coherence: 92, drift: 0.11, bandwidth: 0.48, ra: '19h 42m 11.6s', dec: '−02° 35′ 47″',
    distance: 14218, sector: 'Aquila Rift',
    note: 'Primary coherent carrier. Phase structure repeats after barycentric correction.',
  },
  {
    id: 'CND-22R-883', frequencyMHz: 7123.2844, className: 'NRW', confidence: 54,
    coherence: 69, drift: 0.73, bandwidth: 1.34, ra: '22h 07m 05.4s', dec: '−41° 52′ 16″',
    distance: 3191, sector: 'Piscis Austrinus',
    note: 'Prime-spaced pulse groups with an unresolved terrestrial sideband.',
  },
  {
    id: 'CND-11C-091', frequencyMHz: 886.7315, className: 'PULSE', confidence: 31,
    coherence: 48, drift: -1.26, bandwidth: 2.1, ra: '11h 03m 52.8s', dec: '+07° 18′ 40″',
    distance: 1280, sector: 'Leo Spur',
    note: 'Intermittent six-pulse train. Detection repeats only during low solar-wind intervals.',
  },
  {
    id: 'CND-03M-602', frequencyMHz: 10987.4421, className: 'CHIRP', confidence: 47,
    coherence: 57, drift: 2.84, bandwidth: 5.7, ra: '03h 41m 09.2s', dec: '−21° 44′ 08″',
    distance: 734, sector: 'Eridanus Window',
    note: 'Ascending chirp survives local RFI subtraction but not phase folding.',
  },
  {
    id: 'CND-17V-318', frequencyMHz: 327.422, className: 'LOW', confidence: 26,
    coherence: 39, drift: -0.04, bandwidth: 12.3, ra: '17h 18m 43.0s', dec: '+29° 05′ 19″',
    distance: 64, sector: 'Hercules Local Bubble',
    note: 'Broad low-frequency excess. Most likely plasma scintillation; retained as a control case.',
  },
  {
    id: 'CND-08Q-440', frequencyMHz: 22235.0799, className: 'MASER', confidence: 64,
    coherence: 74, drift: 0.19, bandwidth: 0.66, ra: '08h 11m 33.9s', dec: '−47° 02′ 54″',
    distance: 5088, sector: 'Vela Ridge',
    note: 'Water-maser neighbourhood containing a second, exceptionally stable microcarrier.',
  },
  {
    id: 'CND-00X-001', frequencyMHz: 1582.04993, className: 'UNKNOWN', confidence: 38,
    coherence: 66, drift: -0.61, bandwidth: 0.91, ra: '00h 52m 16.5s', dec: '+62° 31′ 20″',
    distance: 906, sector: 'Cassiopeia Outer Field',
    note: 'Carrier repeats every 113 seconds. No known catalogue source matches its cadence.',
  },
];

export const SKY_SECTORS = [
  { id: 'aquila', name: 'Aquila Rift', x: 54, y: 46, visibility: 91, window: '00:42–03:18 UTC', range: 14218, risk: 'DUST' },
  { id: 'vela', name: 'Vela Ridge', x: 26, y: 68, visibility: 76, window: '01:21–04:08 UTC', range: 5088, risk: 'MASER' },
  { id: 'taurus', name: 'Taurus Molecular Edge', x: 71, y: 23, visibility: 68, window: '20:16–22:41 UTC', range: 417, risk: 'H-LINE' },
  { id: 'eridanus', name: 'Eridanus Window', x: 82, y: 62, visibility: 83, window: '21:04–00:55 UTC', range: 734, risk: 'RFI' },
  { id: 'cassiopeia', name: 'Cassiopeia Outer Field', x: 37, y: 24, visibility: 88, window: 'ALL NIGHT', range: 906, risk: 'DRIFT' },
  { id: 'hercules', name: 'Hercules Local Bubble', x: 17, y: 41, visibility: 59, window: '03:10–05:02 UTC', range: 64, risk: 'PLASMA' },
];

export const INCIDENT_LIBRARY = [
  { severity: 'nominal', title: 'BASELINE PHASE LOCK', message: 'Six-dish phase solution converged below 0.8 milliradians.' },
  { severity: 'info', title: 'IONOSPHERIC SHEAR', message: 'Low-amplitude phase shear crossing the eastern aperture.' },
  { severity: 'signal', title: 'COHERENT SIDEBAND', message: 'A repeatable microcarrier appeared 1.4 Hz above the listening window.' },
  { severity: 'warning', title: 'CRYO LOAD RISE', message: 'Receiver bay temperature is climbing; reserve cooling remains available.' },
  { severity: 'info', title: 'BARYCENTRIC UPDATE', message: 'Earth-motion correction recalculated for the active sky vector.' },
  { severity: 'nominal', title: 'CLOCK DISCIPLINE', message: 'Array clock offset returned inside the 12 nanosecond envelope.' },
  { severity: 'warning', title: 'LOCAL INTERFERENCE', message: 'Short terrestrial burst detected near the western horizon mask.' },
  { severity: 'signal', title: 'PHASE REPEAT', message: 'Carrier phase fingerprint repeated across two independent baselines.' },
];
