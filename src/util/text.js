/** Normalizacion y comparacion de texto para emparejar canciones. */

/** minúsculas, sin acentos, sin parentesis ni "feat." — para comparar. */
export function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\((?:[^)]*)\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(feat|featuring|ft|with|remaster(ed)?|version|radio edit|live)\b\.?/g, ' ')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function bigrams(str) {
  const out = [];
  for (let i = 0; i < str.length - 1; i += 1) out.push(str.slice(i, i + 2));
  return out;
}

/** Similitud de Dice sobre bigramas, 0..1. Tolerante a pequenas diferencias. */
export function similarity(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bx = bigrams(x);
  const by = bigrams(y);
  if (!bx.length || !by.length) return x === y ? 1 : 0;
  const counts = new Map();
  bx.forEach((g) => counts.set(g, (counts.get(g) || 0) + 1));
  let hits = 0;
  by.forEach((g) => {
    const c = counts.get(g) || 0;
    if (c > 0) {
      counts.set(g, c - 1);
      hits += 1;
    }
  });
  return (2 * hits) / (bx.length + by.length);
}

/** Clave estable de una cancion, usada para cache y offsets aprendidos. */
export function songKey({ isrc, artist, title, durationSec }) {
  if (isrc) return `isrc_${normalize(isrc)}`;
  const base = `${normalize(artist)}_${normalize(title)}`;
  const bucket = durationSec ? Math.round(Number(durationSec) / 5) * 5 : 0;
  return `${base}_${bucket}`;
}

/** Escapa texto para insertarlo como contenido (no usamos innerHTML con datos). */
export function titleCase(value) {
  return String(value || '').replace(/\b\w/g, (c) => c.toUpperCase());
}
