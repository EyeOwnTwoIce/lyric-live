/**
 * Selector de proveedor de reconocimiento.
 * Interfaz comun esperada por la app:
 *   recognize(blob, { userToken })  -> resultado normalizado
 *   recognizeUrl(url, { userToken }) -> resultado normalizado
 *   PROVIDER_NAME, isUsingEvalToken(userToken)
 */
import * as audd from './audd.js';
import * as acrcloud from './acrcloud.js';
import { CONFIG } from '../config.js';

const REGISTRY = { audd, acrcloud };

export function getProvider(name = CONFIG.recognition.provider) {
  const provider = REGISTRY[name];
  if (!provider) throw new Error(`Proveedor de reconocimiento desconocido: ${name}`);
  return provider;
}

export function providerName(name = CONFIG.recognition.provider) {
  return getProvider(name).PROVIDER_NAME || name;
}

/**
 * Traduce los resultados normalizados a mensajes de UI.
 * Devuelve null cuando no hay nada que decir al usuario.
 */
export function describeFailure(result) {
  if (!result || result.ok) return null;
  if (result.quota) {
    return {
      level: 'quota',
      text: 'La cuota de AudD se ha agotado. Pega tu token propio en Ajustes para seguir.',
      action: 'settings',
    };
  }
  if (result.tokenInvalid) {
    return {
      level: 'error',
      text: 'El token de AudD no es valido. Revisalo en Ajustes.',
      action: 'settings',
    };
  }
  if (result.code === 'network' || result.code === 'timeout') {
    return { level: 'offline', text: result.message, action: null };
  }
  if (result.errorCode === 300) {
    return { level: 'warn', text: result.message, action: null };
  }
  return { level: 'error', text: result.message || 'Error de reconocimiento.', action: null };
}
