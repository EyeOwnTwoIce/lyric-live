/**
 * Parser de LRC (formato de letra sincronizada de LRCLIB).
 *
 * Soporta:
 *  - Etiquetas de tiempo de linea: [mm:ss], [mm:ss.x], [mm:ss.xx], [mm:ss.xxx]
 *    y variantes con dos puntos [mm:ss:xx].
 *  - Varias etiquetas de tiempo en la misma linea.
 *  - Sincronia por palabra (LRC enriquecido): <mm:ss.xx>palabra
 *  - Metadatos: [ar:], [ti:], [al:], [by:], [length:], [offset:]
 */

const META_RE = /^\[(ar|ti|al|by|length|offset|re|ve):\s*(.*?)\]$/i;
const TIME_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_RE = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

/** Convierte minutos/segundos/fraccion a segundos. */
function toSeconds(min, sec, frac) {
  let value = Number(min) * 60 + Number(sec);
  if (frac !== undefined && frac !== null && frac !== '') {
    const digits = String(frac).length;
    const n = Number(frac);
    if (digits === 1) value += n / 10;
    else if (digits === 2) value += n / 100;
    else value += n / 1000;
  }
  return value;
}

/**
 * @param {string} text contenido LRC
 * @returns {{lines: Array<{time:number,text:string,words:Array<{time:number,text:string}>}>, meta: object, hasWordSync: boolean}}
 */
export function parseLRC(text) {
  const result = { lines: [], meta: {}, hasWordSync: false };
  if (!text || typeof text !== 'string') return result;

  const offsetMs = extractOffset(text);
  const rawLines = text.split(/\r?\n/);

  for (const raw of rawLines) {
    if (!raw) continue;
    const metaMatch = raw.trim().match(META_RE);
    if (metaMatch) {
      result.meta[metaMatch[1].toLowerCase()] = metaMatch[2].trim();
      continue;
    }

    // Primero extraemos las palabras con marca de tiempo, si las hay.
    const words = [];
    WORD_RE.lastIndex = 0;
    let wordMatch = WORD_RE.exec(raw);
    while (wordMatch) {
      const time = toSeconds(wordMatch[1], wordMatch[2], wordMatch[3]);
      WORD_RE.lastIndex = wordMatch.index + wordMatch[0].length;
      const nextIndex = raw.indexOf('<', WORD_RE.lastIndex);
      const end = nextIndex === -1 ? raw.length : nextIndex;
      const chunk = raw.slice(WORD_RE.lastIndex, end).replace(/\[[^\]]*\]/g, '').trim();
      words.push({ time, text: chunk });
      wordMatch = WORD_RE.exec(raw);
    }

    // Etiquetas de tiempo de la linea.
    const times = [];
    TIME_RE.lastIndex = 0;
    let timeMatch = TIME_RE.exec(raw);
    while (timeMatch) {
      times.push(toSeconds(timeMatch[1], timeMatch[2], timeMatch[3]));
      timeMatch = TIME_RE.exec(raw);
    }
    // Hay LRC enriquecido que solo trae marcas de palabra, sin etiqueta de
    // linea: en ese caso el tiempo de la linea es el de su primera palabra.
    if (!times.length && !words.length) continue;

    const body = raw
      .replace(TIME_RE, '')
      .replace(WORD_RE, '')
      .trim();
    if (!body && !words.length) continue;

    const lineTime = Math.min(...times, ...(words.length ? [words[0].time] : []));
    if (words.length) result.hasWordSync = true;

    const effectiveTimes = times.length ? times : [lineTime];
    for (const time of effectiveTimes) {
      result.lines.push({
        time: offsetMs ? Math.max(0, time - offsetMs / 1000) : time,
        text: body,
        words: words.map((w) => ({ ...w, time: offsetMs ? Math.max(0, w.time - offsetMs / 1000) : w.time })),
      });
    }
  }

  result.lines.sort((a, b) => a.time - b.time);
  return result;
}

function extractOffset(text) {
  const m = String(text).match(/\[offset:\s*([+-]?\d+)\s*\]/i);
  return m ? Number(m[1]) : 0;
}

/* ------------------------------------------------------------------ *
 * Lineas y tiempo
 * ------------------------------------------------------------------ */

/**
 * Reparte letra sin sincronizar a lo largo de la duracion conocida.
 * El resultado se marca como estimado y la UI lo advierte.
 */
export function plainToLines(plain, durationSec) {
  const text = String(plain || '').trim();
  if (!text) return { lines: [], hasWordSync: false, estimated: false };

  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const parsed = parseLRC(text);
  const source = blocks.length > 1 ? blocks : parsed.lines.map((l) => l.text);
  const units = source.length ? source : text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!units.length) return { lines: [], hasWordSync: false, estimated: false };

  const total = Number(durationSec) && Number(durationSec) > 5 ? Number(durationSec) : null;
  const lines = [];

  if (total) {
    const start = total * 0.04;
    const end = total * 0.97;
    const weights = units.map((u) => Math.max(1, u.replace(/\s/g, '').length));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    let cursor = start;
    units.forEach((unit, i) => {
      lines.push({ time: cursor, text: unit.replace(/\n/g, ' '), words: [] });
      cursor += ((end - start) * weights[i]) / sum;
    });
  } else {
    units.forEach((unit) => lines.push({ time: null, text: unit.replace(/\n/g, ' '), words: [] }));
  }

  return { lines, hasWordSync: false, estimated: true };
}

/** Indice de la linea activa en el instante t (busqueda binaria). */
export function lineAt(lines, tSec) {
  if (!lines || !lines.length) return -1;
  if (tSec === null || tSec === undefined) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const time = lines[mid].time;
    if (time === null) {
      lo = mid + 1;
      continue;
    }
    if (time <= tSec) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Progreso 0..1 dentro de la linea activa. */
export function progressInLine(lines, index, tSec) {
  if (index < 0 || !lines || index >= lines.length) return 0;
  const current = lines[index];
  const next = lines[index + 1];
  if (!current || current.time === null) return 0;
  const end = next && next.time !== null ? next.time : current.time + 4;
  const span = Math.max(0.3, end - current.time);
  return Math.max(0, Math.min(1, (tSec - current.time) / span));
}

/** Indice de la palabra activa dentro de una linea con sincronia por palabra. */
export function wordAt(words, tSec) {
  if (!words || !words.length) return -1;
  let found = -1;
  for (let i = 0; i < words.length; i += 1) {
    if (words[i].time <= tSec) found = i;
    else break;
  }
  return found;
}
