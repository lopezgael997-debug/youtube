const fs = require('fs').promises;
const { CFG } = require('./config');
const { duracionAudio } = require('./ffmpeg');
const { enParalelo, palabrasDeEscenas } = require('./utilidades');
const { audioDeEscena } = require('./agente_locutor');
const { refinarPromptsImagen } = require('./agente_director_arte');
const { generarImagen } = require('./agente_pintor');
const { renderizarEscena, ensamblarVideo } = require('./agente_editor');

// Produce una pieza completa. Devuelve { segundos, palabras } de la narración real.
async function producirPieza({ etiqueta, escenas, formato, nicho, nichoKey, guiaVisual, tema, carpeta, destinoFinal, onProgreso }) {
    await fs.mkdir(carpeta, { recursive: true });
    const total = escenas.length;
    const avisar = (f, txt) => { if (onProgreso) onProgreso(f, `${etiqueta}: ${txt}`); };

    // 1) Voz
    console.log(`[Locutor] 🎙️ ${etiqueta}: grabando ${total} escenas...`);
    avisar(0.02, 'narrando');
    const audios = await enParalelo(escenas.map(e => async () => {
        const audio = await audioDeEscena(e.narracion, nicho.voz);
        e.duracion = (await duracionAudio(audio)) + CFG.pausaEscena;
        return audio;
    }), CFG.alltalk.concurrencia);
    const segundos = escenas.reduce((a, e) => a + e.duracion, 0);
    const palabras = palabrasDeEscenas(escenas);
    console.log(`[Locutor] ⏱️ Duración real de la narración: ${(segundos / 60).toFixed(1)} min (${palabras} palabras)`);
    avisar(0.12, 'narración lista');

    // 2) Imágenes con IA (primero se escribe un prompt fiel a cada narración)
    avisar(0.13, 'preparando las imágenes');
    await refinarPromptsImagen(escenas, nicho, guiaVisual, tema, etiqueta);
    const imagenes = [];
    for (let i = 0; i < total; i++) {
        console.log(`[Pintor] 🎨 ${etiqueta}: imagen ${i + 1}/${total}`);
        if (i % 3 === 0) avisar(0.12 + 0.58 * (i / total), `imagen ${i + 1}/${total}`);
        imagenes.push(await generarImagen(escenas[i].prompt_imagen, nicho, formato, guiaVisual));
    }

    // 3) Clips en paralelo
    let hechos = 0;
    const clips = await enParalelo(escenas.map((e, i) => async () => {
        const clip = await renderizarEscena({ imagen: imagenes[i], audio: audios[i], duracion: e.duracion, indice: i, carpeta, formato });
        hechos++;
        if (hechos % 10 === 0 || hechos === total) {
            console.log(`[Editor] 🎬 ${etiqueta}: clips ${hechos}/${total}`);
            avisar(0.70 + 0.22 * (hechos / total), `clips ${hechos}/${total}`);
        }
        return clip;
    }), CFG.concurrenciaRender);

    // 4) Ensamblado
    console.log(`[Editor] 🎞️ ${etiqueta}: ensamblando...`);
    avisar(0.95, 'ensamblando');
    await ensamblarVideo({ clips, escenas, carpeta, nichoKey, destinoFinal, formato });
    await fs.rm(carpeta, { recursive: true, force: true });
    console.log(`[Sistema] ✅ ${etiqueta} listo: ${destinoFinal}`);
    return { segundos, palabras };
}

module.exports = { producirPieza };
