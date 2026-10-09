/** Onda de nivel del microfono, dibujada en canvas. */
export class Waveform {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.history = [];
    this.max = 160;
    this.running = false;
    this.rafId = 0;
    this.dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.resize();
    this._onResize = () => this.resize();
    globalThis.addEventListener('resize', this._onResize);
  }

  resize() {
    const canvas = this.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(120, Math.round(rect.width || canvas.width));
    const height = Math.max(60, Math.round(rect.height || canvas.height));
    canvas.width = Math.round(width * this.dpr);
    canvas.height = Math.round(height * this.dpr);
    this.draw();
  }

  push(level) {
    this.history.push(Math.max(0, Math.min(1, level || 0)));
    if (this.history.length > this.max) this.history.shift();
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.draw();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.clear();
  }

  clear() {
    this.history = [];
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const bars = Math.min(this.max, Math.max(24, Math.floor(w / (6 * this.dpr))));
    const data = this.history.slice(-bars);
    const step = w / bars;
    const barWidth = Math.max(1.5, step * 0.6);

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent').trim() || '#4cc9f0';
    const dim = styles.getPropertyValue('--line').trim() || '#263149';

    ctx.fillStyle = dim;
    ctx.fillRect(0, h / 2 - 0.5 * this.dpr, w, 1 * this.dpr);

    for (let i = 0; i < bars; i += 1) {
      const level = data[i] || 0;
      const barHeight = Math.max(2 * this.dpr, level * (h * 0.86));
      const x = i * step + (step - barWidth) / 2;
      const y = (h - barHeight) / 2;
      ctx.fillStyle = i >= bars - data.length ? accent : dim;
      ctx.globalAlpha = 0.35 + 0.65 * (i / bars);
      ctx.fillRect(x, y, barWidth, barHeight);
    }
    ctx.globalAlpha = 1;
  }

  destroy() {
    this.stop();
    globalThis.removeEventListener('resize', this._onResize);
  }
}
