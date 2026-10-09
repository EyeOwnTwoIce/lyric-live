/**
 * Tests del motor de sincronia y del parser de letra.
 *
 * Son los dos modulos con logica pura y sutil, y hasta ahora tenian cobertura
 * cero. Se ejecutan sin dependencias:
 *
 *   node --test tools/      (o: npm test)
 *
 * No tocan red, ni DOM, ni audio.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { SyncEngine, SEVERITY } from '../src/sync/engine.js';
import { parseLRC, plainToLines, lineAt, progressInLine, wordAt } from '../src/lyrics/lrc.js';
import { parseTimecode, formatOffset } from '../src/util/time.js';
import { songKey } from '../src/util/text.js';
import { nowSec } from '../src/util/time.js';

/* ------------------------------------------------------------------ *
 * Motor de sincronia
 * ------------------------------------------------------------------ */

test('sin anclas no hay posicion: la letra no salta antes del primer reconocimiento', () => {
  const e = new SyncEngine();
  assert.equal(e.hasOffset, false);
  assert.equal(e.positionAt(100), null);
});

test('la primera ancla fija el offset directamente, sin suavizado', () => {
  const e = new SyncEngine();
  e.addAnchor({ songSec: 10, wallSec: 110, granularitySec: 1 });
  assert.equal(e.hasOffset, true);
  assert.equal(e.offsetSec, 100);
  assert.equal(e.positionAt(110), 10);
});

test('la posicion avanza con el reloj monotono', () => {
  const e = new SyncEngine();
  e.addAnchor({ songSec: 10, wallSec: 110, granularitySec: 1 });
  assert.equal(e.positionAt(115), 15);
  assert.equal(e.positionAt(125), 25);
});

test('un ancla desviada se descarta y no contamina el offset', () => {
  const e = new SyncEngine();
  e.addAnchor({ songSec: 10, wallSec: 110 }); // offset 100
  const rejected = e.addAnchor({ songSec: 90, wallSec: 110 }); // offset 20 -> absurdo
  assert.equal(rejected, null);
  assert.equal(e.anchors.length, 1);
  assert.equal(e.offsetSec, 100);
});

test('la segunda ancla se acerca a la mediana por suavizado, sin saltar', () => {
  const e = new SyncEngine();
  e.addAnchor({ songSec: 10, wallSec: 110 }); // 100
  e.addAnchor({ songSec: 20, wallSec: 125 }); // 105 -> mediana 102,5
  // alpha 0,4: 0,4 * 102,5 + 0,6 * 100 = 101
  assert.equal(Number(e.offsetSec.toFixed(4)), 101);
});

test('deriva entre 1,5 y 4 s se clasifica como leve (ofrecer re-sincronizar)', () => {
  const e = new SyncEngine();
  e.anchors = [
    { songSec: 0, wallSec: 1000, granularitySec: 1, weight: 1, at: 0 },
    { songSec: 7.5, wallSec: 1010, granularitySec: 1, weight: 1, at: 0 },
  ];
  e.computeDrift();
  assert.equal(e.severity, SEVERITY.SOFT);
  assert.equal(Number(e.driftSec.toFixed(2)), 2.5);
  assert.equal(e.needsResync(), true);
});

test('deriva por encima de 4 s se clasifica como grave (corregir ya)', () => {
  const e = new SyncEngine();
  e.anchors = [
    { songSec: 0, wallSec: 1000, granularitySec: 1, weight: 1, at: 0 },
    { songSec: 3, wallSec: 1010, granularitySec: 1, weight: 1, at: 0 },
  ];
  e.computeDrift();
  assert.equal(e.severity, SEVERITY.HARD);
  assert.equal(Number(e.driftSec.toFixed(2)), 7);
});

test('deriva con anclas demasiado juntas no se mide (evita falsos positivos)', () => {
  const e = new SyncEngine();
  e.anchors = [
    { songSec: 0, wallSec: 1000, granularitySec: 1, weight: 1, at: 0 },
    { songSec: 2, wallSec: 1003, granularitySec: 1, weight: 1, at: 0 },
  ];
  e.computeDrift();
  assert.equal(e.severity, SEVERITY.NONE);
});

test('si la musica no avanza mientras el reloj si, se detecta pausa', () => {
  const e = new SyncEngine();
  e.anchors = [
    { songSec: 30, wallSec: 1000, granularitySec: 1, weight: 1, at: 0 },
    { songSec: 30, wallSec: 1010, granularitySec: 1, weight: 1, at: 0 },
  ];
  e.computeDrift();
  assert.equal(e.pauseSuspected, true);
  // La severidad es grave en crudo, pero app.js consulta antes pauseSuspected
  // para no entrar en bucle de re-sincronizacion con la musica parada.
  assert.ok(e.driftLabel().includes('pausa'));
});

test('confianza: 0 sin anclas y nunca perfecta con granularidad de 1 s', () => {
  const e = new SyncEngine();
  assert.equal(e.confidence(), 0);
  e.addAnchor({ songSec: 10, wallSec: 110, granularitySec: 1 });
  const c = e.confidence();
  assert.ok(c > 0 && c <= 0.75, `confianza inesperada: ${c}`);
});

test('re-sincronizar sustituye el offset de golpe y sin tiron visible', () => {
  const e = new SyncEngine();
  e.addAnchor({ songSec: 10, wallSec: 110 }); // offset 100
  const before = e.positionAt(200);
  assert.equal(before, 100);

  // La letra se habia quedado 5 s atras; el mundo real dice offset 105.
  e.anchors = [];
  e.snapNext = true;
  e.addAnchor({ songSec: 95, wallSec: 200 });
  assert.equal(e.offsetSec, 105);

  // Justo en el instante de la correccion la posicion es continua (sin salto)...
  const rightAfter = e.positionAt(200);
  assert.ok(Math.abs(rightAfter - before) < 0.001, `salto de ${rightAfter - before} s`);

  // ...y al acabar la animacion ya vale el modelo nuevo.
  e.correction.startAt = nowSec() - 10;
  assert.equal(Number(e.positionAt(200).toFixed(3)), 95);
});

test('durante una re-sincronizacion la letra sigue avanzando, no se congela', () => {
  const e = new SyncEngine();
  e.addAnchor({ songSec: 10, wallSec: 110 });
  // Se vacian las anclas para re-sincronizar, pero el offset sigue siendo valido.
  e.anchors = [];
  e.snapNext = true;
  assert.notEqual(e.positionAt(130), null);
  assert.equal(e.positionAt(130), 30);
});

test('el ajuste manual desplaza la letra y se acumula', () => {
  const e = new SyncEngine();
  e.addAnchor({ songSec: 10, wallSec: 110 });
  assert.equal(e.setManualOffset(-1.5), -1.5);
  assert.equal(e.positionAt(110), 8.5);
  assert.equal(Number(e.nudge(0.25).toFixed(2)), -1.25);
  assert.equal(Number(e.positionAt(110).toFixed(2)), 8.75);
});

test('cambiar de cancion reinicia anclas y conserva el offset aprendido', () => {
  const e = new SyncEngine();
  e.addAnchor({ songSec: 10, wallSec: 110 });
  e.setSong({ key: 'otra' }, -2.5);
  assert.equal(e.anchors.length, 0);
  assert.equal(e.hasOffset, false);
  assert.equal(e.manualOffsetSec, -2.5);
  assert.equal(e.positionAt(110), null);
});

/* ------------------------------------------------------------------ *
 * Parser de letra
 * ------------------------------------------------------------------ */

test('LRC: etiquetas de tiempo, varias por linea, metadatos y offset global', () => {
  const lrc = [
    '[ar:Artista]',
    '[offset:+500]',
    '[00:10.00]Primera linea',
    '[00:12.50][00:20.00]Repetida',
  ].join('\n');
  const { lines, meta } = parseLRC(lrc);
  assert.equal(meta.ar, 'Artista');
  assert.equal(lines.length, 3);
  assert.equal(lines[0].text, 'Primera linea');
  assert.equal(lines[0].time, 9.5); // 10 s menos los 500 ms del offset
  assert.equal(lines[1].time, 12);
  assert.equal(lines[2].time, 19.5);
  assert.equal(lines[2].text, 'Repetida');
});

test('LRC: soporta centesimas, milisegundos y decimas', () => {
  const a = parseLRC('[00:01.5]x').lines[0].time;
  const b = parseLRC('[00:01.50]x').lines[0].time;
  const c = parseLRC('[00:01.500]x').lines[0].time;
  assert.equal(a, 1.5);
  assert.equal(b, 1.5);
  assert.equal(c, 1.5);
});

test('LRC: sincronia por palabra', () => {
  const { lines, hasWordSync } = parseLRC('[00:01.00]<00:01.00>Hola <00:02.00>mundo');
  assert.equal(hasWordSync, true);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].time, 1);
  assert.equal(lines[0].text, 'Hola mundo');
  assert.equal(lines[0].words.length, 2);
  assert.equal(lines[0].words[0].text, 'Hola');
  assert.equal(lines[0].words[1].time, 2);
});

test('LRC: lineas que solo traen marcas de palabra no se pierden', () => {
  const { lines } = parseLRC('<00:03.00>Solo palabras');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].time, 3);
  assert.equal(lines[0].text, 'Solo palabras');
});

test('LRC: ignora lineas vacias y sin tiempo', () => {
  const { lines } = parseLRC('texto suelto\n\n[00:05.00]de verdad');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].time, 5);
});

test('LRC: texto invalido no lanza, devuelve vacio', () => {
  assert.deepEqual(parseLRC(null).lines, []);
  assert.deepEqual(parseLRC('').lines, []);
  assert.deepEqual(parseLRC(undefined).lines, []);
});

test('letra sin sincronizar: se reparte por la duracion y se marca como estimada', () => {
  const r = plainToLines('Linea uno\nLinea dos\nLinea tres', 120);
  assert.equal(r.estimated, true);
  assert.equal(r.lines.length, 3);
  assert.ok(r.lines[0].time > 0 && r.lines[0].time < 120);
  assert.ok(r.lines[1].time > r.lines[0].time);
  assert.ok(r.lines[2].time > r.lines[1].time);
  assert.ok(r.lines[2].time < 120);
});

test('letra sin sincronizar y sin duracion: tiempos nulos, sin avance falso', () => {
  const r = plainToLines('a\nb', 0);
  assert.equal(r.lines.length, 2);
  assert.equal(r.lines[0].time, null);
});

test('letra vacia no produce lineas', () => {
  const r = plainToLines('', 100);
  assert.equal(r.lines.length, 0);
  assert.equal(r.estimated, false);
});

test('lineAt encuentra la linea activa y tolera fuera de rango', () => {
  const lines = [{ time: 10 }, { time: 20 }, { time: 30 }];
  assert.equal(lineAt(lines, 5), -1);
  assert.equal(lineAt(lines, 10), 0);
  assert.equal(lineAt(lines, 19.9), 0);
  assert.equal(lineAt(lines, 20), 1);
  assert.equal(lineAt(lines, 999), 2);
  assert.equal(lineAt([], 10), -1);
  assert.equal(lineAt(lines, null), -1);
});

test('progressInLine devuelve un progreso acotado entre 0 y 1', () => {
  const lines = [{ time: 10 }, { time: 20 }];
  assert.equal(progressInLine(lines, 0, 10), 0);
  assert.equal(progressInLine(lines, 0, 15), 0.5);
  assert.equal(progressInLine(lines, 0, 25), 1);
  assert.equal(progressInLine(lines, -1, 15), 0);
});

test('wordAt localiza la palabra activa', () => {
  const words = [{ time: 1 }, { time: 2 }, { time: 3 }];
  assert.equal(wordAt(words, 0.5), -1);
  assert.equal(wordAt(words, 1.5), 0);
  assert.equal(wordAt(words, 2.5), 1);
  assert.equal(wordAt(words, 99), 2);
  assert.equal(wordAt([], 1), -1);
});

/* ------------------------------------------------------------------ *
 * Utilidades
 * ------------------------------------------------------------------ */

test('parseTimecode acepta mm:ss, hh:mm:ss y numeros', () => {
  assert.equal(parseTimecode('00:56'), 56);
  assert.equal(parseTimecode('01:02:03'), 3723);
  assert.equal(parseTimecode('56'), 56);
  assert.equal(parseTimecode(12.5), 12.5);
  assert.equal(parseTimecode(''), null);
  assert.equal(parseTimecode('basura'), null);
  assert.equal(parseTimecode(null), null);
});

test('formatOffset usa signo y coma decimal', () => {
  assert.equal(formatOffset(1.25), '+1,25 s');
  assert.equal(formatOffset(-1.25), '−1,25 s');
  assert.equal(formatOffset(0), '0,00 s');
});

test('songKey prefiere el ISRC y tolera acentos, parentesis y duracion', () => {
  assert.equal(songKey({ isrc: 'US-UM7-14-14163' }), 'isrc_us um7 14 14163');
  const a = songKey({ artist: 'Beyoncé', title: 'Halo', durationSec: 261 });
  const b = songKey({ artist: 'beyonce', title: 'Halo  (Remastered)', durationSec: 262 });
  assert.equal(a, b);
});

/* __APPEND__ */
