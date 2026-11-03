// modulos/cazador.js
// El Cazador: patrulla YouTube buscando videos virales en inglés que le sirvan a
// cada canal de la familia, los analiza con el modelo económico (Haiku) y manda
// las ideas por Telegram.
//
// Requiere en el .env: YOUTUBE_API_KEY (y lo que ya uses para Claude/Telegram).

const fs = require('fs').promises;
const path = require('path');
const { google } = require('googleapis');
const { CFG, DIR } = require('./config');
const { llamarClaude } = require('./claude');
const { avisarTelegram } = require('./panel');
const { obtenerTranscripcion } = require('./agente_capataz');

// =====================================================================
// 1. AJUSTES (aquí es donde tocas cosas)
// =====================================================================
const AJUSTES = {
    diasVentana: 7,              // solo videos publicados en los últimos N días
    resultadosPorBusqueda: 50,   // search.list cuesta 100 unidades igual con 5 que con 50
    duracionMinSeg: 240,         // descarta Shorts y clips de menos de 4 min
    maxCandidatosPorCanal: 10,   // cuántos videos revisa (transcripción) por canal y corrida
    maxAlertasPorCanal: 3,       // cuántas ideas manda por canal y corrida
    puntajeMinimo: 6,            // Haiku califica 1-10; por debajo no te molesta
    charsInicio: 7000,           // del transcript manda el inicio...
    charsFinal: 7000,            // ...y el final (ahí suele estar el giro)
    pausaTelegramMs: 3000,
    diasMemoria: 30              // cuánto tiempo recuerda un video ya revisado
};

// Un video pasa si tiene >= minVistas, O si es un "outlier": un canal chico
// cuyo video tiene >= 3 veces sus suscriptores en vistas (y al menos minVistas/3).
// Las claves coinciden con los id de canales.json.
const NICHOS = {
    gael_historias: {
        nombre: 'Archivero del Tiempo (historia)',
        minVistas: 30000,
        perfil: 'historia oculta, archivos y expedientes olvidados, secretos de la historia, hechos reales poco conocidos, tono de documental con misterio',
        consultas: [
            'hidden history documentary',
            'forgotten history secrets',
            'declassified archives history',
            'history mystery nobody talks about'
        ]
    },
    papa_misterio: {
        nombre: 'Misterio',
        minVistas: 40000,
        perfil: 'casos sin resolver, desapariciones, archivos desclasificados, fenómenos sin explicación, tono de expediente y suspenso',
        consultas: [
            'unsolved mystery documentary',
            'unexplained disappearance case',
            'classified files declassified documents',
            'strange case nobody can explain'
        ]
    },
    mama_metafisica: {
        nombre: 'Metafísica y Vidas Pasadas',
        minVistas: 20000,
        perfil: 'vidas pasadas, reencarnación, el alma, experiencias cercanas a la muerte, despertar espiritual, tono sereno y místico',
        consultas: [
            'past life regression story',
            'reincarnation evidence children remember',
            'near death experience story',
            'soul spiritual awakening messages'
        ]
    }
    // Para sumar el iceberg, agrega aquí leo_iceberg con su nombre, perfil y consultas.
};

// =====================================================================
// 2. CLIENTE DE YOUTUBE (se crea al usarse, no al importar el módulo)
// =====================================================================
let _youtube = null;
function yt() {
    if (!process.env.YOUTUBE_API_KEY) {
        throw new Error('Falta YOUTUBE_API_KEY en el .env');
    }
    if (!_youtube) {
        _youtube = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });
    }
    return _youtube;
}

// =====================================================================
// 3. MEMORIA: qué videos ya revisó (para no repetir alertas)
// =====================================================================
const rutaEstado = () => path.join(DIR.transcripciones, '_cazador_estado.json');
const rutaIdeas = () => path.join(DIR.transcripciones, '_cazador_ideas.jsonl');

async function cargarEstado() {
    try {
        const e = JSON.parse(await fs.readFile(rutaEstado(), 'utf-8'));
        return { vistos: e.vistos || {} };
    } catch {
        return { vistos: {} };
    }
}

async function guardarEstado(estado) {
    const limite = Date.now() - AJUSTES.diasMemoria * 86400000;
    for (const [id, fecha] of Object.entries(estado.vistos)) {
        if (new Date(fecha).getTime() < limite) delete estado.vistos[id];
    }
    await fs.writeFile(rutaEstado(), JSON.stringify(estado, null, 2), 'utf-8');
}

async function registrarIdea(registro) {
    await fs.appendFile(rutaIdeas(), JSON.stringify(registro) + '\n', 'utf-8');
}

// =====================================================================
// 4. YOUTUBE: buscar, detallar y medir qué tan "outlier" es cada video
// =====================================================================
async function buscarIds(consulta) {
    const desde = new Date(Date.now() - AJUSTES.diasVentana * 86400000).toISOString();
    const r = await yt().search.list({
        part: 'snippet',
        q: consulta,
        type: 'video',
        order: 'viewCount',
        relevanceLanguage: 'en',
        publishedAfter: desde,
        maxResults: AJUSTES.resultadosPorBusqueda
    });
    return (r.data.items || []).map(i => i.id && i.id.videoId).filter(Boolean);
}

async function detallarVideos(ids) {
    const items = [];
    for (let i = 0; i < ids.length; i += 50) {
        const r = await yt().videos.list({
            part: 'snippet,statistics,contentDetails',
            id: ids.slice(i, i + 50).join(',')
        });
        items.push(...(r.data.items || []));
    }
    return items;
}

async function obtenerSuscriptores(idsCanales) {
    const subs = new Map();
    const unicos = [...new Set(idsCanales)];
    for (let i = 0; i < unicos.length; i += 50) {
        const r = await yt().channels.list({
            part: 'statistics',
            id: unicos.slice(i, i + 50).join(','),
            maxResults: 50
        });
        for (const c of r.data.items || []) {
            const s = c.statistics || {};
            subs.set(c.id, s.hiddenSubscriberCount ? null : parseInt(s.subscriberCount || 0, 10));
        }
    }
    return subs;
}

// "PT1H2M3S" -> segundos
function duracionASegundos(iso = '') {
    const m = iso.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
    if (!m) return 0;
    const [d, h, mi, s] = m.slice(1).map(x => parseInt(x || 0, 10));
    return d * 86400 + h * 3600 + mi * 60 + s;
}

function evaluarCandidatos(items, subs, nicho) {
    const ahora = Date.now();
    const candidatos = [];

    for (const it of items) {
        const sn = it.snippet || {};
        const st = it.statistics || {};
        const cd = it.contentDetails || {};

        if (sn.liveBroadcastContent && sn.liveBroadcastContent !== 'none') continue;
        const segundos = duracionASegundos(cd.duration);
        if (segundos < AJUSTES.duracionMinSeg) continue;

        const vistas = parseInt(st.viewCount || 0, 10);
        const horas = Math.max(1, (ahora - new Date(sn.publishedAt).getTime()) / 3600000);
        const vph = vistas / horas;
        const sus = subs.get(sn.channelId) || null;
        const ratio = sus ? vistas / Math.max(sus, 1000) : null;

        const pasaVistas = vistas >= nicho.minVistas;
        const pasaOutlier = ratio !== null && ratio >= 3 && vistas >= nicho.minVistas / 3;
        if (!pasaVistas && !pasaOutlier) continue;

        candidatos.push({
            id: it.id,
            tituloOriginal: sn.title,
            canal: sn.channelTitle,
            vistas,
            vph,
            suscriptores: sus,
            ratio,
            minutos: Math.round(segundos / 60),
            horasDesdePublicacion: horas,
            // Velocidad (vistas/hora) premiada por qué tan grande es el golpe para el tamaño del canal
            puntajeRastreo: vph * (1 + Math.min(ratio || 0, 20) / 4)
        });
    }

    return candidatos.sort((a, b) => b.puntajeRastreo - a.puntajeRastreo);
}

// =====================================================================
// 5. CLAUDE (modelo económico): ¿le sirve este video a ESTE canal?
// =====================================================================
function muestrearTranscripcion(texto) {
    const max = AJUSTES.charsInicio + AJUSTES.charsFinal;
    if (texto.length <= max) return texto;
    return texto.slice(0, AJUSTES.charsInicio) + '\n[...]\n' + texto.slice(-AJUSTES.charsFinal);
}

function extraerJSON(texto) {
    const limpio = String(texto).replace(/```json|```/gi, '');
    const ini = limpio.indexOf('{');
    const fin = limpio.lastIndexOf('}');
    if (ini === -1 || fin <= ini) throw new Error('La respuesta no trae JSON');
    return JSON.parse(limpio.slice(ini, fin + 1));
}

async function analizarConClaude(video, transcripcion, nicho) {
    const crudo = await llamarClaude({
        modelo: CFG.modeloEconomico,
        nicho: { audiencia: 'analista', tono: 'objetivo' }, // genérico, solo para pasar las validaciones de llamarClaude
        contexto: { type: 'text', text: muestrearTranscripcion(transcripcion) },
        maxTokens: 600,
        esfuerzo: 'low',
        instruccion: `Eres el analista de ideas de un canal de YouTube en español.
Canal destino: "${nicho.nombre}". Perfil del canal: ${nicho.perfil}.

Te paso los subtítulos (inicio y final, separados por [...]) de un video viral en inglés titulado "${video.tituloOriginal}".
Evalúa si vale la pena hacer NUESTRA versión en español para ese canal. Sé exigente: 6 o más solo si el tema encaja con el perfil, tiene un giro fuerte y puede retener al público.

Responde SOLO este JSON, sin texto extra ni markdown:
{
  "puntaje": 1-10 (número),
  "titulo_espanol": "idea de título muy atractiva en español, máximo 70 caracteres",
  "gancho": "frase de apertura en español para los primeros 5 segundos",
  "resumen": "de qué trata, máximo 3 líneas",
  "giro": "el dato o giro más fuerte del video, una línea",
  "angulo_propio": "cómo hacer una versión original y distinta (otro ángulo, qué fuentes extra investigar), sin copiar ni traducir el video"
}`
    });

    const d = extraerJSON(crudo);
    return {
        puntaje: Number(d.puntaje) || 0,
        titulo_espanol: String(d.titulo_espanol || ''),
        gancho: String(d.gancho || ''),
        resumen: String(d.resumen || ''),
        giro: String(d.giro || ''),
        angulo_propio: String(d.angulo_propio || '')
    };
}

// =====================================================================
// 6. TELEGRAM
// =====================================================================
// Sin asteriscos ni guiones bajos en el texto dinámico, para que no rompan el parseo de Markdown
const limpiar = (t, max = 400) =>
    String(t || '').replace(/[*_`\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

function hace(horas) {
    return horas < 48 ? `${Math.round(horas)} h` : `${Math.round(horas / 24)} días`;
}

function armarMensaje(idCanal, nicho, video, a) {
    const url = `https://www.youtube.com/watch?v=${video.id}`;
    const num = n => Math.round(n).toLocaleString('es-MX');
    const subs = video.suscriptores ? `${num(video.suscriptores)} suscriptores` : 'suscriptores ocultos';
    const outlier = video.ratio && video.ratio >= 3
        ? ` · 🔥 ${video.ratio.toFixed(1)}x sus suscriptores`
        : '';

    return [
        `🚨 IDEA PARA: ${nicho.nombre}`,
        `⭐ Puntaje: ${a.puntaje}/10`,
        ``,
        `💡 Título: ${limpiar(a.titulo_espanol, 120)}`,
        `🎣 Gancho: ${limpiar(a.gancho)}`,
        `📝 Resumen: ${limpiar(a.resumen, 500)}`,
        `🔄 Giro: ${limpiar(a.giro)}`,
        `🧭 Ángulo propio: ${limpiar(a.angulo_propio, 500)}`,
        ``,
        `📺 Original: ${limpiar(video.tituloOriginal, 150)}`,
        `👤 ${limpiar(video.canal, 80)} (${subs})`,
        `👁 ${num(video.vistas)} vistas · ${num(video.vph)}/hora${outlier}`,
        `⏱ ${video.minutos} min · publicado hace ${hace(video.horasDesdePublicacion)}`,
        `🔗 ${url}`,
        ``,
        `➡️ Si te sirve, pásale esta URL al capataz.`
    ].join('\n');
}

async function enviarTelegram(texto) {
    const intentar = async t => {
        const r = await avisarTelegram(t);
        if (r === false) throw new Error('avisarTelegram devolvió false');
    };
    try {
        await intentar(texto);
        return true;
    } catch (e1) {
        try {
            // Reintento escapando caracteres especiales (por si avisarTelegram usa parse_mode Markdown)
            await intentar(texto.replace(/([_*`\[])/g, '\\$1'));
            return true;
        } catch (e2) {
            console.log(`[Cazador] ⚠️ Telegram falló: ${e2.message}`);
            return false;
        }
    }
}

const pausa = ms => new Promise(r => setTimeout(r, ms));

// =====================================================================
// 7. PATRULLAJE
// =====================================================================
async function patrullarCanal(idCanal, nicho, estado) {
    console.log(`[Cazador] 🔍 ${nicho.nombre}: buscando...`);

    const ids = new Set();
    for (const q of nicho.consultas) {
        try {
            (await buscarIds(q)).forEach(id => ids.add(id));
        } catch (e) {
            console.log(`[Cazador] ⚠️ La búsqueda "${q}" falló: ${e.message}`);
        }
    }

    const nuevos = [...ids].filter(id => !estado.vistos[id]);
    if (!nuevos.length) {
        console.log(`[Cazador] ${nicho.nombre}: nada nuevo.`);
        return 0;
    }

    const items = await detallarVideos(nuevos);
    const previos = items.filter(it =>
        parseInt((it.statistics || {}).viewCount || 0, 10) >= nicho.minVistas / 3);
    const subs = await obtenerSuscriptores(previos.map(it => it.snippet.channelId));
    const candidatos = evaluarCandidatos(previos, subs, nicho).slice(0, AJUSTES.maxCandidatosPorCanal);

    console.log(`[Cazador] 🎯 ${nicho.nombre}: ${candidatos.length} candidatos.`);

    let enviadas = 0;
    for (const video of candidatos) {
        if (enviadas >= AJUSTES.maxAlertasPorCanal) break;
        const url = `https://www.youtube.com/watch?v=${video.id}`;

        let transcripcion;
        try {
            transcripcion = await obtenerTranscripcion(url, video.id);
        } catch (e) {
            console.log(`[Cazador] ⚠️ Sin subtítulos: ${video.id} ("${video.tituloOriginal}")`);
            estado.vistos[video.id] = new Date().toISOString();
            continue;
        }

        let analisis;
        try {
            console.log(`[Cazador] 🧠 Analizando: "${video.tituloOriginal}"...`);
            analisis = await analizarConClaude(video, transcripcion, nicho);
        } catch (e) {
            // No se marca como visto: se reintenta en la próxima corrida
            console.log(`[Cazador] ⚠️ Falló el análisis de ${video.id}: ${e.message}`);
            continue;
        }

        if (analisis.puntaje < AJUSTES.puntajeMinimo) {
            console.log(`[Cazador] ➖ Descartado (${analisis.puntaje}/10): "${video.tituloOriginal}"`);
            estado.vistos[video.id] = new Date().toISOString();
            continue;
        }

        const ok = await enviarTelegram(armarMensaje(idCanal, nicho, video, analisis));
        if (!ok) continue; // sin marcar: se vuelve a intentar la próxima vez

        estado.vistos[video.id] = new Date().toISOString();
        enviadas++;
        await registrarIdea({
            fecha: new Date().toISOString(),
            canal: idCanal,
            url,
            original: video.tituloOriginal,
            canalOriginal: video.canal,
            vistas: video.vistas,
            ...analisis
        });
        console.log(`[Cazador] 📲 Idea enviada (${analisis.puntaje}/10): ${analisis.titulo_espanol}`);
        await pausa(AJUSTES.pausaTelegramMs);
    }

    return enviadas;
}

// idsCanales: arreglo de ids de NICHOS; si no se pasa, patrulla todos
async function patrullar(idsCanales) {
    await fs.mkdir(DIR.transcripciones, { recursive: true });
    const estado = await cargarEstado();
    const lista = idsCanales && idsCanales.length ? idsCanales : Object.keys(NICHOS);
    let total = 0;

    for (const idCanal of lista) {
        const nicho = NICHOS[idCanal];
        if (!nicho) {
            console.log(`[Cazador] ⚠️ Canal desconocido: ${idCanal} (opciones: ${Object.keys(NICHOS).join(', ')})`);
            continue;
        }
        try {
            total += await patrullarCanal(idCanal, nicho, estado);
        } catch (e) {
            console.error(`[Cazador] ❌ Error en ${idCanal}: ${e.message}`);
        }
        await guardarEstado(estado);
    }

    console.log(`[Cazador] ✅ Patrullaje terminado. Ideas enviadas: ${total}`);
    return total;
}

module.exports = { patrullar, NICHOS, AJUSTES };
