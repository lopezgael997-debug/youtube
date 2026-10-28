const fs = require('fs').promises;
const path = require('path');
const { CFG, DIR } = require('./config');

// =====================================================================
// CALIBRACIÓN DE DURACIÓN (aprende cuántas palabras por minuto dice tu voz)
// =====================================================================
const ARCHIVO_CALIBRACION = path.join(DIR.cache, 'calibracion.json');

async function leerCalibracion() {
    try { return JSON.parse(await fs.readFile(ARCHIVO_CALIBRACION, 'utf-8')); } catch { return {}; }
}

async function wpmPara(voz) {
    const c = await leerCalibracion();
    const muestras = c[voz] || [];
    if (!muestras.length) return CFG.palabrasPorMinuto;
    return muestras.reduce((a, b) => a + b, 0) / muestras.length;
}

async function registrarCalibracion(voz, palabras, segundos) {
    if (segundos < 60 || palabras < 50) return;
    const c = await leerCalibracion();
    const wpm = Number((palabras / (segundos / 60)).toFixed(1));
    c[voz] = [...(c[voz] || []), wpm].slice(-5);
    await fs.writeFile(ARCHIVO_CALIBRACION, JSON.stringify(c, null, 1), 'utf-8');
    console.log(`[Sistema] 📐 Calibración: tu voz rinde ≈ ${wpm} palabras/min (se usará para planear los próximos videos).`);
}

// =====================================================================
// HISTORIAL LOCAL (anti-repetición por canal)
// =====================================================================
const ARCHIVO_HISTORIAL = path.join(DIR.cache, 'historial.json');

async function leerHistorial() {
    try { return JSON.parse(await fs.readFile(ARCHIVO_HISTORIAL, 'utf-8')); } catch { return []; }
}

async function registrarHistorial(entrada) {
    const h = await leerHistorial();
    h.push(entrada);
    await fs.writeFile(ARCHIVO_HISTORIAL, JSON.stringify(h, null, 1), 'utf-8');
}

async function temasPrevios(canalId) {
    const h = await leerHistorial();
    return h.filter(x => x.canal === canalId).slice(-40).map(x => x.titulo_youtube || x.titulo);
}

module.exports = { ARCHIVO_CALIBRACION, leerCalibracion, wpmPara, registrarCalibracion, ARCHIVO_HISTORIAL, leerHistorial, registrarHistorial, temasPrevios };
