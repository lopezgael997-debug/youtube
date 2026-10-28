const fs = require('fs').promises;
const path = require('path');
const { CFG, DIR } = require('./config');
const { ejecutarFfmpeg, argsCodecVideo, ejecutarRender } = require('./ffmpeg');
const { existe } = require('./utilidades');

// =====================================================================
// AGENTE EDITOR: clips, subtítulos, música y render final
// =====================================================================
async function renderizarEscena({ imagen, audio, duracion, indice, carpeta, formato }) {
    const nombre = `escena_${String(indice).padStart(3, '0')}.mp4`;
    const destino = path.join(carpeta, nombre);
    if (await existe(destino)) return nombre;

    const par = (n) => Math.round(n / 2) * 2;
    const W = formato.ancho, H = formato.alto;
    const frames = Math.max(1, Math.round(duracion * CFG.fps));
    const paso = (0.18 / frames).toFixed(6);
    const zoom = indice % 2 === 0
        ? `min(zoom+${paso},1.18)`
        : `if(eq(on,0),1.18,max(zoom-${paso},1.0))`;
    const fade = 0.4;

    const filtro = [
        `scale=${par(W * 1.4)}:${par(H * 1.4)}:flags=lanczos:force_original_aspect_ratio=increase`,
        `crop=${par(W * 1.4)}:${par(H * 1.4)}`,
        `zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${CFG.fps}`,
        `fade=t=in:st=0:d=${fade}`,
        `fade=t=out:st=${Math.max(0, duracion - fade).toFixed(2)}:d=${fade}`,
        'format=yuv420p'
    ].join(',');

    const temporal = path.join(carpeta, `tmp_${nombre}`);
    await ejecutarRender(() => [
        '-i', imagen, '-i', audio,
        '-vf', filtro,
        '-af', 'apad',
        '-t', duracion.toFixed(3),
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

function generarSubtitulosAss(escenas, formato) {
    const cabecera = `[Script Info]
ScriptType: v4.00+
PlayResX: ${formato.ancho}
PlayResY: ${formato.alto}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${formato.fuente},${formato.colorSub},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${formato.outline},1,2,${formato.margenH},${formato.margenH},${formato.margenV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
    const lineas = [];
    let inicioEscena = 0;

    for (const esc of escenas) {
        const palabras = esc.narracion.replace(/\s+/g, ' ').trim().split(' ');
        const trozos = [];
        for (let i = 0; i < palabras.length; i += formato.palabrasSub) {
            trozos.push(palabras.slice(i, i + formato.palabrasSub).join(' '));
        }
        const totalCaracteres = trozos.reduce((a, t) => a + t.length, 0);
        const tiempoVoz = esc.duracion - CFG.pausaEscena;
        let t = inicioEscena;

        for (const trozo of trozos) {
            const dur = tiempoVoz * (trozo.length / totalCaracteres);
            const texto = trozo.replace(/[{}]/g, '').replace(/\\/g, '');
            lineas.push(`Dialogue: 0,${formatoTiempoAss(t)},${formatoTiempoAss(t + dur)},Default,,0,0,0,,${texto}`);
            t += dur;
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

async function ensamblarVideo({ clips, escenas, carpeta, nichoKey, destinoFinal, formato }) {
    await fs.writeFile(path.join(carpeta, 'lista.txt'), clips.map(c => `file '${c}'`).join('\n'), 'utf-8');
    await ejecutarFfmpeg(['-f', 'concat', '-safe', '0', '-i', 'lista.txt', '-c', 'copy', 'union.mp4'], carpeta);

    await fs.writeFile(path.join(carpeta, 'subs.ass'), generarSubtitulosAss(escenas, formato), 'utf-8');
    const musica = await elegirMusica(nichoKey);

    if (musica) {
        console.log(`[Editor] 🎵 Música de fondo: ${path.basename(musica)}`);
        await ejecutarRender(() => [
            '-i', 'union.mp4',
            '-stream_loop', '-1', '-i', musica,
            '-filter_complex',
            '[0:v]subtitles=subs.ass[v];[1:a]volume=0.10[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]',
            '-map', '[v]', '-map', '[a]',
            ...argsCodecVideo(),
            '-c:a', 'aac', '-b:a', '192k',
            '-movflags', '+faststart',
            'final.mp4'
        ], carpeta);
    } else {
        await ejecutarRender(() => [
            '-i', 'union.mp4',
            '-vf', 'subtitles=subs.ass',
            ...argsCodecVideo(),
            '-c:a', 'copy',
            '-movflags', '+faststart',
            'final.mp4'
        ], carpeta);
    }
    await fs.copyFile(path.join(carpeta, 'final.mp4'), destinoFinal);
}

module.exports = { renderizarEscena, formatoTiempoAss, generarSubtitulosAss, elegirMusica, ensamblarVideo };
