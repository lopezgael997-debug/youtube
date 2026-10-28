require('./config'); // carga el .env antes de leer variables de entorno
const { spawn } = require('child_process');
const { RAIZ } = require('./config');

const ffmpegPath = process.env.FFMPEG_PATH || require('ffmpeg-static');

let usarGPU = !process.env.FORZAR_CPU;

function ejecutarFfmpeg(args, cwd) {
    return new Promise((resolve, reject) => {
        const p = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args], { cwd: cwd || RAIZ });
        let err = '';
        p.stderr.on('data', d => { err += d.toString(); });
        p.on('error', reject);
        p.on('close', code => {
            if (code === 0) resolve(err);
            else reject(new Error(`ffmpeg falló (código ${code}):\n${err.slice(-900)}`));
        });
    });
}

async function duracionAudio(ruta) {
    const salida = await new Promise((resolve) => {
        const p = spawn(ffmpegPath, ['-hide_banner', '-i', ruta]);
        let err = '';
        p.stderr.on('data', d => { err += d.toString(); });
        p.on('close', () => resolve(err));
    });
    const m = salida.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    if (!m) throw new Error(`No se pudo leer la duración de ${ruta}`);
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

async function detectarGPU() {
    if (!usarGPU) return;
    try {
        const salida = await new Promise((resolve) => {
            const p = spawn(ffmpegPath, ['-hide_banner', '-encoders']);
            let out = '';
            p.stdout.on('data', d => { out += d.toString(); });
            p.on('close', () => resolve(out));
        });
        if (!salida.includes('h264_nvenc')) {
            usarGPU = false;
            console.log('[Sistema] ⚠️ Este ffmpeg no incluye NVENC. Se usará CPU (libx264).');
            console.log('          Instala un ffmpeg "full" y define FFMPEG_PATH en .env para usar tu GPU.');
        } else {
            console.log('[Sistema] 🟢 NVENC disponible: el render usará tu GPU.');
        }
    } catch {
        usarGPU = false;
    }
}

function argsCodecVideo() {
    return usarGPU
        ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '21', '-b:v', '0']
        : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20'];
}

async function ejecutarRender(construirArgs, cwd) {
    try {
        await ejecutarFfmpeg(construirArgs(), cwd);
    } catch (e) {
        if (!usarGPU) throw e;
        console.log('[Sistema] ⚠️ NVENC falló, cambiando a CPU para el resto del proceso.');
        usarGPU = false;
        await ejecutarFfmpeg(construirArgs(), cwd);
    }
}

module.exports = { ejecutarFfmpeg, duracionAudio, detectarGPU, argsCodecVideo, ejecutarRender, ffmpegPath };
