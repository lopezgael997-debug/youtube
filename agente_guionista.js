const path = require('path');
const { CFG, DIR } = require('./config');
const { llamarClaude, jsonConCache } = require('./claude');
const { hash, palabrasDeEscenas } = require('./utilidades');
const { wpmPara, temasPrevios } = require('./memoria');
const { obtenerTranscripcion } = require('./agente_cazador');

function validarEscenas(escenas) {
    if (!Array.isArray(escenas) || escenas.length === 0) throw new Error('No hay escenas.');
    for (const e of escenas) {
        if (typeof e.narracion !== 'string' || !e.narracion.trim()) throw new Error('Hay una escena sin narración.');
        e.prompt_imagen = e.prompt_imagen || 'mysterious ancient landscape, dramatic sky';
    }
}

// Reglas de retención por capítulo (gancho al inicio, llamado a suscribirse a mitad del video)
function reglasRetencion(i, total, capCTA) {
    const apertura = i === 0
        ? `La PRIMERA escena es el gancho: máximo 14 palabras, sin saludo ni presentación del canal ni del tema, que plante de golpe la pregunta, la imagen o el dato más impactante de toda la historia. Antes de terminar el primer minuto abre un bucle de curiosidad (una promesa concreta de lo que se revelará más adelante) que solo se cierre al final del video. Las escenas del primer minuto pueden ser más cortas (12 a 18 palabras) para que el ritmo sea rápido.`
        : 'Continúa con naturalidad, sin saludar ni repetir la introducción.';
    const cta = i === capCTA
        ? `Incluye UNA sola vez, justo después de un dato clave o un giro de este capítulo, una invitación breve a suscribirse (máximo 20 palabras, en esa misma escena o en la siguiente) que apunte a lo que viene después, con el tono de este canal y usando la palabra "suscríbete" o "suscribirte". Evita el cliché "no olvides dar like y suscribirte"; mejor hazla parte del suspenso (por ejemplo, prometiendo el dato que aún no has revelado).`
        : 'En este capítulo NO pidas suscribirse ni dar like.';
    const cierre = i === total - 1
        ? 'Este es el último capítulo: cierra de forma memorable.'
        : 'No cierres la historia: deja la tensión abierta para el siguiente capítulo.';
    return { apertura, cta, cierre };
}

async function obtenerGuion(proyecto, canal, nicho, idVideo, minutos) {
    const clave = `${idVideo}_${canal.id}_${minutos}m`;
    const numCaps = Math.max(1, Math.round(minutos / CFG.minutosPorCapitulo));
    const wpm = await wpmPara(nicho.voz);
    const palabrasObjetivo = Math.round(minutos * wpm);
    const palabrasCap = Math.round(palabrasObjetivo / numCaps);
    const bloqueEstructura = nicho.estructura
        ? `\nESTRUCTURA OBLIGATORIA DE ESTE CANAL:\n${nicho.estructura}\n`
        : '';

    let contexto = null;
    const getContexto = async () => {
        if (contexto) return contexto;
        let texto = await obtenerTranscripcion(proyecto.url, idVideo);
        if (texto.length > CFG.maxCharsTranscripcion) texto = texto.slice(0, CFG.maxCharsTranscripcion);
        contexto = {
            type: 'text',
            text: `MATERIAL DE REFERENCIA (transcripción en inglés del video "${proyecto.titulo}"):\n${texto}`,
            cache_control: { type: 'ephemeral' }
        };
        return contexto;
    };

    // --- 1) Plan (se valida que traiga TODOS los capítulos) ---
    const plan = await jsonConCache(
        path.join(DIR.guiones, `${clave}_plan.json`),
        async () => {
            console.log(`[Guionista] 🗺️ Planificando video de ${minutos} min (≈${palabrasObjetivo} palabras a ${Math.round(wpm)} pal/min) en ${numCaps} capítulos para "${canal.nombre}"...`);
            const previos = await temasPrevios(canal.id);
            const bloquePrevios = previos.length
                ? `\nVideos ya producidos en este canal (no repitas el mismo enfoque ni títulos parecidos):\n${previos.map(t => '- ' + t).join('\n')}\n`
                : '';
            return llamarClaude({
                modelo: CFG.modeloEconomico, nicho, contexto: await getContexto(), maxTokens: 4000, esfuerzo: CFG.efforts.plan,
                instruccion: `Planifica un video de ${minutos} minutos basado en el material de referencia, dividido en EXACTAMENTE ${numCaps} capítulos.
El primer capítulo debe abrir con un gancho espectacular (la gente decide en los primeros 15 segundos si se queda) y el último cerrar de forma memorable.
Sé breve: cada "resumen" de capítulo tiene máximo 30 palabras.
${bloquePrevios}${bloqueEstructura}
Incluye una "guia_visual": en INGLÉS, máximo 15 palabras, que fije SOLO el aspecto general de todo el video: época, paleta de colores, tipo de luz y textura. NO incluyas objetos, lugares, vehículos ni personajes concretos (nada de barcos, mar, edificios, etc.), porque esta guía se añade a TODAS las imágenes.

Incluye una "miniatura" para YouTube con dos campos:
- "gancho": de 2 a 4 palabras en español que despierten curiosidad sin repetir el título (por ejemplo NADIE SOBREVIVIÓ). Debe prometer algo que el video sí cumple.
- "escena": en INGLÉS, máximo 30 palabras, UNA escena impactante y concreta para el fondo: un sujeto principal en primer plano (una persona con expresión intensa o un objeto misterioso), con emoción o peligro, acorde al tono de este canal y sin violencia gráfica. Sin texto en la imagen.

Responde con este JSON:
{
  "titulo_youtube": "título atractivo en español",
  "descripcion": "descripción de 2 a 3 líneas",
  "etiquetas": ["etiqueta1", "etiqueta2"],
  "guia_visual": "english visual guide",
  "miniatura": { "gancho": "2 a 4 palabras", "escena": "english thumbnail scene" },
  "capitulos": [ { "titulo": "...", "resumen": "máx. 30 palabras" } ]
}`
            });
        },
        (d) => {
            if (!Array.isArray(d.capitulos) || d.capitulos.length < numCaps) {
                throw new Error(`El plan trae ${Array.isArray(d.capitulos) ? d.capitulos.length : 0} capítulos y se pidieron ${numCaps}.`);
            }
        },
        true
    );
    const guiaVisual = typeof plan.guia_visual === 'string' ? plan.guia_visual : '';
    const bloqueGuia = guiaVisual
        ? `\nGUÍA VISUAL FIJA (solo época, colores y luz; no la conviertas en contenido de las escenas): ${guiaVisual}\n`
        : '';

    // --- 2) Capítulos (se amplían si quedan cortos) ---
    const escenas = [];
    const total = plan.capitulos.length;
    // El llamado a suscribirse va en el capítulo central (si hay uno solo, en ese; si hay dos, al final del primero)
    const capCTA = total === 1 ? 0 : Math.ceil(total / 2) - 1;
    for (let i = 0; i < total; i++) {
        const capPlan = plan.capitulos[i];
        const reglas = reglasRetencion(i, total, capCTA);
        // El nombre incluye una huella del plan: si el plan cambia, los capítulos viejos no se reutilizan por error
        const base = path.join(DIR.guiones, `${clave}_cap${String(i + 1).padStart(2, '0')}_${hash(capPlan.titulo + '|' + (capPlan.resumen || '')).slice(0, 8)}`);

        let cap = await jsonConCache(
            `${base}.json`,
            async () => {
                console.log(`[Guionista] ✍️ Escribiendo capítulo ${i + 1}/${total}: ${capPlan.titulo}`);
                const previo = escenas.slice(-2).map(e => e.narracion).join(' ');
                return llamarClaude({
                    modelo: CFG.modelo, nicho, contexto: await getContexto(), maxTokens: 8000, esfuerzo: CFG.efforts.capitulos,
                    instruccion: `PLAN COMPLETO DEL VIDEO:
${JSON.stringify(plan.capitulos, null, 1)}
${bloqueGuia}${bloqueEstructura}
Escribe AHORA solo el capítulo ${i + 1} de ${total}: "${capPlan.titulo}".
- Longitud: entre ${palabrasCap} y ${Math.round(palabrasCap * 1.2)} palabras de narración en total. No te quedes corto.
- ${reglas.apertura}${i > 0 ? ' Viene después de: "' + previo + '"' : ''}
- ${reglas.cierre}
- ${reglas.cta}
- Divide en escenas de 1 o 2 oraciones (${CFG.escenaMin} a ${CFG.escenaMax} palabras cada una). Cada escena tendrá UNA imagen, así que cada escena debe tratar de una sola cosa visual.

JSON:
{ "escenas": [ { "narracion": "texto", "prompt_imagen": "english visual description of exactly this scene" } ] }`
                });
            },
            (d) => validarEscenas(d.escenas)
        );

        let palabrasCapReal = palabrasDeEscenas(cap.escenas);
        if (palabrasCapReal < CFG.umbralCapituloCorto * palabrasCap) {
            console.log(`[Guionista] 📏 Capítulo ${i + 1} corto (${palabrasCapReal} de ~${palabrasCap} palabras): se amplía.`);
            const ampliado = await jsonConCache(
                `${base}_ext.json`,
                async () => llamarClaude({
                    modelo: CFG.modelo, nicho, contexto: await getContexto(), maxTokens: 8000, esfuerzo: CFG.efforts.capitulos,
                    instruccion: `Capítulo ${i + 1} de ${total} ("${capPlan.titulo}"). Resumen previsto: ${capPlan.resumen || ''}
${bloqueGuia}${bloqueEstructura}
Así quedó la primera versión:
${JSON.stringify(cap.escenas)}

Quedó corta: tiene ${palabrasCapReal} palabras y el objetivo es de ${palabrasCap} a ${Math.round(palabrasCap * 1.2)}.
Reescribe el capítulo COMPLETO ampliándolo: añade detalles concretos del material, contexto, descripciones de lugares y momentos, y tensión narrativa. No repitas ideas ni rellenes con frases vacías. Conserva el mismo inicio y ${i === total - 1 ? 'un cierre memorable' : 'la tensión abierta al final'}.
${i === 0 ? 'Conserva la primera escena (el gancho de máximo 14 palabras) tal como está.' : ''}
${i === capCTA ? 'Conserva la invitación breve a suscribirse (una sola vez, con la palabra "suscríbete" o "suscribirte").' : 'No añadas invitaciones a suscribirse ni a dar like.'}
Escenas de 1 o 2 oraciones (${CFG.escenaMin} a ${CFG.escenaMax} palabras), cada una con una sola idea visual.

JSON:
{ "escenas": [ { "narracion": "texto", "prompt_imagen": "english visual description of exactly this scene" } ] }`
                }),
                (d) => validarEscenas(d.escenas)
            );
            const palabrasAmpliado = palabrasDeEscenas(ampliado.escenas);
            if (palabrasAmpliado > palabrasCapReal) {
                cap = ampliado;
                palabrasCapReal = palabrasAmpliado;
            }
            console.log(`          Capítulo ${i + 1} ahora tiene ${palabrasCapReal} palabras.`);
        }
        escenas.push(...cap.escenas);
    }

    const palabras = palabrasDeEscenas(escenas);
    console.log(`[Guionista] 📜 ${escenas.length} escenas, ${palabras} palabras (≈ ${(palabras / wpm).toFixed(1)} min; objetivo ${minutos} min).`);

    return {
        titulo_youtube: plan.titulo_youtube, descripcion: plan.descripcion, etiquetas: plan.etiquetas,
        guia_visual: guiaVisual, escenas, clave, capitulos: total,
        miniatura: (plan.miniatura && typeof plan.miniatura === 'object')
            ? { gancho: String(plan.miniatura.gancho || '').trim(), escena: String(plan.miniatura.escena || '').trim() }
            : null
    };
}

async function obtenerShorts(guion, nicho, cantidad) {
    const narracion = guion.escenas.map(e => e.narracion).join('\n');
    const archivo = path.join(DIR.guiones, `${guion.clave}_shorts${cantidad}_${hash(narracion).slice(0, 8)}.json`);
    const datos = await jsonConCache(
        archivo,
        async () => {
            console.log(`[Guionista] 📱 Escribiendo ${cantidad} shorts...`);
            const bloqueGuia = guion.guia_visual
                ? `\nGUÍA VISUAL FIJA (solo época, colores y luz; no la conviertas en contenido de las escenas): ${guion.guia_visual}\n`
                : '';
            return llamarClaude({
                modelo: CFG.modeloEconomico, nicho, contexto: null, maxTokens: 8000, esfuerzo: CFG.efforts.plan,
                instruccion: `Este es el guion completo de un video largo:

${narracion}
${bloqueGuia}
Crea ${cantidad} guiones de YouTube Shorts (vertical), cada uno sobre un momento o dato DISTINTO y atractivo del video.
Reglas:
- Cada short dura unos 45 a 55 segundos (≈ 120 a 135 palabras en total).
- Debe funcionar solo, sin haber visto el video.
- La PRIMERA escena (máximo 10 palabras) tiene que frenar el dedo de quien desliza: plantea de golpe la pregunta, la imagen o el dato más impactante, sin saludar ni presentarte.
- Termina con una pregunta o una invitación a ver el video completo.
- "texto_gancho": de 3 a 6 palabras en español, en MAYÚSCULAS, que se mostrará en pantalla en letra gigante durante los primeros 2 segundos. Que intrigue; no repitas literalmente la primera frase.
- Divide en 7 a 9 escenas de 14 a 20 palabras.

JSON:
{ "shorts": [ { "titulo": "título corto con gancho", "texto_gancho": "TRES A SEIS PALABRAS", "descripcion": "1 línea", "escenas": [ { "narracion": "texto", "prompt_imagen": "english visual description of exactly this scene" } ] } ] }`
            });
        },
        (d) => {
            if (!Array.isArray(d.shorts) || d.shorts.length === 0) throw new Error('No hay shorts.');
            d.shorts.forEach(s => validarEscenas(s.escenas));
        }
    );
    return datos.shorts.slice(0, cantidad);
}

module.exports = { validarEscenas, obtenerGuion, obtenerShorts };
