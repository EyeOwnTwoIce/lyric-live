/**
 * Captura de microfono.
 *
 * Puntos criticos:
 *  - Las constraints de audio DESACTIVAN el procesado de voz. En iOS, si no se
 *    desactiva, Safari aplica echo cancellation/AGC y el reconocimiento musical
 *    se degrada muchisimo.
 *  - El AudioContext se crea y se reanuda dentro del gesto del usuario.
 *  - Si AudioWorklet no esta disponible se usa ScriptProcessorNode.
 */
import { CONFIG } from '../config.js';
import { debug, info, warn } from '../util/log.js';

export class MicCapture {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.node = null;
    this.analyser = null;
    this.sampleRate = 0;
    this.buffer = null;
    this.writePos = 0;
    this.framesWritten = 0;
    this.active = false;
    this.mode = 'none';
    this.deviceLabel = '';
    this.onLevel = null;
  }

  static isSupported() {
    return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  async start() {
    if (this.active) return this.info();
    if (!MicCapture.isSupported()) {
      throw Object.assign(new Error('Este navegador no permite acceder al microfono.'), {
        code: 'unsupported',
      });
    }

    const constraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);

    const AudioCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioCtor) {
      throw Object.assign(new Error('Web Audio no esta disponible.'), { code: 'unsupported' });
    }
    this.ctx = new AudioCtor();
    // Obligatorio en iOS: reanudar dentro del gesto.
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.sampleRate = this.ctx.sampleRate;
    this.allocateBuffer();

    this.source = this.ctx.createMediaStreamSource(this.stream);
    await this.buildTap();

    this.buildAnalyser();
    this.active = true;
    this.deviceLabel = await this.resolveDeviceLabel();
    info('Captura iniciada', {
      sampleRate: this.sampleRate,
      mode: this.mode,
      device: this.deviceLabel,
    });
    return this.info();
  }

  allocateBuffer() {
    const frames = Math.ceil(this.sampleRate * CONFIG.capture.bufferSeconds);
    this.buffer = new Float32Array(frames);
    this.writePos = 0;
    this.framesWritten = 0;
  }

  /** Intenta AudioWorklet y cae a ScriptProcessorNode si no esta disponible. */
  async buildTap() {
    const canWorklet =
      typeof this.ctx.audioWorklet !== 'undefined' &&
      typeof globalThis.AudioWorkletNode !== 'undefined';

    if (canWorklet) {
      try {
        await this.ctx.audioWorklet.addModule('src/audio/recorder-worklet.js');
        const node = new AudioWorkletNode(this.ctx, 'recorder');
        node.port.onmessage = (event) => this.push(event.data);
        this.source.connect(node);
        this.node = node;
        this.mode = 'worklet';
        return;
      } catch (err) {
        warn('AudioWorklet no disponible, uso ScriptProcessorNode', err);
      }
    }

    const node = this.ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (event) => {
      const channel = event.inputBuffer.getChannelData(0);
      this.push(new Float32Array(channel));
    };
    this.source.connect(node);
    // Necesita estar conectado a un destino para procesar en algunos navegadores.
    node.connect(this.ctx.destination);
    this.node = node;
    this.mode = 'scriptprocessor';
  }

  buildAnalyser() {
    try {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.source.connect(this.analyser);
    } catch (err) {
      debug('Analyser no disponible', err);
    }
  }

  push(chunk) {
    if (!this.buffer || !chunk || !chunk.length) return;
    const size = this.buffer.length;
    for (let i = 0; i < chunk.length; i += 1) {
      this.buffer[this.writePos] = chunk[i];
      this.writePos = (this.writePos + 1) % size;
    }
    this.framesWritten += chunk.length;
    if (this.onLevel && this.analyser) this.onLevel(this.readLevel());
  }

  /** Nivel 0..1 a partir del AnalyserNode (para la onda de la UI). */
  readLevel() {
    if (!this.analyser) return 0;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i += 1) {
      const v = Math.abs(data[i] - 128) / 128;
      if (v > peak) peak = v;
    }
    return Math.min(1, peak * 1.6);
  }

  /**
   * Devuelve los ultimos `seconds` segundos en orden cronologico.
   * Devuelve null si todavia no hay suficiente audio acumulado.
   */
  getClip(seconds) {
    if (!this.buffer) return null;
    const needed = Math.ceil(this.sampleRate * seconds);
    if (needed <= 0) return null;
    if (this.framesWritten < needed) return null;

    const size = this.buffer.length;
    const out = new Float32Array(needed);
    let readPos = (this.writePos - needed + size) % size;
    for (let i = 0; i < needed; i += 1) {
      out[i] = this.buffer[readPos];
      readPos = (readPos + 1) % size;
    }
    return out;
  }

  hasEnough(seconds) {
    return this.framesWritten >= Math.ceil(this.sampleRate * seconds);
  }

  async resolveDeviceLabel() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === 'audioinput');
      const track = this.stream && this.stream.getAudioTracks()[0];
      const settings = track ? track.getSettings() : {};
      const match = inputs.find((d) => d.deviceId && d.deviceId === settings.deviceId);
      return (match && match.label) || (inputs[0] && inputs[0].label) || 'Microfono predeterminado';
    } catch {
      return 'Microfono';
    }
  }

  info() {
    return { sampleRate: this.sampleRate, mode: this.mode, deviceLabel: this.deviceLabel };
  }

  stop() {
    this.active = false;
    try {
      if (this.node) {
        if (this.node.port) this.node.port.onmessage = null;
        this.node.onaudioprocess = null;
        this.node.disconnect();
      }
      if (this.source) this.source.disconnect();
      if (this.analyser) this.analyser.disconnect();
    } catch (err) {
      debug('Error desconectando nodos', err);
    }
    try {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      debug('Error parando pistas', err);
    }
    try {
      if (this.ctx && this.ctx.state !== 'closed') this.ctx.close();
    } catch (err) {
      debug('Error cerrando AudioContext', err);
    }
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.node = null;
    this.analyser = null;
    this.buffer = null;
    this.writePos = 0;
    this.framesWritten = 0;
    this.mode = 'none';
    info('Captura detenida');
  }
}
