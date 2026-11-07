// =====================================================================
// AGENTE CAPATAZ: dirige la producción completa de UN proyecto
//   guion -> miniaturas -> video largo -> shorts -> carpeta final + avisos
// Lo llama trabajador.js con: producirVideo(proyecto, reportar)
// (Los subtítulos de YouTube viven en agente_cazador.js; el patrullaje en cazador.js)
// =====================================================================
const fs = require('fs').promises;
const path = require('path');
const { CFG, DIR, FORMATOS, NICHOS, CANALES } = require('./config');
const { USO } = require('./claude');
const { slug, extraerIdVideo } = require('./utilidades');
const { registrarCalibracion, registrarHistorial } = require('./memoria');
const { avisarTelegram, enviarFotoTelegram } = require('./panel');
const { verificarImagenIA } = require('./agente_pintor');
const { obtenerGuion, obtenerShorts } = require('./agente_guionista');
const { producirPieza } = require('./produccion');

// Tramos de la barra de progreso (0-100) que se ve en el panel
const TRAMO = { guion: 3, miniaturas: 10, largo: 14, shorts: 70, fin: 96 };

const mmss = (seg) => {
    const t = Math.round(seg);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

// Falla rápido (antes de gastar créditos de Claude) si AllTalk está apagado
async function verificarVoz() {
    const A = CFG.alltalk;
    try {
        await fetch(`${A.url}/api/ready`, { signal: AbortSignal.timeout(8000) });
    } catch (e) {
        throw new Error(`AllTalk no responde en ${A.url}. Enciéndelo en Pinokio antes de producir. (${e.message})`);
    }
}

// Texto grande de los primeros 2 segundos de cada Short (3 a 6 palabras en mayúsculas)
function textoGancho(short) {
    return String(short.texto_gancho || short.titulo || '')
        .replace(/[{}\\]/g, '').trim()
        .toLocaleUpperCase('es').split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
}

function armarPublicacion({ canal, guion, largo, shortsListos, miniaturas }) {
    const L = [];
    L.push(`CANAL: ${canal.nombre}`, '');
    L.push('TÍTULO', guion.titulo_youtube || '', '');
    L.push('DESCRIPCIÓN', guion.descripcion || '', '');
    L.push('ETIQUETAS', (Array.isArray(guion.etiquetas) ? guion.etiquetas : []).join(', '), '');
    L.push(`DURACIÓN REAL: ${mmss(largo.segundos)} (${largo.palabras} palabras)`, '');
    if (miniaturas && miniaturas.archivos.length) {
        L.push(`MINIATURAS: ${miniaturas.archivos.length} variantes en la carpeta Miniaturas. Texto: "${miniaturas.gancho}".`);
        L.push('Sube una; si el porcentaje de clics sale bajo, cámbiala por otra variante.', '');
    }
    L.push('CALENDARIO SUGERIDO (separar las publicaciones le da su propio impulso a cada pieza)');
    L.push(`Día 1: video largo con la miniatura que más te guste`);
    shortsListos.forEach((s, i) => {
        L.push(`Día ${2 + i * 2}: Short ${i + 1} - ${s.titulo || ''}${s.descripcion ? ' | ' + s.descripcion : ''}`);
    });
    return L.join('\n') + '\n';
}

async function producirVideo(proyecto, reportar) {
    const canal = CANALES.find(c => c.id === proyecto.canal);
    if (!canal) throw new Error(`El canal "${proyecto.canal}" no existe en canales.json.`);
    const nicho = NICHOS[canal.nicho];
    const idVideo = proyecto.idVideo || extraerIdVideo(proyecto.url);
    const minutos = Math.max(1, Number(proyecto.duracion) || CFG.duracionMin);
    const cantShorts = Number.isFinite(Number(proyecto.shorts)) ? Math.max(0, Number(proyecto.shorts)) : CFG.shortsPorVideo;
    const avanzar = (progreso, mensaje, forzar = false) => reportar({ estado: 'produciendo', mensaje, progreso }, forzar);

    try {
        // 0) Comprobaciones previas: ComfyUI/Forge (elige el checkpoint) y AllTalk
        await avanzar(1, 'Comprobando ComfyUI y AllTalk', true);
        await verificarImagenIA();
        await verificarVoz();

        // 1) Guion (con caché: lo ya escrito no se vuelve a pagar)
        await avanzar(TRAMO.guion, 'Escribiendo el guion', true);
        const guion = await obtenerGuion(proyecto, canal, nicho, idVideo, minutos);

        const fecha = String(proyecto.creado || new Date().toISOString()).slice(0, 10);
        const carpetaFinal = path.join(DIR.salida, canal.id, `${fecha}_${slug(proyecto.titulo)}`);
        await fs.mkdir(carpetaFinal, { recursive: true });

        // 2) Miniaturas (si fallan, el video sigue)
        let miniaturas = null;
        if (CFG.miniatura.activa) {
            await avanzar(TRAMO.miniaturas, 'Creando miniaturas', true);
            try {
                const { crearMiniaturasDeVideo } = require('./agente_miniaturista');
                miniaturas = await crearMiniaturasDeVideo({
                    guion, canal, carpeta: path.join(carpetaFinal, 'Miniaturas'), variantes: CFG.miniatura.variantes
                });
                if (miniaturas.comparativa) {
                    await enviarFotoTelegram(miniaturas.comparativa, `🖼️ Miniaturas de "${guion.titulo_youtube}" (${canal.nombre}). Ya puedes ir eligiendo mientras se renderiza el video.`);
                }
            } catch (e) {
                console.log(`[Capataz] ⚠️ Las miniaturas fallaron, el video continúa: ${e.message}`);
            }
        }

        // 3) Video largo
        const finLargo = cantShorts > 0 ? TRAMO.shorts : TRAMO.fin;
        const destinoLargo = path.join(carpetaFinal, 'Video_largo.mp4');
        const largo = await producirPieza({
            etiqueta: 'Video', escenas: guion.escenas, formato: FORMATOS.horizontal,
            nicho, nichoKey: canal.nicho, guiaVisual: guion.guia_visual,
            tema: guion.titulo_youtube || proyecto.titulo,
            carpeta: path.join(DIR.trabajo, `${guion.clave}_largo`),
            destinoFinal: destinoLargo,
            onProgreso: (f, txt) => avanzar(TRAMO.largo + f * (finLargo - TRAMO.largo), txt)
        });
        await registrarCalibracion(nicho.voz, largo.palabras, largo.segundos);

        // 4) Shorts (un Short que falle no tira el proyecto)
        const shortsListos = [];
        if (cantShorts > 0) {
            await avanzar(TRAMO.shorts, 'Escribiendo los shorts', true);
            let shorts = [];
            try {
                shorts = await obtenerShorts(guion, nicho, cantShorts);
            } catch (e) {
                console.log(`[Capataz] ⚠️ No se pudieron escribir los shorts: ${e.message}`);
            }
            const peso = (TRAMO.fin - TRAMO.shorts) / Math.max(1, shorts.length);
            for (let i = 0; i < shorts.length; i++) {
                const s = shorts[i];
                const n = String(i + 1).padStart(2, '0');
                const destino = path.join(carpetaFinal, 'Shorts', `Short_${n}.mp4`);
                try {
                    await fs.mkdir(path.dirname(destino), { recursive: true });
                    await producirPieza({
                        etiqueta: `Short ${i + 1}/${shorts.length}`, escenas: s.escenas, formato: FORMATOS.vertical,
                        nicho, nichoKey: canal.nicho, guiaVisual: guion.guia_visual,
                        tema: s.titulo || guion.titulo_youtube,
                        carpeta: path.join(DIR.trabajo, `${guion.clave}_short${n}`),
                        destinoFinal: destino,
                        ganchoTexto: textoGancho(s),
                        onProgreso: (f, txt) => avanzar(TRAMO.shorts + (i + f) * peso, txt)
                    });
                    shortsListos.push({ archivo: destino, titulo: s.titulo, descripcion: s.descripcion });
                } catch (e) {
                    console.log(`[Capataz] ⚠️ El Short ${i + 1} falló y se omite: ${e.message}`);
                }
            }
        }

        // 5) Cierre: ficha de publicación, historial y avisos
        await fs.writeFile(
            path.join(carpetaFinal, 'Publicacion.txt'),
            armarPublicacion({ canal, guion, largo, shortsListos, miniaturas }),
            'utf-8'
        );
        await registrarHistorial({
            canal: canal.id, titulo: proyecto.titulo, titulo_youtube: guion.titulo_youtube,
            fecha: new Date().toISOString(), minutos: Number((largo.segundos / 60).toFixed(1)), shorts: shortsListos.length
        });

        const costo = USO.sinTarifa ? 'sin tarifa conocida' : `≈ $${USO.costo.toFixed(2)}`;
        const resumen = [
            `✅ LISTO: ${canal.nombre}`,
            `🎬 ${guion.titulo_youtube}`,
            `⏱ ${mmss(largo.segundos)} · ${largo.palabras} palabras`,
            `📱 Shorts: ${shortsListos.length} de ${cantShorts}`,
            `🖼 Miniaturas: ${miniaturas ? miniaturas.archivos.length : 0}`,
            `💰 Claude ${costo}`,
            `📁 ${carpetaFinal}`
        ].join('\n');
        console.log(`\n${resumen}\n`);
        await avisarTelegram(resumen);

        await reportar({
            estado: 'listo', progreso: 100,
            mensaje: `Listo: video de ${mmss(largo.segundos)} y ${shortsListos.length} ${shortsListos.length === 1 ? 'short' : 'shorts'}`,
            titulo_youtube: guion.titulo_youtube || '',
            drive_url: CFG.driveUrl || '',
            archivos: ['Video_largo.mp4', ...shortsListos.map(s => path.join('Shorts', path.basename(s.archivo))), 'Publicacion.txt']
        }, true);
    } catch (e) {
        await avisarTelegram(`❌ Falló "${proyecto.titulo}" (${canal.nombre}): ${String(e.message).slice(0, 300)}`);
        throw e;
    }
}

module.exports = { producirVideo };
