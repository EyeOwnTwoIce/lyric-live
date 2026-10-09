/** Codificacion de audio: recorte de silencio, remuestreo y WAV PCM16. */
import { debug } from '../util/log.js';

/** Nivel RMS de un buffer Float32. */
export function rms(samples) {
  if (!samples || !samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Recorta silencio por ambos extremos. Devuelve null si todo es silencio. */
export function trimSilence(samples, threshold = 0.004) {
  if (!samples || !samples.length) return null;
  let start = 0;
  let end = samples.length - 1;
  while (start < end && Math.abs(samples[start]) < threshold) start += 1;
  while (end > start && Math.abs(samples[end]) < threshold) end -= 1;
  if (end - start < samples.length * 0.1) return null;
  return samples.subarray(start, end + 1);
}

/**
 * Remuestrea a la frecuencia objetivo.
 * Usa OfflineAudioContext (calidad, disponible en todos los navegadores
 * objetivo) y cae a decimacion con media movil si no existe.
 */
export async function downsample(samples, inRate, outRate) {
  if (!samples || !samples.length) return null;
  if (Math.abs(inRate - outRate) < 1) return samples;

  const OfflineCtor = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (OfflineCtor) {
    try {
      const frames = Math.max(1, Math.ceil((samples.length * outRate) / inRate));
      const ctx = new OfflineCtor(1, frames, outRate);
      const buffer = ctx.createBuffer(1, samples.length, inRate);
      buffer.copyToChannel(samples, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
      const rendered = await ctx.startRendering();
      return rendered.getChannelData(0);
    } catch (err) {
      debug('OfflineAudioContext fallo, uso decimacion', err);
    }
  }
  return decimate(samples, inRate / outRate);
}

/** Decimacion con media movil (anti-aliasing basico). */
function decimate(samples, ratio) {
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);
  const width = Math.max(1, Math.floor(ratio));
  for (let i = 0; i < outLength; i += 1) {
    const from = Math.floor(i * ratio);
    const to = Math.min(samples.length, from + width);
    let sum = 0;
    for (let j = from; j < to; j += 1) sum += samples[j];
    out[i] = sum / (to - from || 1);
  }
  return out;
}

/** Cabecera WAV + PCM 16 bits little-endian. */
export function encodeWavPCM16(samples, sampleRate) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}
