// =====================================================================
// AGENTE MINIATURISTA
// Crea varias miniaturas por video: pinta un fondo distinto con tu generador
// de imágenes (ComfyUI/Forge), elige un diseño según el canal y la historia,
// y las compone con Puppeteer. Si algo falla, NO detiene el video.
// =====================================================================
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { FORMATOS } = require('./config');
const { pintarLibre } = require('./agente_pintor');
const { ANCHO, ALTO, esc, numeroDeTexto, PLANTILLAS, armarHTML, ajustarTextos, fondoComoDataURI } = require('./miniatura_plantillas');
const { textoConResalte } = require('./miniatura_plantillas');

const CONFIG = {
    carpetaSalida: path.join(__dirname, '..', 'miniaturas_prueba'),
    variantesPorDefecto: 3,
    maxKB: 1900   // YouTube pide menos de 2 MB
};

// Qué plantillas usa cada nicho (si el canal no define "plantillas" en canales.json)
const PLANTILLAS_POR_NICHO = {
    iceberg: ['nivel', 'impacto_izq', 'banda', 'pregunta'],
    historia: ['sello', 'impacto_izq', 'cinema', 'dividida'],
    metafisica: ['etereo', 'pregunta', 'cinema'],
    misterio: ['sello', 'dividida', 'pregunta', 'impacto_izq', 'banda'],
    ciencia: ['dividida', 'banda', 'impacto_izq', 'pregunta'],
    finanzas: ['banda', 'dividida', 'impacto_izq']
};

// Etiquetas (la "pastilla" o sello) que rotan entre videos. Se pueden sobrescribir en canales.json ("etiquetas")
const ETIQUETAS_POR_NICHO = {
    iceberg: ['LO QUE NADIE DICE', 'NIVEL PROHIBIDO', 'EL FONDO', 'SECRETO'],
    historia: ['EXPEDIENTE ABIERTO', 'HISTORIA OCULTA', 'ARCHIVO SECRETO'],
    metafisica: ['TU ALMA RECUERDA', 'VIDAS PASADAS', 'MENSAJE'],
    misterio: ['CASO SIN RESOLVER', 'DESCLASIFICADO', 'SIN EXPLICACIÓN'],
    ciencia: ['DESCUBRIMIENTO', 'LA CIENCIA LO CONFIRMA'],
    finanzas: ['LO QUE NO TE DICEN', 'EVÍTALO']
};

// Paleta por defecto si un canal no trae "estilo"
const ESTILO_BASE = {
    color: '#FFFFFF', resalte: '#FF2A2A', trazo: '#000000',
    brillo: 1.0, saturacion: 1.15, contraste: 1.15
};

// Encuadres que se turnan entre variantes para que los fondos no se parezcan
const ENCUADRES = [
    'dramatic close-up of the main subject',
    'wide cinematic shot, the main subject small against a vast atmospheric scene',
    'medium shot from a low dramatic angle'
];

// Prompt del fondo: escena (en inglés) + encuadre + estilo del canal + espacio para el texto
function promptDeFondo(escena, canal, i = 0) {
    const limpia = String(escena).replace(/[()\[\]{}:]/g, ' ').replace(/\s+/g, ' ').trim();
    const estiloCanal = (canal.miniatura && canal.miniatura.fondoEstilo) || '';
    return [`(${limpia}:1.25)`, ENCUADRES[i % ENCUADRES.length], estiloCanal,
        'main subject on the right side of the frame, dark empty space on the left, strong focal point, highly detailed, sharp focus, no text']
        .filter(Boolean).join(', ');
}

// Elige las plantillas de las variantes: determinista por historia (mismo título = mismo resultado),
// pero distinto entre títulos, para que no todos los videos se vean iguales.
function elegirDisenos(canal, gancho, cantidad, plantillaForzada) {
    const nicho = canal.nicho || 'misterio';
    const cfg = canal.miniatura || {};
    const lista = (cfg.plantillas || PLANTILLAS_POR_NICHO[nicho] || Object.keys(PLANTILLAS)).filter(p => PLANTILLAS[p]);
    const etiquetas = cfg.etiquetas || ETIQUETAS_POR_NICHO[nicho] || [''];
    const base = numeroDeTexto(`${canal.id}|${gancho}`);
    const disenos = [];
    for (let i = 0; i < cantidad; i++) {
        const plantilla = plantillaForzada && PLANTILLAS[plantillaForzada] ? plantillaForzada : lista[(base + i) % lista.length];
        // a partir de la segunda vuelta de plantillas, se invierten colores para que no se repitan
        const vuelta = Math.floor(i / lista.length);
        disenos.push({
            plantilla,
            etiqueta: etiquetas[(base + i) % etiquetas.length],
            invertir: vuelta % 2 === 1
        });
    }
    return disenos;
}

function paletaDe(canal, invertir) {
    const e = { ...ESTILO_BASE, ...((canal.miniatura && canal.miniatura.estilo) || {}) };
    if (invertir) [e.color, e.resalte] = [e.resalte, e.color];
    return e;
}

// ---------------------------------------------------------------------
// 7) GENERAR
// ---------------------------------------------------------------------
async function guardarImagen(page, destino) {
    let calidad = 93, bytes;
    do {
        bytes = Buffer.from(await page.screenshot({ type: 'jpeg', quality: calidad }));
        calidad -= 6;
    } while (bytes.length > CONFIG.maxKB * 1024 && calidad > 50);
    fs.writeFileSync(destino, bytes);
    return bytes.length;
}

async function prepararPagina(browser, html) {
    const page = await browser.newPage();
    await page.setViewport({ width: ANCHO, height: ALTO, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(ajustarTextos);
    await new Promise(r => setTimeout(r, 150));
    return page;
}

/**
 * Genera una o varias miniaturas para una historia (un fondo DIFERENTE por variante).
 *  - gancho      texto corto (2 a 4 palabras)                    [obligatorio]
 *  - canal       objeto del canal (de canales.json)
 *  - promptFondo descripción en inglés de la escena del fondo
 *  - fondo       (opcional) imagen propia: se usa en todas las variantes en vez de pintar
 *  - variantes, carpeta, nombreBase, sub, etiqueta, nivel, plantilla, browser
 * @returns {Promise<string[]>} rutas de las miniaturas
 */
async function generarMiniaturas(o) {
    if (!o || !String(o.gancho || '').trim()) throw new Error('Falta el texto (gancho) de la miniatura.');
    const canal = o.canal || { id: 'sin_canal', nicho: 'misterio' };
    const carpeta = o.carpeta || CONFIG.carpetaSalida;
    fs.mkdirSync(carpeta, { recursive: true });
    const nombreBase = o.nombreBase || 'Miniatura';
    const cantidad = Math.max(1, Number(o.variantes) || CONFIG.variantesPorDefecto);
    const gancho = String(o.gancho).trim();
    const semilla = `${canal.id}|${gancho}`;
    const disenos = elegirDisenos(canal, gancho, cantidad, o.plantilla);

    const propio = !o.browser;
    const browser = o.browser || await puppeteer.launch({ headless: true });
    const archivos = [];
    try {
        for (let i = 0; i < disenos.length; i++) {
            const dis = disenos[i];
            console.log(`[Miniaturista] ⏳ Variante ${i + 1} de ${disenos.length} (${dis.plantilla})...`);
            try {
                // Cada variante pide su propio fondo (ComfyUI usa una semilla aleatoria distinta)
                let fondoImg = o.fondo || null;
                if (!fondoImg && o.promptFondo) {
                    const semillaImg = Math.floor(Math.random() * 4294967295);
                    fondoImg = await pintarLibre(promptDeFondo(o.promptFondo, canal, i), semillaImg, FORMATOS.horizontal);
                    fs.writeFileSync(path.join(carpeta, `${nombreBase}_fondo_${i + 1}.png`), fondoImg);
                }
                const d = {
                    t: textoConResalte(gancho, 1),
                    sub: o.sub || '',
                    etiqueta: o.etiqueta !== undefined ? o.etiqueta : dis.etiqueta,
                    nivel: o.nivel ? Number(o.nivel) : null,
                    total: o.total ? Number(o.total) : 7,
                    c: paletaDe(canal, dis.invertir),
                    semilla: semilla + i
                };
                const html = armarHTML({ fondoURI: fondoComoDataURI(fondoImg), plantilla: dis.plantilla, d });
                const page = await prepararPagina(browser, html);
                const nombre = `${nombreBase}_${i + 1}_${dis.plantilla}${dis.invertir ? '_inv' : ''}.jpg`;
                const destino = path.join(carpeta, nombre);
                const bytes = await guardarImagen(page, destino);
                await page.close();
                archivos.push(destino);
                console.log(`[Miniaturista]    ✅ ${nombre} (${(bytes / 1024).toFixed(0)} KB)`);
            } catch (e) {
                console.log(`[Miniaturista]    ⚠️ La variante ${i + 1} falló y se omite: ${e.message}`);
            }
        }
        if (archivos.length === 0) throw new Error('No se pudo crear ninguna miniatura.');
        if (archivos.length > 1) {
            await hacerComparativa(browser, archivos, path.join(carpeta, `${nombreBase}_comparativa.jpg`));
        }
    } finally {
        if (propio) await browser.close();
    }
    return archivos;
}

// Hoja con todas las variantes juntas + fila en tamaño de celular (para ver si se lee de lejos)
async function hacerComparativa(browser, archivos, destino) {
    const uri = (f) => `data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}`;
    const grandes = archivos.map(f => `<div><img src="${uri(f)}" style="width:400px;height:225px;display:block"><p style="margin:4px 0 0">${esc(path.basename(f).replace(/\.jpg$/, ''))}</p></div>`).join('');
    const chicas = archivos.map(f => `<img src="${uri(f)}" style="width:168px;height:94px">`).join('');
    const columnas = Math.min(3, archivos.length);
    const filas = Math.ceil(archivos.length / columnas);
    const ancho = columnas * 414 + 14;
    const alto = filas * 262 + 40 + Math.ceil(archivos.length / Math.max(1, Math.floor((ancho - 28) / 178))) * 104 + 20;
    const page = await browser.newPage();
    await page.setViewport({ width: ancho, height: alto });
    await page.setContent(`<html><body style="margin:0;background:#111;color:#bbb;font:13px sans-serif">
      <div style="display:grid;grid-template-columns:repeat(${columnas},400px);gap:14px;padding:14px">${grandes}</div>
      <div style="padding:0 14px"><p style="margin:0 0 6px">Así se verán en un celular (tamaño real aproximado):</p><div style="display:flex;gap:10px;flex-wrap:wrap">${chicas}</div></div>
    </body></html>`, { waitUntil: 'load' });
    await page.screenshot({ path: destino, type: 'jpeg', quality: 90 });
    await page.close();
    console.log(`📊 Comparativa: ${destino}`);
}

// Si Claude no mandó gancho, se arma uno con las primeras palabras del título
function ganchoDeTitulo(titulo) {
    return String(titulo || '').replace(/[¿?¡!:"“”]/g, '').trim().split(/\s+/).slice(0, 4).join(' ');
}

/**
 * Atajo para el capataz: crea las miniaturas de un video a partir de su guion.
 * Usa guion.miniatura = { gancho, escena } (lo escribe Claude en el plan).
 */
async function crearMiniaturasDeVideo({ guion, canal, carpeta, variantes }) {
    const m = guion.miniatura || {};
    const maxPalabras = ((canal.miniatura && canal.miniatura.maxPalabras) || 4) + 1;
    const gancho = String(m.gancho || ganchoDeTitulo(guion.titulo_youtube)).trim().split(/\s+/).slice(0, maxPalabras).join(' ');
    const promptFondo = m.escena || (guion.escenas && guion.escenas[0] && guion.escenas[0].prompt_imagen) || 'a dramatic cinematic scene';
    if (!m.gancho) console.log('[Miniaturista] ℹ️ El guion no trae gancho de miniatura; se usa el título.');
    const archivos = await generarMiniaturas({ gancho, promptFondo, canal, variantes, carpeta, nombreBase: 'Miniatura' });
    const comparativa = path.join(carpeta, 'Miniatura_comparativa.jpg');
    return { gancho, archivos, comparativa: fs.existsSync(comparativa) ? comparativa : null };
}

module.exports = { generarMiniaturas, crearMiniaturasDeVideo, promptDeFondo, PLANTILLAS };
