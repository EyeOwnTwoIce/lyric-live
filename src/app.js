/**
 * Orquestador de la aplicacion: maquina de estados, bucle de reconocimiento,
 * motor de sincronia y cableado de la interfaz.
 */
import { CONFIG } from './config.js';
import { MicCapture } from './audio/capture.js';
import { downsample, encodeWavPCM16, trimSilence, rms } from './audio/wav.js';
import { getProvider, describeFailure } from './recognition/index.js';
import { searchLyrics } from './lyrics/lrclib.js';
import { parseLRC, plainToLines } from './lyrics/lrc.js';
import * as cache from './lyrics/cache.js';
import { SyncEngine, SEVERITY } from './sync/engine.js';
import { Renderer } from './ui/renderer.js';
import { Waveform } from './ui/waveform.js';
import { toast } from './ui/toast.js';
import * as storage from './util/storage.js';
import { nowSec, formatOffset, formatPercent } from './util/time.js';
import { songKey } from './util/text.js';
import { debug, info, warn, error as logError, getDiagnosticText } from './util/log.js';

const $ = (id) => document.getElementById(id);

const STATE = {
  IDLE: 'idle',
  PERMISSION: 'requesting-permission',
  SEARCHING: 'searching',
  SYNCED: 'synced',
  DRIFT: 'drift-pending',
  RESYNCING: 'resyncing',
  NO_MATCH: 'no-match',
  NO_LYRICS: 'no-lyrics',
  QUOTA: 'quota',
  ERROR: 'error',
  OFFLINE: 'offline',
  PAUSED: 'paused',
};

const STATE_LABEL = {
  [STATE.IDLE]: 'En espera',
  [STATE.PERMISSION]: 'Pidiendo permiso',
  [STATE.SEARCHING]: 'Escuchando',
  [STATE.SYNCED]: 'Sincronizado',
  [STATE.DRIFT]: 'Desfase',
  [STATE.RESYNCING]: 'Re-sincronizando',
  [STATE.NO_MATCH]: 'Sin reconocer',
  [STATE.NO_LYRICS]: 'Sin letra',
  [STATE.QUOTA]: 'Cuota agotada',
  [STATE.ERROR]: 'Error',
  [STATE.OFFLINE]: 'Sin conexion',
  [STATE.PAUSED]: 'En pausa',
};

const app = {
  settings: storage.loadSettings(),
  state: STATE.IDLE,
  capture: new MicCapture(),
  engine: new SyncEngine(),
  renderer: new Renderer(),
  waveform: null,
  provider: getProvider(),
  song: null,
  lyrics: null,
  misses: 0,
  consecutiveSongMatch: 0,
  pendingSong: null,
  timer: 0,
  frame: 0,
  inFlight: false,
  errorBackoffIndex: 0,
  wakeLock: null,
  deliveryTimer: 0,
  lastResult: null,
  lastFramesSeen: 0,
  stallCount: 0,
  reacquiring: false,
  bannerShownForDrift: false,
  pauseNoticeShown: false,
  resyncPending: false,
  pendingSongKey: null,
  started: false,
};

/* ------------------------------------------------------------------ *
 * Arranque
 * ------------------------------------------------------------------ */

function init() {
  app.provider = getProvider();
  app.waveform = new Waveform($('waveform'));

  applyTheme(app.settings.theme);
  syncSettingsUI();
  wireEvents();
  renderDiagnostics();
  renderer_setIdle();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => debug('Sin service worker', err));
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  globalThis.addEventListener('online', () => handleConnectivity(true));
  globalThis.addEventListener('offline', () => handleConnectivity(false));

  info('Aplicacion lista', { provider: app.provider.PROVIDER_NAME, version: CONFIG.app.version });
}

/**
 * Hook de diagnostico. En iOS no hay consola de desarrollo; desde la barra de
 * direcciones (o un acceso directo) se puede inspeccionar el estado con
 * `letraEnVivo.state`, `letraEnVivo.engine.snapshot()`, etc.
 */
globalThis.letraEnVivo = app;

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme || 'auto';
}

function renderer_setIdle() {
  app.renderer.setStatus(STATE.IDLE, STATE_LABEL[STATE.IDLE]);
  app.renderer.setHint(
    `Pulsa <strong>Escuchar</strong> y permite el microfono. Acerca el dispositivo a la musica.`,
  );
}

function setState(state) {
  app.state = state;
  app.renderer.setStatus(state, STATE_LABEL[state] || state);
}

/* ------------------------------------------------------------------ *
 * Interfaz
 * ------------------------------------------------------------------ */

function wireEvents() {
  $('btn-listen').addEventListener('click', onListenClick);
  $('btn-settings').addEventListener('click', () => openSettings(true));
  $('btn-close-settings').addEventListener('click', () => openSettings(false));
  $('scrim').addEventListener('click', () => openSettings(false));

  $('nudge-minus').addEventListener('click', () => nudge(-CONFIG.sync.manualNudgeSec));
  $('nudge-plus').addEventListener('click', () => nudge(CONFIG.sync.manualNudgeSec));

  $('btn-resync').addEventListener('click', () => {
    hideDriftBanner();
    doResync('usuario');
  });
  $('btn-ignore').addEventListener('click', () => {
    hideDriftBanner();
    if (app.state === STATE.DRIFT) setState(STATE.SYNCED);
  });
  $('chk-no-ask').addEventListener('change', (event) => {
    if (event.target.checked) updateSetting('syncPolicy', 'auto');
  });

  $('btn-demo').addEventListener('click', () => {
    runDemo().catch((err) => logError('Error en el modo demo', err));
  });
  $('btn-diagnostics').addEventListener('click', copyDiagnostics);
  $('btn-clear-cache').addEventListener('click', clearCaches);

  $('btn-error-close').addEventListener('click', hideError);
  $('btn-error-action').addEventListener('click', () => {
    hideError();
    openSettings(true);
  });

  $('input-token').addEventListener('change', (e) => updateSetting('token', e.target.value.trim()));
  $('select-policy').addEventListener('change', (e) => updateSetting('syncPolicy', e.target.value));
  $('select-theme').addEventListener('change', (e) => {
    updateSetting('theme', e.target.value);
    applyTheme(e.target.value);
  });
  $('chk-wake').addEventListener('change', (e) => updateSetting('keepAwake', e.target.checked));
  $('chk-cache').addEventListener('change', (e) => updateSetting('useCache', e.target.checked));

  $('input-clip').addEventListener('input', (e) => {
    $('out-clip').textContent = e.target.value;
    updateSetting('clipSeconds', Number(e.target.value));
  });
  $('input-interval').addEventListener('input', (e) => {
    $('out-interval').textContent = e.target.value;
    updateSetting('syncedIntervalSec', Number(e.target.value));
  });
}

function syncSettingsUI() {
  const s = app.settings;
  $('input-token').value = s.token || '';
  $('select-policy').value = s.syncPolicy;
  $('select-theme').value = s.theme;
  $('chk-wake').checked = Boolean(s.keepAwake);
  $('chk-cache').checked = Boolean(s.useCache);
  $('input-clip').value = s.clipSeconds;
  $('out-clip').textContent = s.clipSeconds;
  $('input-interval').value = s.syncedIntervalSec;
  $('out-interval').textContent = s.syncedIntervalSec;
}

function updateSetting(key, value) {
  app.settings = { ...app.settings, [key]: value };
  storage.saveSettings(app.settings);
  debug('Ajuste guardado', key, value);
  if (key === 'token') recoverAfterTokenChange();
}

/**
 * Al pegar un token nuevo, si el bucle estaba detenido por cuota o error hay
 * que reanudarlo. Antes la app se quedaba muerta hasta parar y volver a
 * empezar la escucha, que es justo lo que el usuario no espera.
 */
function recoverAfterTokenChange() {
  app.errorBackoffIndex = 0;
  if (!app.capture.active) return;
  if (app.state !== STATE.QUOTA && app.state !== STATE.ERROR) return;
  hideError();
  app.misses = 0;
  app.bannerShownForDrift = false;
  setState(STATE.SEARCHING);
  app.renderer.setHint('Token actualizado: volviendo a escuchar…');
  scheduleNext(0);
}

function openSettings(open) {
  $('settings-panel').hidden = !open;
  $('scrim').hidden = !open;
  $('btn-settings').setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) refreshCacheInfo();
}

async function refreshCacheInfo() {
  const total = await cache.countEntries();
  $('cache-info').textContent = `${total} canciones guardadas en este dispositivo.`;
}

/* ------------------------------------------------------------------ *
 * Escucha
 * ------------------------------------------------------------------ */

async function onListenClick() {
  if (app.capture.active) stopListening();
  else await startListening();
}

async function startListening() {
  setState(STATE.PERMISSION);
  app.renderer.setHint('Solicitando permiso de microfono…');
  try {
    const captureInfo = await app.capture.start();
    app.renderer.setListening(true);
    app.renderer.setDevice(
      `Microfono: ${captureInfo.deviceLabel} · ${Math.round(captureInfo.sampleRate)} Hz · ${captureInfo.mode}`,
    );
    app.waveform.start();
    app.capture.onLevel = (level) => app.waveform.push(level);
    app.misses = 0;
    app.errorBackoffIndex = 0;
    app.bannerShownForDrift = false;

    await requestWakeLock();
    hideError();
    setState(STATE.SEARCHING);
    app.renderer.setHint('Escuchando… el primer reconocimiento tarda unos 10-15 segundos.');
    startPlaybackLoop();
    startDeliveryWatchdog();
    scheduleNext(0);
  } catch (err) {
    logError('No se pudo iniciar la captura', err);
    app.renderer.setListening(false);
    app.waveform.stop();
    setState(STATE.ERROR);
    showError(permissionMessage(err), null);
    app.renderer.setHint('No se pudo acceder al microfono. Revisa los permisos del navegador.');
  }
}

function permissionMessage(err) {
  const name = (err && err.name) || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Permiso de microfono denegado. En iOS: Ajustes > Safari > Microfono, o toca el icono de la barra de direcciones.';
  }
  if (name === 'NotFoundError') return 'No se ha encontrado ningun microfono.';
  if (name === 'NotReadableError') return 'El microfono esta siendo usado por otra aplicacion.';
  if (err && err.code === 'unsupported') return err.message;
  return (err && err.message) || 'Error desconocido al abrir el microfono.';
}

/**
 * Vigilante de entrega de audio.
 * Si el tap del microfono no entrega nada, antes la app se quedaba en
 * "Escuchando…" indefinidamente sin decir nada: parecia colgada. Ahora lo
 * detecta y lo explica.
 */
function startDeliveryWatchdog() {
  clearTimeout(app.deliveryTimer);
  app.deliveryTimer = setTimeout(() => {
    if (!app.capture.active) return;
    if (app.capture.isDelivering()) return;
    logError('El microfono no entrega audio', app.capture.info());
    setState(STATE.ERROR);
    showError(
      'El micrófono no está entregando audio (0 fragmentos). Cierra otras apps que lo usen y vuelve a pulsar Escuchar. En iOS: Ajustes > Safari > Micrófono.',
      null,
    );
    renderDiagnostics();
  }, 5000);
}

/**
 * Comprueba que sigan llegando fragmentos de audio.
 * En iOS el microfono puede morir en silencio (una llamada entrante, cambiar de
 * app, bloquear la pantalla). Antes eso dejaba la app "escuchando" sin oir nada
 * para siempre. Ahora se detecta y se reabre.
 */
function checkCaptureAlive() {
  if (!app.capture.active || document.hidden || app.reacquiring) return;
  const frames = app.capture.framesReceived;
  if (frames === app.lastFramesSeen) {
    app.stallCount += 1;
    if (app.stallCount >= 2) {
      app.stallCount = 0;
      warn('El microfono dejo de entregar audio; reabriendo');
      reacquireCapture();
    }
  } else {
    app.stallCount = 0;
  }
  app.lastFramesSeen = frames;
}

/** Reabre el microfono conservando la sesion de escucha. */
async function reacquireCapture() {
  if (!app.capture.active || app.reacquiring) return;
  app.reacquiring = true;
  try {
    app.capture.stop();
    const captureInfo = await app.capture.start();
    app.capture.onLevel = (level) => app.waveform.push(level);
    app.waveform.start();
    app.lastFramesSeen = 0;
    app.stallCount = 0;
    app.renderer.setDevice(
      `Micrófono: ${captureInfo.deviceLabel} · ${captureInfo.mode} · ${captureInfo.constraintLabel}`,
    );
    startDeliveryWatchdog();
    info('Microfono reabierto', captureInfo);
    if (app.state === STATE.ERROR || app.state === STATE.PAUSED) {
      hideError();
      setState(STATE.SEARCHING);
      scheduleNext(0);
    }
  } catch (err) {
    logError('No se pudo reabrir el microfono', err);
    setState(STATE.ERROR);
    showError(permissionMessage(err), null);
  } finally {
    app.reacquiring = false;
  }
}

function stopListening() {
  clearTimeout(app.timer);
  app.timer = 0;
  clearTimeout(app.deliveryTimer);
  app.deliveryTimer = 0;
  app.stallCount = 0;
  app.lastFramesSeen = 0;
  if (app.frame) cancelAnimationFrame(app.frame);
  app.frame = 0;
  app.capture.onLevel = null;
  app.capture.stop();
  app.waveform.stop();
  app.renderer.setListening(false);
  app.renderer.setDevice('');
  releaseWakeLock();
  setState(STATE.IDLE);
  app.renderer.setHint('Escucha detenida. Pulsa <strong>Escuchar</strong> para volver a empezar.');
}

/* ------------------------------------------------------------------ *
 * Bucle de reconocimiento
 * ------------------------------------------------------------------ */

function scheduleNext(delayMs) {
  clearTimeout(app.timer);
  app.timer = setTimeout(() => {
    tick().catch((err) => logError('Error en el ciclo de reconocimiento', err));
  }, Math.max(0, delayMs));
}

async function tick() {
  if (!app.capture.active) return;
  if (app.inFlight) {
    scheduleNext(1500);
    return;
  }
  const clipSeconds = app.settings.clipSeconds;
  if (!app.capture.hasEnough(clipSeconds)) {
    scheduleNext(1500);
    return;
  }
  await runRecognition();
}

function intervalForState() {
  if (app.state === STATE.NO_MATCH) return CONFIG.polling.idleMs;
  if (app.state === STATE.SYNCED || app.state === STATE.DRIFT) {
    return Math.max(10, app.settings.syncedIntervalSec) * 1000;
  }
  return CONFIG.polling.searchingMs;
}

/** Construye el WAV 16 kHz mono a partir del buffer circular. */
async function buildClip(seconds) {
  const raw = app.capture.getClip(seconds);
  if (!raw) return null;

  const wallEnd = nowSec();
  const level = rms(raw);
  if (level < CONFIG.capture.silenceRms) return { silent: true, wallEnd, level };

  const trimmed = trimSilence(raw, CONFIG.capture.silenceRms) || raw;
  if (trimmed.length < app.capture.sampleRate * 2) return { silent: true, wallEnd, level };

  const resampled = await downsample(
    trimmed,
    app.capture.sampleRate,
    CONFIG.capture.targetSampleRate,
  );
  const blob = encodeWavPCM16(resampled, CONFIG.capture.targetSampleRate);
  return { blob, wallEnd, clipSeconds: seconds };
}

async function runRecognition() {
  const clipSeconds = app.settings.clipSeconds;
  const clip = await buildClip(clipSeconds);
  if (!clip) {
    scheduleNext(1500);
    return;
  }
  if (clip.silent) {
    const pct = Math.round((clip.level || 0) * 1000) / 10;
    app.renderer.setHint(
      `No se oye musica todavia (nivel medido ${pct} %). Acerca el dispositivo a la fuente de sonido.`,
    );
    scheduleNext(2000);
    return;
  }

  app.inFlight = true;
  let result;
  try {
    result = await app.provider.recognize(clip.blob, { userToken: app.settings.token });
  } catch (err) {
    logError('Fallo inesperado de reconocimiento', err);
    result = { ok: false, code: 'exception', message: 'Error inesperado al reconocer.' };
  } finally {
    app.inFlight = false;
  }

  await handleRecognition(result, { wallEnd: clip.wallEnd, clipSeconds });
}

/**
 * Cualquier excepcion aqui NO puede matar el bucle. Si handleMatch falla, se
 * registra y se reprograma el siguiente ciclo. Antes, un throw soltaba una
 * promesa sin capturar y la app se quedaba muda para siempre.
 */
async function handleRecognition(result, ctx) {
  app.lastResult = summarizeResult(result);
  try {
    if (!result || !result.ok) {
      handleFailure(result);
      return;
    }
    if (!result.matched) {
      handleMiss();
      return;
    }
    await handleMatch(result, ctx);
  } catch (err) {
    logError('Error procesando el reconocimiento', err);
    scheduleNext(intervalForState());
  }
}

/** Resumen de una linea del ultimo intento, para el panel de diagnostico. */
function summarizeResult(result) {
  if (!result) return 'sin respuesta';
  if (!result.ok) {
    const code = result.errorCode ? ` (${result.errorCode})` : '';
    return `error ${result.code}${code}: ${result.message}`;
  }
  if (!result.matched) return 'sin coincidencia';
  return `${result.artist} — ${result.title} (timecode ${result.timecodeSec}s)`;
}

function handleFailure(result) {
  const described = describeFailure(result);
  app.errorBackoffIndex = Math.min(
    app.errorBackoffIndex + 1,
    CONFIG.polling.errorBackoff.length - 1,
  );

  if (described && described.level === 'quota') {
    setState(STATE.QUOTA);
    showError(described.text, 'settings');
    return;
  }
  if (described && described.level === 'error') {
    setState(STATE.ERROR);
    showError(described.text, described.action);
    return;
  }
  if (described && described.level === 'offline') {
    setState(STATE.OFFLINE);
    showError(described.text, null);
  } else if (described) {
    toast(described.text, 'warn');
  }
  scheduleNext(CONFIG.polling.errorBackoff[app.errorBackoffIndex]);
}

function handleMiss() {
  app.misses += 1;
  app.consecutiveSongMatch = 0;
  if (app.misses >= CONFIG.polling.idleAfterMisses) {
    setState(STATE.NO_MATCH);
    app.renderer.setHint(
      'No reconozco la cancion. Sube el volumen, acerca el dispositivo y evita el ruido de fondo.',
    );
  }
  scheduleNext(intervalForState());
}

async function handleMatch(result, ctx) {
  app.misses = 0;
  hideError();

  const key = songKey({
    isrc: result.isrc,
    artist: result.artist,
    title: result.title,
    durationSec: result.durationSec,
  });

  const sameSong = app.song && app.song.key === key;
  if (!sameSong) {
    if (app.pendingSongKey === key) app.consecutiveSongMatch += 1;
    else {
      app.pendingSongKey = key;
      app.consecutiveSongMatch = 1;
    }

    const isFirstDetection = !app.song;
    // Un cambio de cancion solo se acepta tras N detecciones consecutivas.
    if (!isFirstDetection && app.consecutiveSongMatch < CONFIG.sync.songChangeConfirmations) {
      debug('Cambio de cancion sin confirmar', { key, confirmations: app.consecutiveSongMatch });
      scheduleNext(intervalForState());
      return;
    }

    app.song = {
      key,
      artist: result.artist,
      title: result.title,
      album: result.album,
      isrc: result.isrc,
      durationSec: result.durationSec,
      artworkUrl: result.artworkUrl,
    };
    app.pendingSongKey = null;
    app.consecutiveSongMatch = 0;
    app.bannerShownForDrift = false;
    await loadLyrics(app.song);
    addHistory(app.song);
  }

  // Ancla: el timecode marca el inicio del fragmento; el final del clip es "ahora".
  const songSec = (result.timecodeSec || 0) + (ctx.clipSeconds || 0);
  const anchor = app.engine.addAnchor({
    songSec,
    wallSec: ctx.wallEnd,
    granularitySec: 1,
  });

  if (anchor && app.resyncPending) {
    app.resyncPending = false;
    toast('Sincronia corregida.', 'ok');
  }

  app.renderer.setSong(app.song);
  app.renderer.setConfidence(app.engine.confidence());
  app.renderer.setOffsetDisplay(app.engine.manualOffsetSec);
  renderDiagnostics();

  if (app.engine.severity === SEVERITY.NONE && app.state !== STATE.RESYNCING) {
    setState(STATE.SYNCED);
  }
  if (app.engine.severity === SEVERITY.NONE) {
    app.renderer.setHint('Letra sincronizada con lo que suena.');
  }

  handleDrift();
  scheduleNext(intervalForState());
}

/* ------------------------------------------------------------------ *
 * Letra
 * ------------------------------------------------------------------ */

async function loadLyrics(song) {
  app.renderer.setSong(song);
  app.renderer.setLyrics({ lines: [], note: 'Buscando la letra…' });

  const learned = storage.loadSongOffset(song.key);
  app.engine.setSong(song, learned);
  app.renderer.setOffsetDisplay(learned);

  let lyrics = null;
  if (app.settings.useCache) lyrics = await cache.getCachedLyrics(song.key);
  const fromCache = Boolean(lyrics);

  if (!lyrics) {
    lyrics = await searchLyrics({
      artist: song.artist,
      title: song.title,
      album: song.album,
      durationSec: song.durationSec,
    });
    if (lyrics && app.settings.useCache) {
      await cache.putCachedLyrics(song.key, lyrics);
      cache.prune();
    }
  }

  app.lyrics = lyrics;
  if (!lyrics) {
    setState(STATE.NO_LYRICS);
    app.renderer.setLyrics({ lines: [] });
    app.renderer.setHint('Detectada la cancion, pero no encuentro su letra en LRCLIB.');
    return;
  }

  renderLyrics(lyrics, song);
  if (fromCache) info('Letra servida desde la cache local', song.key);
}

function renderLyrics(lyrics, song) {
  const duration = lyrics.duration || song.durationSec || null;
  let lines = [];
  let hasWordSync = false;
  let estimated = false;
  let note = '';

  if (lyrics.syncedLyrics) {
    const parsed = parseLRC(lyrics.syncedLyrics);
    lines = parsed.lines;
    hasWordSync = parsed.hasWordSync;
    if (parsed.meta && parsed.meta.offset) {
      debug('LRC con offset', parsed.meta.offset);
    }
  } else if (lyrics.plainLyrics) {
    const plain = plainToLines(lyrics.plainLyrics, duration);
    lines = plain.lines;
    estimated = true;
    note = 'Esta cancion solo tiene letra sin sincronizar: los tiempos son una estimacion.';
  }

  app.renderer.setLyrics({
    lines,
    estimated,
    hasWordSync,
    instrumental: lyrics.instrumental,
    note,
  });

  if (!lines.length && !lyrics.instrumental) {
    setState(STATE.NO_LYRICS);
    app.renderer.setHint('Letra encontrada, pero vacia. Probamos otra cancion.');
    return;
  }

  app.renderer.setHint(
    hasWordSync
      ? 'Letra sincronizada palabra por palabra.'
      : 'Letra sincronizada por lineas.',
  );
}

/* ------------------------------------------------------------------ *
 * Deriva y re-sincronizacion
 * ------------------------------------------------------------------ */

function handleDrift() {
  const severity = app.engine.severity;
  if (severity === SEVERITY.NONE) return;

  // Si la musica esta en pausa, volver a escuchar no arregla nada y solo
  // gastaria una peticion en cada ciclo. Se avisa una vez y se espera.
  if (app.engine.pauseSuspected) {
    if (!app.pauseNoticeShown) {
      app.pauseNoticeShown = true;
      toast('La musica parece en pausa. La letra se recolocara sola al continuar.', 'warn');
    }
    return;
  }

  if (severity === SEVERITY.HARD) {
    toast(`Desfase grave (${app.engine.driftLabel()}). Re-sincronizando.`, 'warn');
    doResync('deriva grave');
    return;
  }

  const policy = app.settings.syncPolicy;
  if (policy === 'auto') {
    doResync('automatico');
    return;
  }
  if (policy === 'never') return;
  if (app.bannerShownForDrift) return;

  app.bannerShownForDrift = true;
  setState(STATE.DRIFT);
  showDriftBanner();
}

function showDriftBanner() {
  const banner = $('drift-banner');
  if (!banner) return;
  const seconds = Math.abs(app.engine.driftSec).toFixed(1).replace('.', ',');
  $('drift-text').textContent =
    `Se ha detectado un desfase de ${seconds} s (${app.engine.driftLabel()}). ` +
    '¿Quieres que vuelva a escuchar un fragmento para re-sincronizar la letra?';
  banner.hidden = false;
}

function hideDriftBanner() {
  const banner = $('drift-banner');
  if (banner) banner.hidden = true;
}

/**
 * Re-sincronizacion: olvidamos el modelo viejo y forzamos una escucha inmediata.
 * La letra se congela ~1-2 s hasta que llega el ancla nueva.
 */
function doResync(reason) {
  if (!app.capture.active) {
    toast('Activa la escucha para poder re-sincronizar.', 'warn');
    return;
  }
  info('Re-sincronizando', reason);
  hideDriftBanner();
  setState(STATE.RESYNCING);
  // Conservamos el offset vigente y pedimos que la proxima ancla lo sustituya
  // de golpe (con animacion): asi la letra sigue avanzando en vez de quedarse
  // congelada mientras llega la nueva escucha.
  app.engine.anchors = [];
  app.engine.snapNext = true;
  app.engine.driftSec = 0;
  app.engine.severity = SEVERITY.NONE;
  app.engine.pauseSuspected = false;
  app.bannerShownForDrift = false;
  app.resyncPending = true;
  app.renderer.setHint('Re-sincronizando: escuchando un fragmento nuevo…');
  scheduleNext(0);
}

/* ------------------------------------------------------------------ *
 * Bucle de reproduccion (karaoke)
 * ------------------------------------------------------------------ */

function startPlaybackLoop() {
  if (app.frame) cancelAnimationFrame(app.frame);
  let lastConfidenceAt = 0;
  let lastStallCheckAt = 0;
  const loop = () => {
    const position = app.engine.positionAt();
    app.renderer.updatePlayback(position);

    const now = nowSec();
    if (now - lastConfidenceAt > 0.5) {
      lastConfidenceAt = now;
      if (app.capture.active) {
        const frag = app.capture.framesReceived;
        const lvl = Math.round((app.capture.lastLevel || 0) * 100);
        app.renderer.setDevice(
          `Micrófono: ${app.capture.deviceLabel || '—'} · ${app.capture.mode} · ${frag} fragmentos · nivel ${lvl} %`,
        );
      }
      if (now - lastStallCheckAt > 5) {
        lastStallCheckAt = now;
        checkCaptureAlive();
      }
      app.renderer.setConfidence(app.engine.confidence());
      app.renderer.setOffsetDisplay(app.engine.manualOffsetSec);
      if (app.engine.severity === SEVERITY.NONE) {
        // Vuelta a la normalidad: rearmamos los avisos.
        app.bannerShownForDrift = false;
        app.pauseNoticeShown = false;
      } else if (!app.resyncPending && app.state === STATE.SYNCED) {
        handleDrift();
      }
    }
    app.frame = requestAnimationFrame(loop);
  };
  app.frame = requestAnimationFrame(loop);
}

/* ------------------------------------------------------------------ *
 * Ajuste manual
 * ------------------------------------------------------------------ */

function nudge(delta) {
  const value = app.engine.nudge(delta);
  app.renderer.setOffsetDisplay(value);
  if (app.song) storage.saveSongOffset(app.song.key, value);
  toast(`Ajuste manual: ${formatOffset(value)}`, 'info', 1800);
}

/* ------------------------------------------------------------------ *
 * Errores
 * ------------------------------------------------------------------ */

function showError(text, action) {
  const box = $('error-box');
  if (!box) return;
  $('error-text').textContent = text;
  const actionBtn = $('btn-error-action');
  actionBtn.hidden = action !== 'settings';
  box.hidden = false;
}

function hideError() {
  const box = $('error-box');
  if (box) box.hidden = true;
}

/* ------------------------------------------------------------------ *
 * Ciclo de vida del dispositivo
 * ------------------------------------------------------------------ */

async function requestWakeLock() {
  if (!app.settings.keepAwake) return;
  try {
    if ('wakeLock' in navigator) {
      app.wakeLock = await navigator.wakeLock.request('screen');
      app.wakeLock.addEventListener('release', () => {
        app.wakeLock = null;
      });
      debug('Wake Lock activo');
    }
  } catch (err) {
    debug('Wake Lock no disponible', err);
  }
}

function releaseWakeLock() {
  try {
    if (app.wakeLock) app.wakeLock.release();
  } catch (err) {
    debug('Error liberando Wake Lock', err);
  }
  app.wakeLock = null;
}

function onVisibilityChange() {
  if (document.hidden) {
    if (app.capture.active) {
      clearTimeout(app.timer);
      setState(STATE.PAUSED);
      app.renderer.setHint('Escucha en pausa: la pestana esta en segundo plano.');
    }
    return;
  }
  if (!app.capture.active) return;
  try {
    if (app.capture.ctx && app.capture.ctx.state === 'suspended') app.capture.ctx.resume();
  } catch (err) {
    debug('No se pudo reanudar el AudioContext', err);
  }
  requestWakeLock();

  // iOS suele soltar la pista al suspender la pagina: si la pista ya no esta
  // viva, reabrimos el microfono en lugar de quedarnos escuchando el vacio.
  const track =
    app.capture.stream && app.capture.stream.getAudioTracks
      ? app.capture.stream.getAudioTracks()[0]
      : null;
  if (!track || track.readyState !== 'live') {
    warn('La pista de audio ya no esta viva tras volver del segundo plano');
    reacquireCapture();
    return;
  }

  setState(STATE.SEARCHING);
  scheduleNext(0);
}

function handleConnectivity(online) {
  if (!online) {
    setState(STATE.OFFLINE);
    toast('Sin conexion: el reconocimiento y las letras necesitan internet.', 'warn');
    return;
  }
  if (app.capture.active) scheduleNext(0);
}

/* ------------------------------------------------------------------ *
 * Historial y diagnostico
 * ------------------------------------------------------------------ */

function addHistory(song) {
  const list = storage.addHistoryEntry({
    key: song.key,
    title: song.title,
    artist: song.artist,
    at: Date.now(),
  });
  renderHistory(list);
}

function renderHistory(list) {
  const host = $('history-list');
  if (!host) return;
  const entries = list || storage.loadHistory();
  host.textContent = '';
  if (!entries.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'Todavia no hay detecciones.';
    host.appendChild(li);
    return;
  }
  entries.forEach((entry) => {
    const li = document.createElement('li');
    li.className = 'history-item';
    const b = document.createElement('b');
    b.textContent = entry.title || '(sin titulo)';
    const span = document.createElement('span');
    span.textContent = `${entry.artist || ''} · ${new Date(entry.at).toLocaleTimeString()}`;
    li.append(b, span);
    host.appendChild(li);
  });
}

function renderDiagnostics() {
  const dl = $('diag-list');
  if (!dl) return;
  const rows = [
    ['Estado', STATE_LABEL[app.state] || app.state],
    ['Proveedor', app.provider.PROVIDER_NAME],
    ['Token', app.settings.token ? 'propio' : 'evaluacion'],
    ['Anclas', String(app.engine.anchors.length)],
    ['Offset', formatOffset(app.engine.offsetSec)],
    ['Deriva', formatOffset(app.engine.driftSec)],
    ['Confianza', formatPercent(app.engine.confidence())],
    ['Captura', app.capture.mode],
    ['Procesado', app.capture.constraintLabel || '—'],
    ['Micrófono', `${app.capture.framesReceived} fragmentos · nivel ${formatPercent(app.capture.lastLevel || 0)}`],
    ['Último intento', app.lastResult || '—'],
  ];
  dl.textContent = '';
  rows.forEach(([key, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  });
}

async function copyDiagnostics() {
  const text = getDiagnosticText();
  try {
    await navigator.clipboard.writeText(text);
    toast('Diagnostico copiado al portapapeles.', 'ok');
  } catch (err) {
    debug('Portapapeles no disponible', err);
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      toast('Diagnostico copiado.', 'ok');
    } catch (err2) {
      warn('No se pudo copiar el diagnostico', err2);
      toast('No se pudo copiar automaticamente.', 'warn');
    }
    area.remove();
  }
}

async function clearCaches() {
  const removed = storage.clearSongOffsets();
  await cache.clearCache();
  await refreshCacheInfo();
  toast(`Cache borrada (${removed} ajustes de sincronia).`, 'ok');
}

/* ------------------------------------------------------------------ *
 * Modo demo: valida la cadena completa sin microfono
 * ------------------------------------------------------------------ */

async function runDemo() {
  if (app.capture.active) stopListening();
  hideError();
  setState(STATE.SEARCHING);
  app.renderer.setHint('Modo demo: reconociendo un audio de ejemplo con AudD…');

  let result;
  try {
    result = await app.provider.recognizeUrl(CONFIG.demo.audioUrl, {
      userToken: app.settings.token,
    });
  } catch (err) {
    logError('Fallo el modo demo', err);
    result = { ok: false, code: 'exception', message: 'Error inesperado en el modo demo.' };
  }

  if (!result.ok) {
    handleFailure(result);
    return;
  }
  if (!result.matched) {
    setState(STATE.NO_MATCH);
    app.renderer.setHint('El audio de ejemplo no se ha reconocido. Prueba de nuevo.');
    return;
  }

  setState(STATE.SYNCED);
  await handleMatch(result, { wallEnd: nowSec(), clipSeconds: 0 });
  if (!app.frame) startPlaybackLoop();
  renderHistory();
  toast('Modo demo completado: letra cargada y sincronizando.', 'ok');
}

/* ------------------------------------------------------------------ *
 * Arranque
 * ------------------------------------------------------------------ */

renderHistory();
renderDiagnostics();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { app, init };
