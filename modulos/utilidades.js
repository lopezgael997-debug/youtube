const fs = require('fs').promises;
const crypto = require('crypto');
const { DIR } = require('./config');

// =====================================================================
// UTILIDADES
// =====================================================================
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

async function existe(ruta) {
    try { await fs.access(ruta); return true; } catch { return false; }
}

async function crearCarpetas() {
    for (const d of Object.values(DIR)) await fs.mkdir(d, { recursive: true });
}

function extraerIdVideo(url) {
    const m = url.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/);
    return m ? m[1] : hash(url);
}

function slug(texto) {
    return String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'proyecto';
}

function decodificarEntidades(t) {
    return t
        .replace(/&amp;#39;|&#39;/g, "'")
        .replace(/&amp;quot;|&quot;/g, '"')
        .replace(/&amp;amp;|&amp;/g, '&')
        .replace(/&gt;/g, '>').replace(/&lt;/g, '<')
        .replace(/\[(Music|Applause|Música|Aplausos)\]/gi, '')
        .replace(/\s+/g, ' ').trim();
}

async function enParalelo(tareas, limite) {
    const resultados = new Array(tareas.length);
    let siguiente = 0;
    async function obrero() {
        while (true) {
            const k = siguiente++;
            if (k >= tareas.length) return;
            resultados[k] = await tareas[k]();
        }
    }
    await Promise.all(Array.from({ length: Math.min(limite, tareas.length) }, obrero));
    return resultados;
}

// --- JSON con auto-reparación ---
function repararJSON(crudo) {
    const ini = crudo.indexOf('{');
    if (ini === -1) throw new Error('La respuesta no contiene JSON.');
    let texto = crudo.slice(ini);
    const fin = texto.lastIndexOf('}');
    if (fin === -1) throw new Error('No hay JSON recuperable.');
    texto = texto.slice(0, fin + 1);
    for (const cierre of ['', ']}', ']}]}']) {
        try { return JSON.parse(texto + cierre); } catch { /* prueba el siguiente cierre */ }
    }
    throw new Error('El JSON está dañado y no se pudo reparar.');
}

function extraerJSON(crudo) {
    const ini = crudo.indexOf('{');
    const fin = crudo.lastIndexOf('}');
    if (ini === -1 || fin === -1) throw new Error('La respuesta no contiene JSON.');
    try {
        return JSON.parse(crudo.slice(ini, fin + 1));
    } catch {
        const datos = repararJSON(crudo);
        console.log('[Guionista] 🩹 La respuesta venía incompleta: se descartó el fragmento final y se rescató el resto.');
        return datos;
    }
}

function contarPalabras(texto) {
    return texto.trim().split(/\s+/).filter(Boolean).length;
}

function palabrasDeEscenas(escenas) {
    return escenas.reduce((a, e) => a + contarPalabras(e.narracion), 0);
}

module.exports = { hash, dormir, existe, crearCarpetas, extraerIdVideo, slug, decodificarEntidades, enParalelo, repararJSON, extraerJSON, contarPalabras, palabrasDeEscenas };
