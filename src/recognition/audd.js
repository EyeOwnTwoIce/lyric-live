/**
 * Reconocimiento con AudD (https://docs.audd.io/).
 *
 * Contrato verificado:
 *  - POST multipart a https://api.audd.io/ con api_token + file (+ return).
 *  - CORS abierto (access-control-allow-origin: *) -> se puede llamar desde el navegador.
 *  - Clips recomendados de 2 a 12 segundos. Limite de 10 MB.
 *  - `timecode` es la posicion en la cancion del fragmento reconocido, en formato mm:ss
 *    (granularidad de 1 segundo).
 *  - Sin coincidencia: { status: 'success', result: null }.
 */
import { CONFIG } from '../config.js';
import { debug, warn } from '../util/log.js';
import { parseTimecode } from '../util/time.js';

export const PROVIDER_NAME = 'AudD';

/** Codigos de error documentados y su significado en la app. */
const ERROR_HINTS = {
  300: 'El fragmento no se pudo procesar (audio muy corto o sin musica).',
  400: 'El fichero de audio es demasiado grande.',
  500: 'El fichero de audio no es valido.',
  600: 'La URL de audio no es correcta.',
  700: 'No se envio ningun fichero de audio.',
  900: 'El token de AudD no es valido.',
  901: 'Cuota de AudD agotada o falta el token.',
};

export function resolveToken(userToken) {
  const clean = (userToken || '').trim();
  return clean || CONFIG.recognition.audd.evalToken;
}

export function isUsingEvalToken(userToken) {
  return !(userToken || '').trim();
}

/**
 * Reconoce un clip de audio.
 * @param {Blob} blob WAV PCM16 mono.
 * @param {{token?: string, userToken?: string}} options
 * @returns {Promise<object>} resultado normalizado
 */
export async function recognize(blob, options = {}) {
  const token = resolveToken(options.userToken);
  const form = new FormData();
  form.append('api_token', token);
  form.append('file', blob, 'clip.wav');
  if (CONFIG.recognition.audd.returnFields) {
    form.append('return', CONFIG.recognition.audd.returnFields);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.recognition.audd.timeoutMs);

  let response;
  try {
    response = await fetch(CONFIG.recognition.audd.endpoint, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err && err.name === 'AbortError';
    warn('Fallo de red al reconocer', err);
    return {
      ok: false,
      code: aborted ? 'timeout' : 'network',
      message: aborted ? 'AudD tardo demasiado en responder.' : 'No hay conexion con AudD.',
    };
  }
  clearTimeout(timer);

  if (!response.ok && response.status !== 200) {
    return {
      ok: false,
      code: `http_${response.status}`,
      message: `AudD respondio con HTTP ${response.status}.`,
    };
  }

  let payload;
  try {
    payload = await response.json();
  } catch (err) {
    debug('Respuesta no JSON de AudD', err);
    return { ok: false, code: 'parse', message: 'Respuesta ilegible de AudD.' };
  }

  return normalize(payload, blob);
}


/** Convierte la respuesta cruda de AudD en un objeto estable para la app. */
function normalize(payload, blob) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'parse', message: 'Respuesta vacia de AudD.' };
  }

  if (payload.status !== 'success') {
    const code = Number(payload.error && payload.error.error_code) || 0;
    const message =
      (payload.error && payload.error.error_message) ||
      ERROR_HINTS[code] ||
      'AudD devolvio un error.';
    return {
      ok: false,
      code: code ? `audd_${code}` : 'audd_error',
      errorCode: code,
      quota: code === 901,
      tokenInvalid: code === 900,
      message: ERROR_HINTS[code] ? `${ERROR_HINTS[code]} (${code})` : message,
    };
  }

  const result = payload.result;
  if (result === null || result === undefined) {
    return { ok: true, matched: false, clipBytes: blob ? blob.size : 0 };
  }
  if (Array.isArray(result)) {
    if (!result.length) return { ok: true, matched: false, clipBytes: blob ? blob.size : 0 };
    return normalizeMatch(result[0], blob);
  }
  return normalizeMatch(result, blob);
}

function normalizeMatch(result, blob) {
  const apple = result.apple_music || {};
  const artwork = apple.artwork || {};
  const durationSec = apple.durationInMillis ? Number(apple.durationInMillis) / 1000 : null;

  return {
    ok: true,
    matched: true,
    artist: result.artist || apple.artistName || '',
    title: result.title || apple.name || '',
    album: result.album || apple.albumName || '',
    label: result.label || '',
    isrc: apple.isrc || '',
    artworkUrl: artwork.url
      ? artwork.url.replace('{w}', '600').replace('{h}', '600')
      : '',
    appleMusicUrl: apple.url || result.song_link || '',
    durationSec,
    timecodeSec: parseTimecode(result.timecode),
    clipBytes: blob ? blob.size : 0,
    provider: 'audd',
  };
}

/**
 * Reconocimiento por URL. No se usa en el flujo normal (enviamos el clip
 * grabado), pero es la base del modo demo sin microfono.
 */
export async function recognizeUrl(url, options = {}) {
  const token = resolveToken(options.userToken);
  const form = new FormData();
  form.append('api_token', token);
  form.append('url', url);
  if (CONFIG.recognition.audd.returnFields) {
    form.append('return', CONFIG.recognition.audd.returnFields);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.recognition.audd.timeoutMs);
  try {
    const response = await fetch(CONFIG.recognition.audd.endpoint, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    const payload = await response.json();
    return normalize(payload, { size: 0 });
  } catch (err) {
    warn('Fallo el reconocimiento por URL', err);
    return {
      ok: false,
      code: err && err.name === 'AbortError' ? 'timeout' : 'network',
      message: 'No se pudo consultar AudD.',
    };
  } finally {
    clearTimeout(timer);
  }
}
