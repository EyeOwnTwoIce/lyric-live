/**
 * ACRCloud — adaptador OPCIONAL, desactivado por defecto.
 *
 * Por que no esta activo:
 *  - Su API exige firmar cada peticion con HMAC-SHA1 usando el access secret.
 *    Firmar en el cliente obliga a exponer el secreto en el navegador, o a
 *    montar un proxy (Supabase Edge Function). El plan aprobado descarta el proxy.
 *  - A cambio ofrece `play_offset_ms`, con precision de milisegundos, muy
 *    superior al `timecode` de AudD (granularidad de 1 segundo).
 *
 * Si en el futuro se quiere activar, basta con implementar recognize() contra un
 * proxy que haga la firma, manteniendo exactamente la misma forma de resultado.
 */
import { CONFIG } from '../config.js';

export const PROVIDER_NAME = 'ACRCloud';

function notConfigured() {
  return {
    ok: false,
    code: 'provider_disabled',
    message:
      'ACRCloud no esta configurado. Requiere firma HMAC y, por tanto, un proxy. Usa AudD o consulta el README.',
  };
}

export async function recognize() {
  return notConfigured();
}

export async function recognizeUrl() {
  return notConfigured();
}

export function isUsingEvalToken() {
  return !CONFIG.recognition.acrcloud.enabled;
}
