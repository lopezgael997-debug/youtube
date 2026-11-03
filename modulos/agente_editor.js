const fs = require('fs').promises;
const path = require('path');
const { CFG, DIR } = require('./config');
const { ejecutarFfmpeg, argsCodecVideo, ejecutarRender, duracionAudio } = require('./ffmpeg');
const { existe, hash } = require('./utilidades');

// =====================================================================
// AGENTE EDITOR: clips, subtítulos, música y render final
// =====================================================================
const VERSION_EFECTOS = 'v3';   // súbela cuando cambies los efectos: así no se reusan clips viejos de una corrida interrumpida
const SOBREMUESTREO = 1.4;      // si ves "temblor" en los zooms lentos, súbelo a 2 (cuesta más CPU)
const ZOOM_MIN = 1.08;          // el zoom out nunca baja de aquí: los bordes de la imagen (donde la IA suele deformar) quedan fuera de cuadro
const ESCENAS_APERTURA = 6;     // primeras escenas del video largo con 2 planos (corte cada ~3 s): ahí se pierde más audiencia
const FADE = 0.12;              // casi un corte seco; pon 0 para cortes totalmente secos

// Movimientos de cámara. p = avance suave 0→1 (arranca y frena sin tirón)
const avance = (N) => `(3*pow(on/${N},2)-2*pow(on/${N},3))`;
const CX = 'iw/2-(iw/zoom/2)';
const CY = 'ih/2-(ih/zoom/2)';
const MOVIMIENTOS = {
    acercar: (p) => ({ z: `1.05+0.17*${p}`, x: CX, y: CY }),
    alejar: (p) => ({ z: `1.22-${(1.22 - ZOOM_MIN).toFixed(2)}*${p}`, x: CX, y: CY }),
    izqDer: (p) => ({ z: '1.16', x: `(iw-iw/zoom)*${p}`, y: CY }),
    derIzq: (p) => ({ z: '1.16', x: `(iw-iw/zoom)*(1-${p})`, y: CY }),
    subir: (p) => ({ z: '1.16', x: CX, y: `(ih-ih/zoom)*(1-${p})` })
};
const LISTA_HORIZONTAL = ['acercar', 'derIzq', 'alejar', 'izqDer'];
const LISTA_VERTICAL = ['acercar', 'subir', 'alejar', 'izqDer', 'derIzq'];

// Cuántos planos (cortes) lleva una escena. Un plano = un encuadre/movimiento distinto de la MISMA imagen,
// así el ritmo sube sin generar más imágenes en ComfyUI.
function planosPorEscena(indice, duracion, formato) {
    if (duracion < 3.6) return 1;
    const esShort = formato.alto > formato.ancho;
    return (esShort || indice < ESCENAS_APERTURA) ? 2 : 1;
}

async function renderizarEscena({ imagen, audio, duracion, indice, total, carpeta, formato }) {
    const par = (n) => Math.round(n / 2) * 2;
    const W = formato.ancho, H = formato.alto;
    const frames = Math.max(1, Math.round(duracion * CFG.fps));
    const durReal = frames / CFG.fps;

    const huella = hash(`${path.basename(imagen)}|${frames}|${W}x${H}|${VERSION_EFECTOS}`).slice(0, 6);
    const nombre = `escena_${String(indice).padStart(3, '0')}_${huella}.mp4`;
    const destino = path.join(carpeta, nombre);
    if (await existe(destino)) return nombre;

    const SW = par(W * SOBREMUESTREO), SH = par(H * SOBREMUESTREO);
    const base = `scale=${SW}:${SH}:flags=lanczos:force_original_aspect_ratio=increase,crop=${SW}:${SH}`;

    // Reparto de frames entre los planos
    const n = planosPorEscena(indice, durReal, formato);
    const reparto = [];
    let usados = 0;
    for (let k = 0; k < n; k++) {
        const f = k === n - 1 ? frames - usados : Math.round(frames / n);
        reparto.push(f);
        usados += f;
    }

    const lista = formato.alto > formato.ancho ? LISTA_VERTICAL : LISTA_HORIZONTAL;
    const entradas = reparto.map((_, k) => `[r${k}]`).join('');
    const salidas = reparto.map((_, k) => `[p${k}]`).join('');
    const partes = [n === 1 ? `[0:v]${base}[r0]` : `[0:v]${base},split=${n}${entradas}`];
    reparto.forEach((f, k) => {
        // 7 y 3 son coprimos con 4 y 5: escenas seguidas nunca repiten movimiento
        const m = MOVIMIENTOS[lista[(indice * 7 + k * 3) % lista.length]](avance(f));
        partes.push(`[r${k}]zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${f}:s=${W}x${H}:fps=${CFG.fps}[p${k}]`);
    });

    // Fundidos: ni la primera escena (el primer frame de un Short no debe ser negro) ni la última (el Short enlaza con su inicio)
    const cola = [];
    if (FADE > 0 && indice > 0) cola.push(`fade=t=in:st=0:d=${FADE}`);
    if (FADE > 0 && indice < total - 1) cola.push(`fade=t=out:st=${Math.max(0, durReal - FADE).toFixed(3)}:d=${FADE}`);
    cola.push('format=yuv420p');
    partes.push(n === 1
        ? `[p0]${cola.join(',')}[v]`
        : `${salidas}concat=n=${n}:v=1:a=0,${cola.join(',')}[v]`);

    const temporal = path.join(carpeta, `tmp_${nombre}`);
    await ejecutarRender(() => [
        '-i', imagen, '-i', audio,
        '-filter_complex', partes.join(';'),
        '-map', '[v]', '-map', '1:a',
        '-af', 'apad',
        '-t', durReal.toFixed(3),
        ...argsCodecVideo(),
        '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
        '-r', String(CFG.fps),
        temporal
    ]);
    await fs.rename(temporal, destino);
    return nombre;
}

function formatoTiempoAss(seg) {
    const cs = Math.round(seg * 100);
    const h = Math.floor(cs / 360000);
    const m = Math.floor((cs % 360000) / 6000);
    const s = Math.floor((cs % 6000) / 100);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

function generarSubtitulosAss(escenas, formato, ganchoTexto) {
    const cabecera = `[Script Info]
ScriptType: v4.00+
PlayResX: ${formato.ancho}
PlayResY: ${formato.alto}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${formato.fuente},${formato.colorSub},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${formato.outline},1,2,${formato.margenH},${formato.margenH},${formato.margenV},1
Style: Gancho,Arial,${Math.round(formato.fuente * 1.5)},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${formato.outline + 3},2,8,${formato.margenH},${formato.margenH},${Math.round(formato.alto * 0.18)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
    const lineas = [];
    let inicioEscena = 0;

    // Texto grande de los primeros 2-3 segundos (Shorts): entra con un pequeño "golpe" de tamaño
    const gancho = String(ganchoTexto || '').replace(/[{}]/g, '').replace(/\\/g, '').trim();
    if (gancho) {
        lineas.push(`Dialogue: 1,${formatoTiempoAss(0)},${formatoTiempoAss(2.8)},Gancho,,0,0,0,,{\\fad(60,250)\\fscx135\\fscy135\\t(0,220,\\fscx100\\fscy100)}${gancho}`);
    }

    // Palabra activa resaltada (estilo Shorts): el trozo se mantiene en pantalla y cambia de color la palabra que se está diciendo.
    // Verticales: base amarilla → resalta en blanco. Horizontal: base blanca → resalta en dorado. (Colores en formato &HBBGGRR&)
    const RESALTE = formato.alto > formato.ancho ? '&HFFFFFF&' : '&H00D7FF&';
    // Peso de cada palabra: sus letras + una pausa extra si termina en puntuación (la voz se detiene ahí)
    const peso = (p) => p.length + (/[.,;:!?…]$/.test(p) ? 4 : 0);

    for (const esc of escenas) {
        const palabras = esc.narracion.replace(/\s+/g, ' ').trim().split(' ')
            .map(p => p.replace(/[{}]/g, '').replace(/\\/g, '')).filter(Boolean);
        const trozos = [];
        for (let i = 0; i < palabras.length; i += formato.palabrasSub) {
            trozos.push(palabras.slice(i, i + formato.palabrasSub));
        }
        const totalPeso = palabras.reduce((a, p) => a + peso(p), 0) || 1;
        const tiempoVoz = esc.duracion - CFG.pausaEscena;
        let t = inicioEscena;

        for (const trozo of trozos) {
            for (let k = 0; k < trozo.length; k++) {
                const dur = tiempoVoz * (peso(trozo[k]) / totalPeso);
                const texto = trozo.map((p, j) => (j === k ? `{\\c${RESALTE}}${p}{\\r}` : p)).join(' ');
                lineas.push(`Dialogue: 0,${formatoTiempoAss(t)},${formatoTiempoAss(t + dur)},Default,,0,0,0,,${texto}`);
                t += dur;
            }
        }
        inicioEscena += esc.duracion;
    }
    return cabecera + lineas.join('\n') + '\n';
}

async function elegirMusica(nichoKey) {
    for (const carpeta of [path.join(DIR.musica, nichoKey), DIR.musica]) {
        try {
            const archivos = (await fs.readdir(carpeta)).filter(f => /\.(mp3|wav|m4a|ogg)$/i.test(f));
            if (archivos.length) return path.join(carpeta, archivos[Math.floor(Math.random() * archivos.length)]);
        } catch { /* la carpeta no existe */ }
    }
    return null;
}

// Golpe grave sintético (bombo con caída de tono) para el inicio de los Shorts; no necesita ningún archivo
const GOLPE_INICIAL = 'aevalsrc=0.9*sin(2*PI*(50+90*exp(-14*t))*t)*exp(-5*t):d=0.8:s=44100';

// Cadena de audio: voz + música que BAJA sola cuando habla la voz (ducking) + golpe inicial, todo nivelado a -14 LUFS.
// idxMusica / idxGolpe: número de la entrada de ffmpeg (null si no hay). total: segundos del video.
function cadenaAudio({ idxMusica, idxGolpe, total }) {
    const f = [];
    let mezcla = '[0:a]';
    if (idxMusica !== null) {
        f.push('[0:a]asplit=2[voz][sc]');
        f.push(`[${idxMusica}:a]volume=0.30,afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, total - 3).toFixed(2)}:d=3[m0]`);
        f.push('[m0][sc]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=400[m]');
        f.push('[voz][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mx]');
        mezcla = '[mx]';
    }
    if (idxGolpe !== null) {
        f.push(`[${idxGolpe}:a]volume=0.7[h]`);
        f.push(`${mezcla}[h]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mx2]`);
        mezcla = '[mx2]';
    }
    // loudnorm sube internamente a 192 kHz: se devuelve a 44.1 kHz
    f.push(`${mezcla}loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100[a]`);
    return f.join(';');
}

async function ensamblarVideo({ clips, escenas, carpeta, nichoKey, destinoFinal, formato, ganchoTexto }) {
    await fs.writeFile(path.join(carpeta, 'lista.txt'), clips.map(c => `file '${c}'`).join('\n'), 'utf-8');
    await ejecutarFfmpeg(['-f', 'concat', '-safe', '0', '-i', 'lista.txt', '-c', 'copy', 'union.mp4'], carpeta);

    // Chequeo de sincronía: los subtítulos se calculan con la suma de duraciones de las escenas.
    // Si el video unido dura distinto, los subtítulos se irán desfasando en videos largos.
    const esperado = escenas.reduce((a, e) => a + e.duracion, 0);
    try {
        const real = await duracionAudio(path.join(carpeta, 'union.mp4'));
        const dif = real - esperado;
        if (Math.abs(dif) > 0.3) {
            console.log(`[Editor] ⚠️ El video unido dura ${real.toFixed(2)} s y las escenas suman ${esperado.toFixed(2)} s (${dif >= 0 ? '+' : ''}${dif.toFixed(2)} s): los subtítulos pueden ir desfasados.`);
        }
    } catch { /* es solo un chequeo */ }

    await fs.writeFile(path.join(carpeta, 'subs.ass'), generarSubtitulosAss(escenas, formato, ganchoTexto), 'utf-8');
    const musica = await elegirMusica(nichoKey);
    if (musica) console.log(`[Editor] 🎵 Música de fondo: ${path.basename(musica)}`);

    // Una sola pasada: subtítulos + música con ducking + golpe + nivelado de volumen
    const renderFinal = (conGolpe) => {
        const entradas = ['-i', 'union.mp4'];
        let siguiente = 1, idxMusica = null, idxGolpe = null;
        if (musica) { entradas.push('-stream_loop', '-1', '-i', musica); idxMusica = siguiente++; }
        if (conGolpe) { entradas.push('-f', 'lavfi', '-i', GOLPE_INICIAL); idxGolpe = siguiente++; }
        const filtro = `[0:v]subtitles=subs.ass[v];${cadenaAudio({ idxMusica, idxGolpe, total: esperado })}`;
        return ejecutarRender(() => [
            ...entradas,
            '-filter_complex', filtro,
            '-map', '[v]', '-map', '[a]',
            ...argsCodecVideo(),
            '-c:a', 'aac', '-b:a', '192k',
            '-shortest', // loudnorm deja ~0.1 s de cola de audio: se corta al terminar el video
            '-movflags', '+faststart',
            'final.mp4'
        ], carpeta);
    };

    if (ganchoTexto) {
        try {
            await renderFinal(true);
        } catch (e) {
            console.log(`[Editor] ⚠️ No se pudo añadir el golpe de sonido (el short se hace sin él): ${e.message.split('\n')[0]}`);
            await renderFinal(false);
        }
    } else {
        await renderFinal(false);
    }
    await fs.copyFile(path.join(carpeta, 'final.mp4'), destinoFinal);
}

module.exports = { renderizarEscena, formatoTiempoAss, generarSubtitulosAss, elegirMusica, cadenaAudio, ensamblarVideo };
