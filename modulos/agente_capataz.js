// modulos/agente_capataz.js
// Aquí solo vive la extracción de subtítulos (la usan el guionista y el cazador).
// La lógica de patrullaje de YouTube está ahora en cazador.js.

const fs = require('fs').promises;
const path = require('path');
const { YoutubeTranscript } = require('youtube-transcript');
const { DIR } = require('./config');
const { existe, decodificarEntidades } = require('./utilidades');

async function obtenerTranscripcion(url, idVideo) {
    const archivo = path.join(DIR.transcripciones, `${idVideo}.txt`);
    if (await existe(archivo)) {
        return fs.readFile(archivo, 'utf-8');
    }
    console.log(`[Capataz] 🕵️‍♂️ Extrayendo subtítulos de: ${url}`);
    let texto;
    try {
        const transcript = await YoutubeTranscript.fetchTranscript(url);
        texto = decodificarEntidades(transcript.map(t => t.text).join(' '));
    } catch (error) {
        throw new Error('No se pudieron extraer los subtítulos (quizás el video no tiene CC).');
    }
    await fs.writeFile(archivo, texto, 'utf-8');
    return texto;
}

module.exports = { obtenerTranscripcion };
