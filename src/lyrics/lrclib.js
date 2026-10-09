/**
 * Cliente de LRCLIB (https://lrclib.net).
 *
 * Verificado: sin API key, CORS abierto (access-control-allow-origin: *),
 * responde con plainLyrics y syncedLyrics en formato LRC.
 *
 * Estrategia en cascada:
 *   1) /api/get   -> coincidencia exacta (artista + titulo + album + duracion)
 *   2) /api/search?track_name=&artist_name= -> varios candidatos, se puntuan
 *   3) /api/search?q= -> ultimo recurso
 */
import { CONFIG } from '../config.js';
import { debug } from '../util/log.js';
import { normalize, similarity } from '../util/text.js';

const BASE = CONFIG.lyrics.base;

async function request(path, params) {
  const url = new URL(`${BASE}${path}`);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, v);
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.lyrics.timeoutMs);
  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      debug('LRCLIB respondio', response.status, path);
      return null;
    }
    return await response.json();
  } catch (err) {
    debug('Error consultando LRCLIB', path, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Puntua un candidato de LRCLIB contra lo que sabemos de la cancion. */
function scoreCandidate(candidate, target) {
  if (!candidate) return -Infinity;
  let score = 0;
  if (candidate.syncedLyrics) score += 3;
  if (candidate.hasWordSync) score += 1;
  if (candidate.instrumental) score -= 0.5;

  score += 0.6 * similarity(candidate.artistName, target.artist);
  score += 0.6 * similarity(candidate.trackName, target.title);

  if (candidate.duration && target.durationSec) {
    const diff = Math.abs(Number(candidate.duration) - Number(target.durationSec));
    score -= Math.min(3, diff / 10);
  }
  return score;
}

/** Busca letra para una cancion detectada. Devuelve un objeto normalizado o null. */
export async function searchLyrics(target) {
  const { artist, title, album, durationSec } = target || {};
  if (!title) return null;

  // 1) Coincidencia exacta.
  const exact = await request('/api/get', {
    artist_name: artist || '',
    track_name: title,
    album_name: album || '',
    duration: durationSec ? Math.round(durationSec) : '',
  });
  if (exact && exact.trackName) return normalizeEntry(exact, target, 'get');

  // 2) Busqueda por campos.
  const list = await request('/api/search', {
    track_name: title,
    artist_name: artist || '',
  });
  const best = pickBest(list, target);
  if (best) return normalizeEntry(best, target, 'search');

  // 3) Busqueda libre.
  const free = await request('/api/search', { q: `${artist || ''} ${title}`.trim() });
  const bestFree = pickBest(free, target);
  if (bestFree) return normalizeEntry(bestFree, target, 'search_q');

  return null;
}

function pickBest(list, target) {
  if (!Array.isArray(list) || !list.length) return null;
  let best = null;
  let bestScore = CONFIG.lyrics.minScore;
  for (const candidate of list) {
    const score = scoreCandidate(candidate, target);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function normalizeEntry(entry, target, source) {
  const hasSynced = Boolean(entry.syncedLyrics && entry.syncedLyrics.trim());
  return {
    source,
    lrclibId: entry.id,
    trackName: entry.trackName || target.title || '',
    artistName: entry.artistName || target.artist || '',
    albumName: entry.albumName || target.album || '',
    duration: entry.duration || target.durationSec || null,
    instrumental: Boolean(entry.instrumental),
    hasWordSync: Boolean(entry.hasWordSync),
    syncedLyrics: hasSynced ? entry.syncedLyrics : '',
    plainLyrics: entry.plainLyrics || '',
    normalizedName: normalize(entry.trackName || ''),
    normalizedArtist: normalize(entry.artistName || ''),
  };
}
