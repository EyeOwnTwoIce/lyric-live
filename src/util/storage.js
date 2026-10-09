/**
 * Persistencia local. Todo se guarda en localStorage del dispositivo.
 * Nada sale del navegador. Se protege contra Safari en modo privado,
 * donde localStorage puede lanzar excepciones.
 */
import { CONFIG, DEFAULT_SETTINGS } from '../config.js';
import { warn } from './log.js';

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    warn('localStorage no disponible al leer', key, err);
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    warn('localStorage no disponible al escribir', key, err);
    return false;
  }
}

export function get(key, fallback = null) {
  const raw = safeGet(key);
  return raw === null ? fallback : raw;
}

export function set(key, value) {
  return safeSet(key, String(value));
}

export function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    warn('localStorage no disponible al borrar', key, err);
  }
}

export function getJSON(key, fallback = null) {
  const raw = safeGet(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function setJSON(key, value) {
  try {
    return safeSet(key, JSON.stringify(value));
  } catch (err) {
    warn('No se pudo serializar el valor', err);
    return false;
  }
}

/** Lee los ajustes del usuario mezclados con los valores por defecto. */
export function loadSettings() {
  const stored = getJSON(CONFIG.storageKeys.settings, {}) || {};
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function saveSettings(settings) {
  return setJSON(CONFIG.storageKeys.settings, settings);
}

export function loadHistory() {
  const list = getJSON(CONFIG.storageKeys.history, []);
  return Array.isArray(list) ? list : [];
}

export function addHistoryEntry(entry, limit = 12) {
  const list = loadHistory().filter((e) => e.key !== entry.key);
  list.unshift(entry);
  const trimmed = list.slice(0, limit);
  setJSON(CONFIG.storageKeys.history, trimmed);
  return trimmed;
}

/** Offset de sincronia aprendido para una cancion concreta. */
export function loadSongOffset(songKey) {
  if (!songKey) return 0;
  const value = Number(get(CONFIG.storageKeys.offsetPrefix + songKey, '0'));
  return Number.isFinite(value) ? value : 0;
}

export function saveSongOffset(songKey, seconds) {
  if (!songKey) return false;
  return set(CONFIG.storageKeys.offsetPrefix + songKey, seconds.toFixed(3));
}

export function clearSongOffsets() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CONFIG.storageKeys.offsetPrefix)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    return keys.length;
  } catch {
    return 0;
  }
}
