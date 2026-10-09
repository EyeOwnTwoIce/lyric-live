/** Utilidades de tiempo y formato. */

/** Reloj monotono en segundos. Nunca usamos Date.now() para el motor de sync. */
export function nowSec() {
  return performance.now() / 1000;
}

/**
 * Convierte el timecode de AudD a segundos.
 * Acepta "00:56", "01:02:03", "56" o un numero.
 */
export function parseTimecode(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const str = String(value).trim();
  if (!str) return null;
  const parts = str.split(':').map((p) => Number.parseFloat(p));
  if (parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

/** 125.4 -> "02:05" */
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** 1.25 -> "+1,25 s" */
export function formatOffset(seconds) {
  const n = Number(seconds) || 0;
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2).replace('.', ',')} s`;
}

export function formatPercent(fraction) {
  const n = Math.max(0, Math.min(1, Number(fraction) || 0));
  return `${Math.round(n * 100)} %`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Interpolacion lineal entre posiciones para animar correcciones de sync. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}
