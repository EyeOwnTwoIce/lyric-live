/**
 * Configuracion central de la aplicacion.
 * Todos los parametros ajustables viven aqui. Los que el usuario puede cambiar
 * desde Ajustes se persisten con storage.loadSettings()/saveSettings().
 */
export const CONFIG = {
  app: {
    name: 'Letra en vivo',
    version: '1.0.0',
    repoUrl: 'https://github.com/EyeOwnTwoIce/lyric-live',
  },

  recognition: {
    /** Proveedor activo. 'audd' | 'acrcloud' */
    provider: 'audd',
    audd: {
      endpoint: 'https://api.audd.io/',
      /**
       * Token publico de evaluacion de AudD.
       * Funciona, pero esta limitado a ~10 peticiones/dia.
       * El token propio del usuario (Ajustes) tiene prioridad sobre este.
       */
      evalToken: 'test',
      /** Metadatos extra que pedimos en la respuesta. */
      returnFields: 'apple_music',
      timeoutMs: 20000,
    },
    acrcloud: {
      /** Deshabilitado por defecto: requiere proxy por firma HMAC. */
      enabled: false,
      endpoint: '',
    },
  },

  capture: {
    /** Segundos de audio que se mantienen en memoria (ring buffer). */
    bufferSeconds: 20,
    /** Silencio por debajo de este RMS -> no se gasta peticion. */
    silenceRms: 0.004,
    /** Frecuencia a la que se envia el audio. AudD acepta 16 kHz sin problema. */
    targetSampleRate: 16000,
    /** Numero maximo de reintentos al pedir el microfono. */
    maxStartRetries: 1,
  },

  polling: {
    /** Fase 1: aun no hay cancion, buscamos rapido. */
    searchingMs: 8000,
    /** Fase 2: sincronizado, comprobamos deriva de vez en cuando. */
    syncedMs: 25000,
    /** Fase 3: varios no-match seguidos, bajamos el ritmo para no gastar cuota. */
    idleMs: 40000,
    /** Backoff ante errores de red/servidor (ms), se repite el ultimo. */
    errorBackoff: [60000, 120000, 300000],
    /** Nunca mas de una peticion en vuelo. */
    maxInFlight: 1,
    /** Tras N no-match seguidos se pasa a idle. */
    idleAfterMisses: 3,
  },

  sync: {
    /** Deriva a partir de la cual se ofrece re-sincronizar (segundos). */
    driftSoftSec: 1.5,
    /** Deriva a partir de la cual se corrige sin preguntar (segundos). */
    driftHardSec: 4.0,
    /** Suavizado exponencial del offset (0 = nada, 1 = solo el ultimo). */
    smoothingAlpha: 0.4,
    /** Anclas minimas para poder medir deriva. */
    minAnchorsForDrift: 2,
    /** Separacion minima entre anclas para medir deriva (segundos). */
    minAnchorSeparationSec: 8,
    /** Anclas que se conservan en memoria. */
    maxAnchors: 8,
    /** Deriva por encima de esto en un ancla -> se descarta como outlier. */
    outlierSec: 6,
    /** Salto del ajuste manual (segundos). */
    manualNudgeSec: 0.25,
    /** Cambio de cancion confirmado tras N detecciones consecutivas. */
    songChangeConfirmations: 2,
    /** Duracion de la animacion de correccion (ms). */
    correctionAnimationMs: 500,
  },

  lyrics: {
    base: 'https://lrclib.net',
    userAgent: 'lyric-live/1.0.0 (https://github.com/EyeOwnTwoIce/lyric-live)',
    /** Puntuacion minima para aceptar un candidato en la busqueda. */
    minScore: 1.0,
    timeoutMs: 12000,
  },

  cache: {
    dbName: 'lyric-live',
    dbVersion: 1,
    storeLyrics: 'lyrics',
    /** Limite de entradas guardadas. */
    maxEntries: 300,
  },

  demo: {
    /** Audio publico de AudD que usamos en el modo demo. */
    audioUrl: 'https://audd.tech/example.mp3',
  },

  storageKeys: {
    settings: 'll.settings.v1',
    history: 'll.history.v1',
    offsetPrefix: 'll.offset.',
  },
};

/** Valores por defecto editables por el usuario desde Ajustes. */
export const DEFAULT_SETTINGS = {
  token: '',
  syncPolicy: 'ask',
  clipSeconds: 9,
  syncedIntervalSec: 25,
  keepAwake: true,
  useCache: true,
  theme: 'auto',
};
