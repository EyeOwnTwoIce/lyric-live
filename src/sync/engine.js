/**
 * Motor de sincronia.
 *
 * Modelo:  posicion_en_la_cancion(t) = t - offset + ajuste_manual
 *
 * Cada reconocimiento produce un "ancla": el par (posicion en la cancion,
 * instante del reloj monotono). Con las anclas estimamos el offset y, sobre
 * todo, detectamos cuando deja de ser valido (deriva).
 *
 * La deriva se mide entre dos anclas, asi que el sesgo constante del proveedor
 * se cancela: sirve para saber si la letra se esta separando de la musica.
 */
import { CONFIG } from '../config.js';
import { nowSec } from '../util/time.js';
import { debug } from '../util/log.js';

export const SEVERITY = { NONE: 'none', SOFT: 'soft', HARD: 'hard' };

export class SyncEngine {
  constructor() {
    this.reset();
  }

  reset() {
    this.anchors = [];
    this.offsetSec = 0;
    this.hasOffset = false;
    this.snapNext = false;
    this.manualOffsetSec = 0;
    this.driftSec = 0;
    this.severity = SEVERITY.NONE;
    this.song = null;
    this.correction = null;
    this.lastAnchorAt = 0;
    this.pauseSuspected = false;
  }

  /** Fija la cancion actual y permite un offset aprendido de sesiones previas. */
  setSong(song, learnedOffsetSec = 0) {
    this.song = song;
    this.anchors = [];
    this.offsetSec = 0;
    this.hasOffset = false;
    this.snapNext = false;
    this.manualOffsetSec = learnedOffsetSec || 0;
    this.driftSec = 0;
    this.severity = SEVERITY.NONE;
    this.correction = null;
    this.pauseSuspected = false;
  }

  /**
   * Anade un ancla.
   * @param {{songSec:number, wallSec:number, granularitySec?:number, weight?:number}} anchor
   */
  addAnchor({ songSec, wallSec, granularitySec = 1, weight = 1 }) {
    if (!Number.isFinite(songSec) || !Number.isFinite(wallSec)) return null;

    const anchor = { songSec, wallSec, granularitySec, weight, at: nowSec() };

    // Descarta anclas absurdas respecto al offset vigente (falsos positivos).
    if (this.anchors.length >= 1) {
      const candidateOffset = wallSec - songSec;
      if (Math.abs(candidateOffset - this.offsetSec) > CONFIG.sync.outlierSec) {
        debug('Ancla descartada por outlier', { candidateOffset, offset: this.offsetSec });
        return null;
      }
    }

    this.anchors.push(anchor);
    if (this.anchors.length > CONFIG.sync.maxAnchors) this.anchors.shift();
    this.lastAnchorAt = nowSec();

    this.recomputeOffset();
    this.computeDrift();
    return anchor;
  }

  /**
   * Offset robusto: mediana de las anclas + suavizado exponencial.
   * En la primera estimacion y tras una re-sincronizacion se fija el valor
   * nuevo (snapNext) animando la transicion, para no dejar la letra congelada
   * ni dar un salto brusco.
   */
  recomputeOffset() {
    if (!this.anchors.length) return;
    const offsets = this.anchors.map((a) => a.wallSec - a.songSec).sort((x, y) => x - y);
    const mid = offsets.length >> 1;
    const median = offsets.length % 2 ? offsets[mid] : (offsets[mid - 1] + offsets[mid]) / 2;

    if (!this.hasOffset || this.snapNext) {
      const previous = this.hasOffset ? this.offsetSec : null;
      const reason = this.snapNext ? 'resync' : 'init';
      this.offsetSec = median;
      this.hasOffset = true;
      this.snapNext = false;
      if (previous !== null && Math.abs(previous - median) > 0.05) {
        // delta = nuevo - viejo: en t=0 la posicion sigue valiendo lo mismo
        // (continuidad, sin tiron) y al final de la animacion ya usa el nuevo.
        this.correction = { delta: median - previous, startAt: nowSec(), reason };
      }
      return;
    }

    const alpha = CONFIG.sync.smoothingAlpha;
    this.offsetSec = alpha * median + (1 - alpha) * this.offsetSec;
  }

  /**
   * Deriva entre la primera y la ultima ancla reciente.
   * Positiva -> la letra va por delante de la musica (o la musica se pauso).
   */
  computeDrift() {
    const usable = this.anchors.filter((a) => Number.isFinite(a.songSec));
    if (usable.length < CONFIG.sync.minAnchorsForDrift) {
      this.driftSec = 0;
      this.severity = SEVERITY.NONE;
      return;
    }

    const first = usable[0];
    const last = usable[usable.length - 1];
    const separation = last.wallSec - first.wallSec;
    if (separation < CONFIG.sync.minAnchorSeparationSec) {
      this.driftSec = 0;
      this.severity = SEVERITY.NONE;
      return;
    }

    const expected = last.songSec - first.songSec;
    this.driftSec = separation - expected;

    const abs = Math.abs(this.driftSec);
    if (abs >= CONFIG.sync.driftHardSec) this.severity = SEVERITY.HARD;
    else if (abs >= CONFIG.sync.driftSoftSec) this.severity = SEVERITY.SOFT;
    else this.severity = SEVERITY.NONE;

    // La musica no avanzo mientras el reloj si: probable pausa, no desincronia.
    this.pauseSuspected = this.driftSec > CONFIG.sync.driftSoftSec && Math.abs(expected) < 1.5;
  }

  /**
   * Posicion actual en la cancion, con la correccion animada aplicada.
   * Se apoya en el ultimo offset valido aunque no haya anclas: durante una
   * re-sincronizacion la letra sigue avanzando en vez de quedarse congelada.
   */
  positionAt(wallSec = nowSec()) {
    if (!this.hasOffset) return null;
    let position = wallSec - this.offsetSec + this.manualOffsetSec;

    if (this.correction) {
      const elapsed = (nowSec() - this.correction.startAt) * 1000;
      const t = Math.min(1, elapsed / CONFIG.sync.correctionAnimationMs);
      const ease = t * t * (3 - 2 * t);
      position += (1 - ease) * this.correction.delta;
      if (t >= 1) this.correction = null;
    }
    return position;
  }

  /** Ajuste fino manual: desplaza la letra sin tocar el modelo de anclas. */
  setManualOffset(seconds) {
    this.manualOffsetSec = Number(seconds) || 0;
    return this.manualOffsetSec;
  }

  nudge(deltaSec = CONFIG.sync.manualNudgeSec) {
    return this.setManualOffset(this.manualOffsetSec + deltaSec);
  }

  /** Deriva de la posicion actual respecto a la ultima ancla. */
  currentDriftSec(wallSec = nowSec()) {
    const position = this.positionAt(wallSec);
    const last = this.anchors[this.anchors.length - 1];
    if (position === null || !last) return 0;
    const expectedNow = last.songSec + (wallSec - last.wallSec);
    return expectedNow - position;
  }

  /**
   * Confianza 0..1. Es honesta: con AudD el timecode es de 1 segundo, asi que
   * nunca pasa de ~0.8 por muy bien que vaya todo.
   */
  confidence() {
    if (!this.anchors.length) return 0;
    const granularity = this.anchors[this.anchors.length - 1].granularitySec || 1;
    const granularityScore = granularity >= 1 ? 0.5 : granularity <= 0.05 ? 0.9 : 0.7;
    const countScore = Math.min(0.2, this.anchors.length * 0.05);
    const driftPenalty = Math.min(0.45, Math.abs(this.driftSec) / 8);
    const separation = this.anchors.length > 1
      ? this.anchors[this.anchors.length - 1].wallSec - this.anchors[0].wallSec
      : 0;
    const separationBonus = Math.min(0.15, separation / 200);
    return Math.max(0.05, Math.min(1, granularityScore + countScore + separationBonus - driftPenalty));
  }

  /** Debe el motor pedir una re-sincronizacion? */
  needsResync() {
    return this.severity === SEVERITY.SOFT || this.severity === SEVERITY.HARD;
  }

  /** Etiqueta legible de la direccion del desfase. */
  driftLabel() {
    const abs = Math.abs(this.driftSec).toFixed(1).replace('.', ',');
    if (this.severity === SEVERITY.NONE) return 'sincronizado';
    if (this.pauseSuspected) return `la musica parece en pausa (${abs} s)`;
    return this.driftSec > 0
      ? `la letra va ${abs} s por delante`
      : `la letra va ${abs} s por detras`;
  }

  snapshot() {
    return {
      offsetSec: this.offsetSec,
      hasOffset: this.hasOffset,
      manualOffsetSec: this.manualOffsetSec,
      driftSec: this.driftSec,
      severity: this.severity,
      anchors: this.anchors.length,
      confidence: this.confidence(),
      pauseSuspected: this.pauseSuspected,
      position: this.positionAt(),
    };
  }
}

