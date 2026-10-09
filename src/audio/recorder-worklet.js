/**
 * AudioWorkletProcessor: copia cada bloque de entrada y lo envia al hilo
 * principal. No hace procesado, solo transporte.
 */
class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;
    const copy = new Float32Array(channel.length);
    copy.set(channel);
    this.port.postMessage(copy, [copy.buffer]);
    return true;
  }
}

registerProcessor('recorder', RecorderProcessor);
