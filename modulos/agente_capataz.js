const fs = require('fs').promises;
const path = require('path');
const { CFG, FORMATOS, DIR, NICHOS, CANALES } = require('./config');
const { USO } = require('./claude');
const { existe, extraerIdVideo, slug } = require('./utilidades');
const { registrarCalibracion, registrarHistorial } = require('./memoria');
const { avisarTelegram, enviarFotoTelegram } = require('./panel');
const { crearMiniaturasDeVideo } = require('./agente_miniaturista');
const { obtenerGuion, obtenerShorts } = require('./agente_guionista');
const { verificarImagenIA } = require('./agente_pintor');
const { producirPieza } = require('./produccion');

// =====================================================================
// AGENTE CAPATAZ
// =====================================================================
async function escribirInfo(carpetaProyecto, info) {
    await fs.writeFile(path.join(carpetaProyecto, 'info.json'), JSON.stringify(info, null, 2), 'utf-8');
}

// Miniaturas del video: nunca detienen la producción si algo falla
async function hacerMiniaturas({ guion, canal, carpetaProyecto, info, reportar }) {
    if (!CFG.miniatura.activa) return;
    const carpeta = path.join(carpetaProyecto, 'miniaturas');
    try {
        const yaHechas = (await existe(carpeta))
            ? (await fs.readdir(carpeta)).filter(f => /^Miniatura_\d+_.*\.jpg$/.test(f))
            : [];
        if (yaHechas.length > 0) {
            console.log(`[Miniaturista] ♻️ Ya había ${yaHechas.length} miniaturas, se reutilizan.`);
            info.miniaturas = yaHechas;
            return;
        }
        await reportar({ progreso: 6, mensaje: 'Creando las miniaturas' }, true);
        const r = await crearMiniaturasDeVideo({ guion, canal, carpeta, variantes: CFG.miniatura.variantes });
        info.miniaturas = r.archivos.map(f => path.basename(f));
        info.gancho_miniatura = r.gancho;
        if (r.comparativa) {
            await enviarFotoTelegram(r.comparativa, `🖼️ Miniaturas de "${guion.titulo_youtube}" (${canal.nombre})\nTexto: ${r.gancho}`);
        }
    } catch (e) {
        console.error(`[Miniaturista] ⚠️ No se pudieron crear las miniaturas (el video continúa): ${e.message}`);
    }
}

async function producirVideo(proyecto, reportar) {
    const canal = CANALES.find(c => c.id === proyecto.canal);
    if (!canal) {
        throw new Error(`El canal "${proyecto.canal}" no existe en canales.json. Disponibles: ${CANALES.map(c => c.id).join(', ')}`);
    }
    const nichoKey = canal.nicho;
    const nicho = { ...NICHOS[nichoKey], voz: canal.voz || NICHOS[nichoKey].voz, enfoque: canal.enfoque || '' };
    const idVideo = extraerIdVideo(proyecto.url);

    const minutos = Math.min(60, Math.max(1, Number(proyecto.duracion) || CFG.duracionMin));
    const cantidadShorts = proyecto.shorts !== undefined && proyecto.shorts !== null
        ? Math.max(0, Math.min(10, Number(proyecto.shorts) || 0))
        : CFG.shortsPorVideo;

    const nombreCarpeta = `${proyecto.id}_${slug(proyecto.titulo)}`;
    const carpetaProyecto = path.join(DIR.salida, canal.id, nombreCarpeta);
    await fs.mkdir(carpetaProyecto, { recursive: true });
    const rutaVideo = path.join(carpetaProyecto, 'Video.mp4');
    const rutaShort = (n) => path.join(carpetaProyecto, `Short_${n}.mp4`);

    const videoListo = await existe(rutaVideo);
    let shortsListos = true;
    for (let n = 1; n <= cantidadShorts; n++) if (!(await existe(rutaShort(n)))) shortsListos = false;

    if (videoListo && shortsListos) {
        console.log('[Sistema] ✅ Este proyecto ya estaba producido por completo.');
        await reportar({ estado: 'listo', progreso: 100, mensaje: 'Ya estaba producido', drive_url: CFG.driveUrl }, true);
        return;
    }

    await verificarImagenIA();

    console.log(`[Sistema] 🎯 Canal: ${canal.nombre} (${nichoKey}) | Duración objetivo: ${minutos} min | Shorts: ${cantidadShorts}`);
    await reportar({ estado: 'produciendo', progreso: 3, mensaje: 'Escribiendo el guion' }, true);

    const guion = await obtenerGuion(proyecto, canal, nicho, idVideo, minutos);
    await reportar({ progreso: 5, mensaje: `Guion listo (${guion.escenas.length} escenas)`, titulo_youtube: guion.titulo_youtube }, true);

    const info = {
        canal: canal.id,
        proyecto: proyecto.titulo,
        referencia: proyecto.url,
        duracion_objetivo_min: minutos,
        video: { titulo: guion.titulo_youtube, descripcion: guion.descripcion, etiquetas: guion.etiquetas },
        shorts: []
    };
    await escribirInfo(carpetaProyecto, info);

    // --- Miniaturas (justo después del guion, para que las veas pronto) ---
    await hacerMiniaturas({ guion, canal, carpetaProyecto, info, reportar });
    await escribirInfo(carpetaProyecto, info);

    const archivos = [];
    const hayShorts = cantidadShorts > 0;
    const tramoVideo = hayShorts ? 60 : 90;
    let duracionRealMin = null;

    // --- Video largo ---
    if (!videoListo) {
        const r = await producirPieza({
            etiqueta: 'Video', escenas: guion.escenas, formato: FORMATOS.horizontal,
            nicho, nichoKey, guiaVisual: guion.guia_visual, tema: guion.titulo_youtube,
            carpeta: path.join(DIR.trabajo, String(proyecto.id)), destinoFinal: rutaVideo,
            onProgreso: (f, txt) => reportar({ progreso: 5 + f * tramoVideo, mensaje: txt })
        });
        duracionRealMin = r.segundos / 60;
        await registrarCalibracion(nicho.voz, r.palabras, r.segundos);

        const desvio = Math.round((duracionRealMin / minutos - 1) * 100);
        console.log(`[Sistema] 📏 Duración final: ${duracionRealMin.toFixed(1)} min (objetivo ${minutos} min, ${desvio >= 0 ? '+' : ''}${desvio}%)`);
        if (Math.abs(desvio) > 15) {
            console.log('          Si la diferencia es grande, el sistema se ajusta solo en el próximo video (calibración de voz).');
        }
        info.duracion_real_min = Number(duracionRealMin.toFixed(1));
    }
    archivos.push('Video.mp4');

    // --- Shorts verticales ---
    let shortsFallidos = 0;
    if (hayShorts) {
        await reportar({ progreso: 65, mensaje: 'Escribiendo los shorts' }, true);
        const shorts = await obtenerShorts(guion, nicho, cantidadShorts);
        const tramoShort = 30 / shorts.length;

        for (let n = 1; n <= shorts.length; n++) {
            const s = shorts[n - 1];
            info.shorts.push({ archivo: `Short_${n}.mp4`, titulo: s.titulo, descripcion: s.descripcion });
            await escribirInfo(carpetaProyecto, info);

            if (await existe(rutaShort(n))) { archivos.push(`Short_${n}.mp4`); continue; }
            try {
                await producirPieza({
                    etiqueta: `Short ${n}`, escenas: s.escenas, formato: FORMATOS.vertical,
                    nicho, nichoKey, guiaVisual: guion.guia_visual, tema: s.titulo,
                    carpeta: path.join(DIR.trabajo, `${proyecto.id}_short${n}`), destinoFinal: rutaShort(n),
                    onProgreso: (f, txt) => reportar({ progreso: 65 + (n - 1) * tramoShort + f * tramoShort, mensaje: txt })
                });
                archivos.push(`Short_${n}.mp4`);
            } catch (e) {
                shortsFallidos++;
                console.error(`❌ Falló el Short ${n}:`, e.message);
            }
        }
    }

    // --- Cierre ---
    info.costo_claude_usd_estimado = Number(USO.costo.toFixed(3));
    await escribirInfo(carpetaProyecto, info);

    await registrarHistorial({
        canal: canal.id, titulo: proyecto.titulo, titulo_youtube: guion.titulo_youtube,
        url: proyecto.url, fecha: new Date().toISOString()
    });

    const mensajeFinal = shortsFallidos > 0
        ? `Video listo, pero ${shortsFallidos} short(s) fallaron. Usa Reintentar.`
        : 'Todo listo';
    await reportar({
        estado: shortsFallidos > 0 ? 'error' : 'listo',
        progreso: 100, mensaje: mensajeFinal, archivos,
        titulo_youtube: guion.titulo_youtube, drive_url: CFG.driveUrl
    }, true);

    const lineasShorts = info.shorts.slice(0, 5).map(s => `  • ${s.titulo}`).join('\n');
    await avisarTelegram(
        `🎬 Video listo\n` +
        `Canal: ${canal.nombre}\n` +
        `Título sugerido: ${guion.titulo_youtube}\n` +
        (duracionRealMin ? `Duración: ${duracionRealMin.toFixed(1)} min\n` : '') +
        `Shorts: ${archivos.length - 1}${lineasShorts ? '\n' + lineasShorts : ''}\n` +
        (info.miniaturas && info.miniaturas.length ? `Miniaturas: ${info.miniaturas.length} (carpeta miniaturas)\n` : '') +
        `📁 ${CFG.driveUrl || carpetaProyecto}\n` +
        `Carpeta: ${canal.id}/${nombreCarpeta}`
    );

    console.log(`[Sistema] 🧾 Claude en este proyecto → entrada: ${USO.entrada} | caché leída: ${USO.cacheLeida} | caché escrita: ${USO.cacheEscrita} | salida: ${USO.salida} tokens`);
    console.log(`[Sistema] 💵 Costo estimado de Claude: ≈ $${USO.costo.toFixed(2)} USD${USO.sinTarifa ? ' (sin tarifa conocida para algún modelo; es un mínimo)' : ''}. Voz, imágenes y render: $0 (tu PC).`);
}

module.exports = { escribirInfo, producirVideo };
