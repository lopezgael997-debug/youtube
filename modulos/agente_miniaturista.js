// =====================================================================
// AGENTE MINIATURISTA
// Por cada video crea varias miniaturas REALMENTE distintas:
//   1) Claude propone un concepto por miniatura (gancho + etiqueta + escena con ángulos distintos)
//   2) se pinta un fondo diferente para cada una (ComfyUI/Forge)
//   3) se analiza la imagen (dónde está el sujeto, qué tono domina)
//   4) miniatura_adn.js elige el diseño más distinto a lo que ya publicó ese canal
//   5) Puppeteer compone cada miniatura. Si algo falla, NO detiene el video.
// =====================================================================
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FORMATOS, CFG, DIR, NICHOS } = require('./config');
const { llamarClaude, jsonConCache } = require('./claude');
const { pintarLibre } = require('./agente_pintor');
const { ANCHO, ALTO, esc, PLANTILLAS, armarHTML, ajustarTextos, fondoComoDataURI, textoConResalte } = require('./miniatura_plantillas');
const { semillaDe } = require('./miniatura_util');
const { analizarImagen, fuentesDisponibles, leerHistorial, guardarHistorial, elegirADN } = require('./miniatura_adn');

const CONFIG = {
    carpetaSalida: path.join(__dirname, '..', 'miniaturas_prueba'),
    variantesPorDefecto: 3,
    maxKB: 1900   // YouTube pide menos de 2 MB
};

// Encuadres que se turnan entre variantes para que los fondos no se parezcan
const ENCUADRES = [
    'dramatic close-up of the main subject',
    'wide cinematic shot, the main subject small against a vast atmospheric scene',
    'medium shot from a low dramatic angle'
];

// Ángulos que Claude usa para que cada miniatura cuente algo distinto
const ANGULOS = [
    'CURIOSIDAD: algo oculto o que casi nadie cuenta',
    'EMOCIÓN: el momento más intenso o tenso de la historia (sin violencia gráfica)',
    'PREGUNTA: una pregunta que el video sí responde',
    'DATO: un número o dato concreto que aparezca de verdad en el video',
    'CONTRASTE: lo que todos creían frente a lo que realmente pasó'
];

// Prompt del fondo: escena (en inglés) + encuadre + estilo del canal + composición (lateral o centrada)
function promptDeFondo(escena, canal, i = 0, centrado = false) {
    const limpia = String(escena).replace(/[()\[\]{}:]/g, ' ').replace(/\s+/g, ' ').trim();
    const estiloCanal = (canal.miniatura && canal.miniatura.fondoEstilo) || '';
    const composicion = centrado
        ? 'centered dramatic composition, balanced framing, focal point in the center, atmospheric depth, highly detailed, sharp focus, no text'
        : 'main subject on the right side of the frame, dark empty space on the left, strong focal point, highly detailed, sharp focus, no text';
    return [`(${limpia}:1.25)`, ENCUADRES[i % ENCUADRES.length], estiloCanal, composicion]
        .filter(Boolean).join(', ');
}

// ---------------------------------------------------------------------
// CONCEPTOS: un gancho, etiqueta y escena distintos por miniatura (con caché por video)
// ---------------------------------------------------------------------
async function conceptosDeMiniatura({ guion, canal, cantidad }) {
    const nicho = NICHOS[canal.nicho];
    if (!nicho) throw new Error(`Nicho desconocido: ${canal.nicho}`);
    const maxPal = (canal.miniatura && canal.miniatura.maxPalabras) || 4;
    const narr = (guion.escenas || []).map(e => e.narracion);
    const extracto = [...narr.slice(0, 8), ...narr.slice(-3)].join(' ').slice(0, 2500);
    const angulos = Array.from({ length: cantidad }, (_, i) => `${i + 1}. ${ANGULOS[i % ANGULOS.length]}`).join('\n');
    const archivo = path.join(DIR.guiones, `${guion.clave}_miniaturas${cantidad}_v3.json`);

    const datos = await jsonConCache(
        archivo,
        async () => llamarClaude({
            modelo: CFG.modeloEconomico, nicho, contexto: null, maxTokens: 2200, esfuerzo: CFG.efforts.plan,
            instruccion: `Eres el director de miniaturas de YouTube del canal "${canal.nombre}".
Video: "${guion.titulo_youtube}". Descripción: ${guion.descripcion || ''}
Así empieza y termina la narración: ${extracto}

Crea EXACTAMENTE ${cantidad} conceptos de miniatura. Cada uno usa un ÁNGULO distinto, en este orden:
${angulos}

Reglas estrictas de precisión:
- "gancho": de 2 a ${maxPal} palabras en español en MAYÚSCULAS. DEBE reflejar directamente el tema central del video ("${guion.titulo_youtube}") y entenderse por sí solo sin haber visto el video. PROHIBIDO usar detalles secundarios o anécdotas aisladas (como objetos o lugares sueltos) que confundan sobre de qué trata el video. No repitas palabras clave entre ganchos.
- "etiqueta": de 2 a 3 palabras en MAYÚSCULAS que contextualicen el tema exacto de este video (ej. para prosperidad: "DECRETO DIARIO", "PODER VERBAL", "LEY MENTAL"; nunca temas ajenos al video).
- "sub": texto auxiliar de 1 a 3 palabras que refuerce la promesa, o "" si no hace falta.
- "escena": en INGLÉS, máximo 30 palabras. UNA escena visualmente poderosa con un sujeto principal claro, acorde al tema central del video y al tono del canal, sin violencia gráfica, sin texto y sin personas reales. Cada concepto debe cambiar de sujeto, encuadre y emoción.
- Respeta las reglas del canal (nada de promesas de sanación ni de ganancias).

Responde con este JSON:
{ "conceptos": [ { "angulo": "curiosidad", "etiqueta": "PODER VERBAL", "gancho": "DOS A CUATRO", "sub": "", "escena": "english thumbnail scene" } ] }`
        }),
        (d) => {
            if (!Array.isArray(d.conceptos) || !d.conceptos.length) throw new Error('No hay conceptos de miniatura.');
            for (const c of d.conceptos) {
                if (typeof c.gancho !== 'string' || c.gancho.trim().length < 2) throw new Error('Un concepto no trae gancho.');
                if (typeof c.escena !== 'string' || c.escena.trim().length < 10) throw new Error('Un concepto no trae escena.');
            }
        },
        true
    );
    return datos.conceptos.slice(0, cantidad).map(c => ({
        angulo: String(c.angulo || ''),
        etiqueta: String(c.etiqueta || '').trim(),
        gancho: c.gancho.trim(),
        sub: String(c.sub || '').trim(),
        escena: c.escena.trim()
    }));
}

// ---------------------------------------------------------------------
// RENDER
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

// Mira la imagen de fondo (en el navegador) para decidir el diseño; si falla, sigue sin análisis
async function analizarFondo(pagina, fondoImg) {
    try {
        return await pagina.evaluate(analizarImagen, fondoComoDataURI(fondoImg));
    } catch (e) {
        console.log(`[Miniaturista]    ℹ️ No se pudo analizar el fondo (${e.message.split('\n')[0]}); se sigue sin análisis.`);
        return null;
    }
}

function normalizarConceptos(o, cantidad) {
    if (Array.isArray(o.conceptos) && o.conceptos.length) {
        return Array.from({ length: cantidad }, (_, i) => o.conceptos[i % o.conceptos.length]);
    }
    const unico = { gancho: String(o.gancho || '').trim(), escena: o.promptFondo, sub: o.sub, etiqueta: '' };
    return Array.from({ length: cantidad }, () => unico);
}

/**
 * Genera varias miniaturas (cada una con su propio fondo y su propio diseño).
 *  - conceptos   [{ gancho, etiqueta, escena, sub }]  uno por miniatura
 *  - canal       objeto del canal (de canales.json)
 *  - fondo       (opcional) imagen propia: se usa en todas las variantes en vez de pintar
 *  - variantes, carpeta, nombreBase, sub, etiqueta, nivel, plantilla, browser
 *  - historial   true = guarda los diseños usados para que el próximo video no los repita
 *  - semilla     (opcional) texto: mismo texto = mismo resultado (por defecto cada corrida es distinta)
 * @returns {Promise<string[]>} rutas de las miniaturas
 */
async function generarMiniaturas(o) {
    const cantidad = Math.max(1, Number(o && o.variantes) || (o && Array.isArray(o.conceptos) && o.conceptos.length) || CONFIG.variantesPorDefecto);
    const conceptos = o ? normalizarConceptos(o, cantidad) : [];
    if (!conceptos.length || !String(conceptos[0].gancho || '').trim()) throw new Error('Falta el texto (gancho) de la miniatura.');
    const canal = o.canal || { id: 'sin_canal', nicho: 'misterio' };
    const carpeta = o.carpeta || CONFIG.carpetaSalida;
    fs.mkdirSync(carpeta, { recursive: true });
    const nombreBase = o.nombreBase || 'Miniatura';
    const semilla = o.semilla
        ? semillaDe(o.semilla)
        : semillaDe(`${canal.id}|${conceptos[0].gancho}|${Date.now()}|${crypto.randomBytes(4).toString('hex')}`);
    const historial = leerHistorial(canal.id);
    const fuentesOk = fuentesDisponibles();

    const propio = !o.browser;
    const browser = o.browser || await puppeteer.launch({ headless: true });
    const archivos = [], firmas = [], etiquetasComparativa = [], detalles = [];
    try {
        const paginaAnalisis = await browser.newPage();
        for (let i = 0; i < cantidad; i++) {
            const concepto = conceptos[i];
            const gancho = String(concepto.gancho).trim();
            console.log(`[Miniaturista] ⏳ Variante ${i + 1} de ${cantidad}: "${gancho}"...`);
            try {
                let fondoImg = o.fondo || null;
                if (!fondoImg && concepto.escena) {
                    const semillaImg = Math.floor(Math.random() * 4294967295);
                    const esCentrado = canal.nicho === 'metafisica' ? i % 2 === 0 : i % 3 === 2;
                    fondoImg = await pintarLibre(promptDeFondo(concepto.escena, canal, i, esCentrado), semillaImg, FORMATOS.horizontal);
                    fs.writeFileSync(path.join(carpeta, `${nombreBase}_fondo_${i + 1}.png`), fondoImg);
                }
                const analisis = fondoImg ? await analizarFondo(paginaAnalisis, fondoImg) : null;
                const adn = elegirADN({
                    canal, gancho, previos: firmas, historial, analisis, fuentesOk,
                    semilla: semilla + i * 7919, forzarPlantilla: o.plantilla && PLANTILLAS[o.plantilla] ? o.plantilla : undefined
                });
                const foco = analisis ? { x: (adn.voltear ? 1 - analisis.cx : analisis.cx) * ANCHO, y: analisis.cy * ALTO } : null;
                const etiquetaFinal = o.etiqueta !== undefined ? o.etiqueta : (concepto.etiqueta || adn.etiqueta);
                const d = {
                    t: textoConResalte(gancho, 1),
                    g: gancho,
                    sub: o.sub !== undefined ? o.sub : (concepto.sub || ''),
                    etiqueta: etiquetaFinal,
                    nivel: o.nivel ? Number(o.nivel) : null,
                    total: o.total ? Number(o.total) : 7,
                    c: adn.paleta,
                    semilla: String(adn.semilla),
                    foco
                };
                const html = armarHTML({ fondoURI: fondoComoDataURI(fondoImg), plantilla: adn.plantilla, d, adn });
                const page = await prepararPagina(browser, html);
                const nombre = `${nombreBase}_${i + 1}_${adn.plantilla}.jpg`;
                const destino = path.join(carpeta, nombre);
                const bytes = await guardarImagen(page, destino);
                await page.close();
                archivos.push(destino);
                firmas.push(adn.firma);
                etiquetasComparativa.push(`${nombre.replace(/\.jpg$/, '')} · ${adn.paleta.id} · ${adn.fuente} · ${adn.efecto}`);
                detalles.push({ archivo: nombre, gancho, etiqueta: etiquetaFinal, angulo: concepto.angulo || '', escena: concepto.escena || '', zona: analisis ? analisis.zona : null, voltear: adn.voltear, diversidad: adn.diversidad, ...adn.firma });
                console.log(`[Miniaturista]    ✅ ${nombre} (${(bytes / 1024).toFixed(0)} KB) · ${adn.paleta.id} · ${adn.fuente} · ${adn.efecto} · ${adn.tratamiento}${adn.acentos.length ? ' · ' + adn.acentos.join('+') : ''}`);
            } catch (e) {
                console.log(`[Miniaturista]    ⚠️ La variante ${i + 1} falló y se omite: ${e.message}`);
            }
        }
        await paginaAnalisis.close();
        if (archivos.length === 0) throw new Error('No se pudo crear ninguna miniatura.');
        fs.writeFileSync(path.join(carpeta, `${nombreBase}_diseno.json`), JSON.stringify(detalles, null, 1), 'utf-8');
        if (o.historial) guardarHistorial(canal.id, firmas);
        if (archivos.length > 1) {
            await hacerComparativa(browser, archivos, path.join(carpeta, `${nombreBase}_comparativa.jpg`), etiquetasComparativa);
        }
    } finally {
        if (propio) await browser.close();
    }
    return archivos;
}

// Hoja con todas las variantes juntas + fila en tamaño de celular (para ver si se lee de lejos)
async function hacerComparativa(browser, archivos, destino, etiquetas = []) {
    const uri = (f) => `data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}`;
    const grandes = archivos.map((f, i) => `<div><img src="${uri(f)}" style="width:400px;height:225px;display:block"><p style="margin:4px 0 0">${esc(etiquetas[i] || path.basename(f).replace(/\.jpg$/, ''))}</p></div>`).join('');
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
 * Pide a Claude un concepto distinto por miniatura; si falla, usa guion.miniatura = { gancho, escena }.
 */
async function crearMiniaturasDeVideo({ guion, canal, carpeta, variantes }) {
    const n = Math.max(1, Number(variantes) || CONFIG.variantesPorDefecto);
    const maxPalabras = ((canal.miniatura && canal.miniatura.maxPalabras) || 4) + 1;
    const recortar = (g) => String(g || '').trim().split(/\s+/).slice(0, maxPalabras).join(' ');
    const m = guion.miniatura || {};
    if (!m.gancho) console.log('[Miniaturista] ℹ️ El guion no trae gancho de miniatura; se usa el título.');
    const base = {
        gancho: recortar(m.gancho || ganchoDeTitulo(guion.titulo_youtube)),
        escena: m.escena || (guion.escenas && guion.escenas[0] && guion.escenas[0].prompt_imagen) || 'a dramatic cinematic scene',
        etiqueta: '',
        sub: ''
    };

    let conceptos = [];
    try {
        conceptos = (await conceptosDeMiniatura({ guion, canal, cantidad: n }))
            .map(c => ({ ...c, gancho: recortar(c.gancho) })).filter(c => c.gancho);
    } catch (e) {
        console.log(`[Miniaturista] ⚠️ No se pudieron crear conceptos distintos (${e.message}); se usa el gancho del plan.`);
    }
    if (!conceptos.length) conceptos = [base];

    const archivos = await generarMiniaturas({ conceptos, canal, variantes: n, carpeta, nombreBase: 'Miniatura', historial: true });
    const ganchos = [...new Set(conceptos.map(c => c.gancho))];
    const comparativa = path.join(carpeta, 'Miniatura_comparativa.jpg');
    return { gancho: ganchos.join(' / '), ganchos, archivos, comparativa: fs.existsSync(comparativa) ? comparativa : null };
}

module.exports = { generarMiniaturas, crearMiniaturasDeVideo, conceptosDeMiniatura, promptDeFondo, PLANTILLAS };