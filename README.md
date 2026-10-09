# Letra en vivo

Webapp que **escucha la musica que suena alrededor, reconoce la cancion y muestra su letra sincronizada** en tiempo real. Funciona en iPhone, iPad, Mac, Windows y Linux con solo abrir una URL: no hay nada que instalar.

**URL:** https://eyeowntwoice.github.io/lyric-live/

---

## Como se usa

### En el iPhone (o iPad)

1. Abre la URL en **Safari**.
2. Pulsa **Escuchar** y acepta el permiso de microfono. En iOS el permiso exige un toque real: por eso es un boton y no se activa solo.
3. Acerca el dispositivo a la musica (a un metro o menos).
4. En **10-15 segundos** aparece la cancion con su caratula y la letra en modo karaoke.

Truco: en Safari, *Compartir > Anadir a pantalla de inicio* la deja como una app, sin barra de navegacion.

### En Mac / Windows / Linux

Igual, con cualquier navegador moderno. En pantalla grande el diseno se reparte en tres columnas: captura, letra y panel de diagnostico.

---

## Que hace

- **Boton de escucha**: pide el microfono y analiza el audio **en tu dispositivo**.
- **Reconocimiento de cancion**: envia clips cortos (9 s por defecto) a AudD y obtiene titulo, artista, album, caratula, duracion e ISRC.
- **Letra sincronizada**: la busca en LRCLIB, con cascada de tres estrategias y preferencia por las versiones con sincronia.
- **Karaoke**: resalta la linea activa, la centra y la mantiene legible; si la cancion trae sincronia por palabra, la resalta palabra a palabra.
- **Deteccion de desfase**: compara lo que avanza la cancion con lo que avanza el reloj. Si se separan, te avisa.
- **Re-sincronizacion con permiso**: cuando detecta desfase te pregunta si quieres que **vuelva a escuchar** para recolocar la letra. Puedes elegir *preguntar*, *automatico* o *nunca*.
- **Ajuste fino manual**: botones de +/- 0,25 s. El ajuste se recuerda por cancion, asi que la proxima vez ya sale alineada.
- **Cache local**: las letras ya descargadas se guardan en el dispositivo.
- **Cambio de cancion automatico**, historial de detecciones y panel de diagnostico copiable.

---

## Privacidad

- **Sin servidor propio**, sin cuentas, sin cookies y sin analitica.
- La captura, la codificacion de audio, el motor de sincronia y la interfaz corren **integramente en tu dispositivo**.
- Lo unico que sale a internet: un clip de audio de ~280 KB a `api.audd.io` y consultas de texto a `lrclib.net`.
- **Nunca se guarda ni se sube el audio grabado.**
- Tu token (si pones uno) se queda en el almacenamiento local de tu navegador.

Nota sobre iOS: si dejas de visitar la web durante unos 7 dias, Safari puede purgar su almacenamiento local y tendras que volver a pegar el token.

## Tu propio token de AudD (recomendado)

La app funciona desde el primer segundo con el **token publico de evaluacion** de AudD, pero esta limitado a **~10 peticiones al dia**, o sea una o dos canciones. Para uso real necesitas tu token:

1. Entra en **https://dashboard.audd.io/** y crea una cuenta (email + contrasena, **sin tarjeta**).
2. Verifica el email.
3. Copia el **API token** del panel.
4. En la app, abre **Ajustes**, pega el token en *Token de AudD* y guarda.

El plan gratuito incluye **300 peticiones durante 14 dias**. Despues, el plan Indie son **5 $/mes por 1000 peticiones**.

### Cuanto consume

Cada reconocimiento es una peticion. Con los valores por defecto (unos 2-3 al arrancar y luego una comprobacion de desfase cada 25 s) una cancion de 4 minutos gasta unas **10-15 peticiones**:

| Plan | Escucha aproximada |
|---|---|
| Prueba gratuita (300) | 20-25 canciones |
| Indie, 5 $/mes (1000) | 70-80 canciones |

Puedes gastar menos subiendo el intervalo de re-escucha en Ajustes, o mas bajandolo para una sincronia mas fiable.

---

## Desarrollo local

```bash
git clone https://github.com/EyeOwnTwoIce/lyric-live.git
cd lyric-live
./serve.sh            # macOS / Linux  -> http://localhost:8080
py tools/serve.py     # Windows
```

- `http://localhost` **si** permite microfono (localhost cuenta como contexto seguro).
- Abrirla desde el movil con la IP de tu red (`http://192.168.x.x:8080`) **no** funcionara: los navegadores exigen HTTPS para `getUserMedia`. Para el movil usa la URL publicada.
- El servidor de desarrollo es multihilo a proposito: el `python -m http.server` de serie es mono-hilo y provoca `ERR_CONNECTION_RESET` al cargar muchos modulos en paralelo.

Regenerar los iconos:

```bash
python3 tools/make-icons.py
```

---

## Estructura del proyecto

```
index.html                     Estructura de la interfaz
styles.css                     Diseno, temas claro/oscuro y responsive
manifest.webmanifest           Metadatos de app instalable
sw.js                          Service worker (red primero, cache de respaldo)
serve.sh / tools/serve.py      Servidor local multihilo
tools/make-icons.py            Generador de iconos sin dependencias
src/
  app.js                       Maquina de estados y orquestacion
  config.js                    Todos los parametros ajustables
  audio/
    capture.js                 getUserMedia, AudioContext y buffer circular
    recorder-worklet.js        AudioWorkletProcessor
    wav.js                     Remuestreo y codificacion WAV PCM16
  recognition/
    index.js                   Selector de proveedor y mensajes de error
    audd.js                    Cliente de AudD (verificado contra la API real)
    acrcloud.js                Adaptador opcional, desactivado (ver mas abajo)
  lyrics/
    lrclib.js                  Busqueda con cascada y puntuacion de candidatos
    lrc.js                     Parser LRC + utilidades de linea y tiempo
    cache.js                   Cache en IndexedDB
  sync/
    engine.js                  Anclas, offset, deriva y re-sincronizacion
  ui/
    renderer.js                Karaoke, indicadores y accesibilidad
    waveform.js                Onda del microfono en canvas
    toast.js                   Avisos flotantes
  util/
    log.js · storage.js · time.js · text.js
```

## Como funciona

```
Microfono ──▶ AudioWorklet ──▶ buffer circular (20 s)
                                    │ cada 8-25 s
                                    ▼
                        WAV 16 kHz mono (~280 KB)  ──▶ AudD
                                    │◀── artista, titulo, timecode, caratula
                                    ▼
                         LRCLIB /api/get + /api/search
                                    │◀── letra en formato LRC
                                    ▼
                Parser LRC ──▶ motor de sincronia ──▶ karaoke
```

El motor de sincronia parte de un modelo muy simple:

```
posicion_en_la_cancion(t) = t - offset + ajuste_manual
```

Cada reconocimiento aporta un **ancla** (posicion en la cancion + instante del reloj monotono). Con varias anclas se estima el `offset` por mediana (robusto ante resultados erroneos) y suavizado exponencial (sin saltos en pantalla). La **deriva** se calcula comparando el avance real de la cancion entre dos anclas con el avance del reloj, de modo que el sesgo constante del proveedor se cancela:

- menos de **1,5 s**: normal, solo se afina el offset;
- entre **1,5 y 4 s**: se ofrece re-sincronizar (banner, si la politica es *preguntar*);
- mas de **4 s**: se corrige sin preguntar, porque ahi ya no es una deriva sino una perdida de hilo.

**Re-sincronizar** significa olvidar el modelo viejo y escuchar un fragmento nuevo inmediatamente. La letra se congela uno o dos segundos y se recoloca con una transicion suave.

---

## Compatibilidad

| | iOS Safari | Safari macOS | Chrome / Edge | Firefox |
|---|---|---|---|---|
| Captura (AudioWorklet) | 14.5+ | 14.1+ | si | si |
| Fallback ScriptProcessorNode | si | si | si | si |
| Wake Lock (pantalla encendida) | 16.4+ | 16.4+ | si | no (se ignora) |
| App instalable | si | — | si | si |

Notas de implementacion pensadas para iOS:

- Las constraints de audio **desactivan el procesado de voz** (`echoCancellation`, `noiseSuppression`, `autoGainControl` en `false`). Sin esto, iOS aplica el modo llamada y el reconocimiento musical se degrada muchisimo.
- El `AudioContext` se crea y se reanuda **dentro** del gesto del boton.
- La codificacion es WAV propio, no `MediaRecorder`, para que el mismo clip suene igual en todos los navegadores (Safari entrega AAC/MP4 y Chrome Opus/WebM).
- Al pasar a segundo plano la escucha se pausa, y al volver se reanuda el contexto de audio.

---

## Problemas frecuentes

| Sintoma | Que hacer |
|---|---|
| *Permiso de microfono denegado* | iOS: Ajustes > Safari > Microfono. O toca el icono de la barra de direcciones. |
| *No reconozco la cancion* | Sube el volumen, acerca el dispositivo y evita ruido de fondo. El microfono del movil satura por encima de cierto volumen. |
| *Cuota de AudD agotada* | Estas usando el token de evaluacion (10/dia). Pega el tuyo en Ajustes. |
| La letra va desfasada siempre | Usa los botones de +/- 0,25 s; el ajuste se guarda para esa cancion. |
| *No hay letra disponible* | LRCLIB no tiene esa cancion. La app muestra titulo y caratula igualmente. |
| La letra se mueve a tirones | Es normal mientras se acumulan las primeras anclas. |
| No arranca el microfono en el ordenador | Asegurate de abrir `http://localhost` y no la IP de la red local. |

Para depurar en el iPhone (donde no hay consola de desarrollo): boton **Copiar diagnostico**, o en la barra de direcciones `javascript:letraEnVivo.engine.snapshot()`.

---

## Limites conocidos, dichos claramente

- **El reconocimiento necesita internet.** Identificar una cancion exige una base de datos de millones de temas; no existe una version totalmente offline. La letra tambien se descarga. Si, en cambio, la captura, el motor de sincronia y la interfaz son 100 % locales.
- **Precision de sincronia de +-1 a 3 s** con AudD, porque su `timecode` tiene granularidad de un segundo y la posicion exacta dentro del clip es aproximada. Para lineas de karaoke es perfectamente usable, y el ajuste manual lo deja fino. La barra de *confianza* refleja esto de forma honesta: con AudD nunca llega al 100 %.
- **Para precision de milisegundos** habria que usar ACRCloud, que devuelve `play_offset_ms`. Su adaptador esta incluido (`src/recognition/acrcloud.js`) pero **desactivado**: su API exige firmar cada peticion con HMAC-SHA1 y un secreto, lo que obliga a un proxy o a exponer la clave en el navegador.
- **Cobertura de letras**: alta en musica popular, pero LRCLIB no tiene todo. Cuando solo hay letra sin sincronizar, se reparte por duracion y la app **avisa** de que los tiempos son estimados.
- **Consumo**: AudD cobra por peticion. Esta app es para *poner una cancion y ver la letra*, no para tenerla escuchando 24 horas.

---

## Licencia

MIT.


