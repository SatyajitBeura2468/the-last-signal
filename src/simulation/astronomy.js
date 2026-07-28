const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const normalizeDegrees = (value) => ((value % 360) + 360) % 360;
const normalizeHours = (value) => ((value % 24) + 24) % 24;

export function julianDate(dateLike) {
  const ms = dateLike instanceof Date ? dateLike.getTime() : Number(dateLike);
  return ms / 86400000 + 2440587.5;
}

export function localSiderealTime(dateLike, longitudeDeg) {
  const jd = julianDate(dateLike);
  const days = jd - 2451545;
  const gmst = 18.697374558 + 24.06570982441908 * days;
  return normalizeHours(gmst + longitudeDeg / 15);
}

export function equatorialToHorizontal({ raHours, decDeg, latitudeDeg, longitudeDeg, date }) {
  const lstHours = localSiderealTime(date, longitudeDeg);
  const hourAngleDeg = normalizeDegrees((lstHours - raHours) * 15 + 180) - 180;
  const ha = hourAngleDeg * DEG;
  const dec = decDeg * DEG;
  const lat = latitudeDeg * DEG;

  const sinAltitude = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
  const altitudeDeg = Math.asin(Math.max(-1, Math.min(1, sinAltitude))) * RAD;
  const azimuthDeg = normalizeDegrees(Math.atan2(
    -Math.sin(ha) * Math.cos(dec),
    Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(ha),
  ) * RAD);
  const airMass = altitudeDeg > 0
    ? Math.min(10, 1 / (Math.sin(altitudeDeg * DEG) + 0.50572 * ((altitudeDeg + 6.07995) ** -1.6364)))
    : Infinity;

  return {
    lstHours,
    hourAngleDeg,
    altitudeDeg,
    azimuthDeg,
    airMass,
    visible: altitudeDeg >= 12,
  };
}

export function approximateSunHorizontal({ latitudeDeg, longitudeDeg, date }) {
  const jd = julianDate(date);
  const n = jd - 2451545;
  const meanLongitude = normalizeDegrees(280.46 + 0.9856474 * n);
  const meanAnomaly = normalizeDegrees(357.528 + 0.9856003 * n) * DEG;
  const eclipticLongitude = (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG;
  const obliquity = (23.439 - 0.0000004 * n) * DEG;
  const raHours = normalizeHours(Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude),
  ) * RAD / 15);
  const decDeg = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude)) * RAD;
  return equatorialToHorizontal({ raHours, decDeg, latitudeDeg, longitudeDeg, date });
}

export function formatSiderealTime(hours) {
  const normalized = normalizeHours(hours);
  const h = Math.floor(normalized);
  const minutes = (normalized - h) * 60;
  const m = Math.floor(minutes);
  const s = Math.floor((minutes - m) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function estimateRiseSetWindow({ raHours, decDeg, latitudeDeg, longitudeDeg, date, minimumAltitudeDeg = 12 }) {
  const lat = latitudeDeg * DEG;
  const dec = decDeg * DEG;
  const altitude = minimumAltitudeDeg * DEG;
  const cosHourAngle = (Math.sin(altitude) - Math.sin(lat) * Math.sin(dec)) / (Math.cos(lat) * Math.cos(dec));
  if (cosHourAngle < -1) return { status: 'CIRCUMPOLAR', riseUtc: null, setUtc: null };
  if (cosHourAngle > 1) return { status: 'BELOW_HORIZON', riseUtc: null, setUtc: null };
  const hourAngleHours = Math.acos(cosHourAngle) * RAD / 15;
  const lstNow = localSiderealTime(date, longitudeDeg);
  const utcNow = new Date(date).getUTCHours() + new Date(date).getUTCMinutes() / 60;
  const siderealToSolar = 0.9972695663;
  const riseDelta = normalizeHours((raHours - hourAngleHours) - lstNow) * siderealToSolar;
  const setDelta = normalizeHours((raHours + hourAngleHours) - lstNow) * siderealToSolar;
  const toClock = (hours) => {
    const value = normalizeHours(utcNow + hours);
    const h = Math.floor(value);
    const m = Math.floor((value - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} UTC`;
  };
  return { status: 'WINDOW', riseUtc: toClock(riseDelta), setUtc: toClock(setDelta) };
}
