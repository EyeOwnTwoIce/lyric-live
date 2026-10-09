/**
 * Observabilidad minima: niveles, buffer circular en memoria y texto de
 * diagnostico copiable (en iOS no hay consola de desarrollo).
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

let minLevel = LEVELS.debug;
const RING_MAX = 300;
const ring = [];

function push(levelName, args) {
  const entry = {
    t: new Date().toISOString().slice(11, 23),
    level: levelName,
    msg: args.map(stringify).join(' '),
  };
  ring.push(entry);
  if (ring.length > RING_MAX) ring.shift();
}

function stringify(value) {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function emit(levelName, consoleFn) {
  return (...args) => {
    push(levelName, args);
    if (LEVELS[levelName] >= minLevel) consoleFn(`[${levelName}]`, ...args);
  };
}

export const debug = emit('debug', console.debug.bind(console));
export const info = emit('info', console.info.bind(console));
export const warn = emit('warn', console.warn.bind(console));
export const error = emit('error', console.error.bind(console));

export function getEntries() {
  return ring.slice();
}

export function getDiagnosticText() {
  const header = {
    ua: navigator.userAgent,
    platform: navigator.platform || '',
    lang: navigator.language,
    online: navigator.onLine,
    href: location.href,
    time: new Date().toISOString(),
  };
  const lines = Object.entries(header).map(([k, v]) => `${k}: ${v}`);
  lines.push('--- log ---');
  lines.push(...ring.map((e) => `${e.t} ${e.level.toUpperCase()} ${e.msg}`));
  return lines.join('\n');
}
