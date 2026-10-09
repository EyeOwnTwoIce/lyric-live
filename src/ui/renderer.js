/** Renderizador: todo el acceso al DOM vive aqui. */
import { lineAt, wordAt } from '../lyrics/lrc.js';
import { formatOffset, formatPercent, formatClock } from '../util/time.js';

const $ = (id) => document.getElementById(id);

export class Renderer {
  constructor() {
    this.el = {
      statusPill: $('status-pill'),
      listenBtn: $('btn-listen'),
      listenLabel: $('listen-label'),
      hint: $('hint'),
      deviceLabel: $('device-label'),
      art: $('song-art'),
      title: $('song-title'),
      artist: $('song-artist'),
      meta: $('song-meta'),
      confidenceFill: $('confidence-fill'),
      confidenceText: $('confidence-text'),
      offsetDisplay: $('offset-display'),
      lyrics: $('lyrics'),
      driftBanner: $('drift-banner'),
      driftText: $('drift-text'),
      errorBox: $('error-box'),
      errorText: $('error-text'),
      errorAction: $('btn-error-action'),
      history: $('history-list'),
      diag: $('diag-list'),
      settings: $('settings-panel'),
      scrim: $('scrim'),
      settingsBtn: $('btn-settings'),
    };
    this.lines = [];
    this.lineEls = [];
    this.activeIndex = -1;
    this.estimated = false;
    this.wordEls = [];
  }

  /* ---------------- estado ---------------- */

  setStatus(state, text) {
    if (!this.el.statusPill) return;
    this.el.statusPill.dataset.state = state;
    this.el.statusPill.textContent = text;
    document.body.dataset.state = state;
  }

  setListening(listening) {
    document.body.dataset.listening = listening ? 'true' : 'false';
    if (this.el.listenBtn) {
      this.el.listenBtn.setAttribute('aria-pressed', listening ? 'true' : 'false');
      this.el.listenLabel.textContent = listening ? 'Parar' : 'Escuchar';
    }
  }

  setHint(html) {
    if (this.el.hint) this.el.hint.innerHTML = html;
  }

  setDevice(text) {
    if (!this.el.deviceLabel) return;
    if (!text) {
      this.el.deviceLabel.hidden = true;
      this.el.deviceLabel.textContent = '';
      return;
    }
    this.el.deviceLabel.hidden = false;
    this.el.deviceLabel.textContent = text;
  }

  /* ---------------- cancion ---------------- */

  setSong(song) {
    if (this.el.title) this.el.title.textContent = song.title || 'Sin deteccion todavia';
    if (this.el.artist) this.el.artist.textContent = song.artist || '';
    if (this.el.meta) {
      const parts = [];
      if (song.album) parts.push(song.album);
      if (song.durationSec) parts.push(formatClock(song.durationSec));
      if (song.isrc) parts.push(song.isrc);
      this.el.meta.textContent = parts.join(' · ');
    }
    if (this.el.art) {
      if (song.artworkUrl) {
        this.el.art.src = song.artworkUrl;
        this.el.art.classList.add('has-art');
      } else {
        this.el.art.removeAttribute('src');
        this.el.art.classList.remove('has-art');
      }
    }
  }

  /* ---------------- letra ---------------- */

  /**
   * @param {{lines:Array, estimated?:boolean, hasWordSync?:boolean,
   *          instrumental?:boolean, note?:string}} data
   */
  setLyrics(data) {
    const host = this.el.lyrics;
    if (!host) return;
    this.lines = data.lines || [];
    this.estimated = Boolean(data.estimated);
    this.activeIndex = -1;
    this.lineEls = [];
    this.wordEls = [];
    host.textContent = '';

    if (data.note) {
      const note = document.createElement('p');
      note.className = 'lyrics-note';
      note.textContent = data.note;
      host.appendChild(note);
    }

    if (data.instrumental && !this.lines.length) {
      const p = document.createElement('p');
      p.className = 'lyrics-empty';
      p.textContent = 'Cancion instrumental: no hay letra que mostrar.';
      host.appendChild(p);
      return;
    }

    if (!this.lines.length) {
      const p = document.createElement('p');
      p.className = 'lyrics-empty';
      p.textContent = 'No hay letra disponible para esta cancion.';
      host.appendChild(p);
      return;
    }

    const fragment = document.createDocumentFragment();
    this.lines.forEach((line) => {
      const p = document.createElement('p');
      p.className = 'lyric-line';
      if (line.words && line.words.length) {
        const spans = [];
        line.words.forEach((word) => {
          const span = document.createElement('span');
          span.className = 'word';
          span.textContent = `${word.text} `;
          p.appendChild(span);
          spans.push(span);
        });
        this.wordEls.push(spans);
      } else {
        p.textContent = line.text || '';
        this.wordEls.push(null);
      }
      fragment.appendChild(p);
      this.lineEls.push(p);
    });
    host.appendChild(fragment);
    host.scrollTop = 0;
  }

  /** Llamado en cada frame desde el bucle de reproduccion. */
  updatePlayback(position) {
    if (position === null || position === undefined || !this.lines.length) return;
    const index = lineAt(this.lines, position);
    if (index !== this.activeIndex) this.setActiveIndex(index);
    if (index >= 0) this.updateWords(index, position);
  }

  updateWords(index, position) {
    const spans = this.wordEls[index];
    const line = this.lines[index];
    if (!spans || !line || !line.words || !line.words.length) return -1;
    const active = wordAt(line.words, position);
    for (let i = 0; i < spans.length; i += 1) {
      spans[i].classList.toggle('on', i <= active);
    }
    return active;
  }



  setActiveIndex(index) {
    const previous = this.activeIndex;
    if (previous >= 0 && this.lineEls[previous]) {
      this.lineEls[previous].classList.remove('active', 'next');
      this.lineEls[previous].classList.add('past');
      const spans = this.wordEls[previous];
      if (spans) spans.forEach((s) => s.classList.remove('on'));
    }
    this.activeIndex = index;
    if (index < 0) return;

    const el = this.lineEls[index];
    if (!el) return;
    el.classList.remove('past');
    el.classList.add('active');

    const next = this.lineEls[index + 1];
    if (next) next.classList.add('next');
    this.scrollToLine(el);
  }

  /** Centra la linea activa dentro de su contenedor, sin mover la pagina. */
  scrollToLine(el) {
    const host = this.el.lyrics;
    if (!host || !el) return;
    const target = el.offsetTop - host.clientHeight / 2 + el.clientHeight / 2;
    host.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  /* ---------------- indicadores ---------------- */

  setConfidence(value) {
    const pct = Math.max(0, Math.min(1, value || 0));
    if (this.el.confidenceFill) this.el.confidenceFill.style.width = `${Math.round(pct * 100)}%`;
    if (this.el.confidenceText) {
      this.el.confidenceText.textContent = value ? formatPercent(pct) : '—';
    }
  }

  setOffsetDisplay(seconds) {
    if (this.el.offsetDisplay) this.el.offsetDisplay.textContent = formatOffset(seconds);
  }
}
