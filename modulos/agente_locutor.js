const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { CFG, DIR } = require('./config');
const { hash, dormir, existe } = require('./utilidades');

// =====================================================================
// AGENTE LOCUTOR: voz por escena (con caché)
// =====================================================================
function limpiarTextoParaVoz(texto) {
    return texto.replace(/[*_#`>~]/g, '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
}

async function sintetizar(texto, voz) {
    const A = CFG.alltalk;
    console.log(`[Voz] Generando audio con AllTalk (${voz})...`);

    // Nombre único por petición para que dos audios nunca se pisen entre sí
    const nombreSalida = `worker_${hash(voz + '|' + texto)}_${crypto.randomBytes(3).toString('hex')}`;

    let respuesta;
    try {
        respuesta = await fetch(`${A.url}/api/tts-generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                text_input: texto,
                text_filtering: 'standard',
                character_voice_gen: voz,   // archivo .wav dentro de la carpeta "voices" de AllTalk
                narrator_enabled: 'false',
                language: A.idioma,         // fuerza el español siempre
                output_file_name: nombreSalida,
                output_file_timestamp: 'false',
                autoplay: 'false'
            })
        });
    } catch (e) {
        throw new Error(`No se pudo conectar con AllTalk en ${A.url}. ¿Está encendido en Pinokio? (${e.message})`);
    }

    if (!respuesta.ok) {
        throw new Error(`Error en el servidor AllTalk: ${respuesta.status}`);
    }

    const textoRespuesta = await respuesta.text();
    let json;
    try { json = JSON.parse(textoRespuesta); }
    catch { throw new Error(`AllTalk no devolvió un JSON válido: ${textoRespuesta.slice(0, 200)}`); }

    if (json.status && !/success/i.test(json.status)) {
        throw new Error(`AllTalk no pudo generar el audio: ${json.error_message || json.message || json.status}`);
    }

    // AllTalk puede devolver una ruta (/audio/x.wav) o una URL completa (http://.../audio/x.wav)
    const rutaAudio = json.output_file_url || json.audio_file || json.url;
    if (!rutaAudio) {
        throw new Error('AllTalk generó el audio pero no devolvió el enlace correcto.');
    }
    const urlAudio = /^https?:\/\//i.test(rutaAudio) ? rutaAudio : `${A.url}${rutaAudio.startsWith('/') ? '' : '/'}${rutaAudio}`;

    const resAudio = await fetch(urlAudio);
    if (!resAudio.ok) throw new Error(`No se pudo descargar el audio de AllTalk (${resAudio.status})`);
    return Buffer.from(await resAudio.arrayBuffer());
}

async function audioDeEscena(texto, voz) {
    const limpio = limpiarTextoParaVoz(texto);
    const archivo = path.join(DIR.audio, `${hash(voz + '|' + limpio)}.wav`);
    if (await existe(archivo)) return archivo;

    for (let intento = 1; intento <= 3; intento++) {
        try {
            const buffer = await sintetizar(limpio, voz);
            if (buffer.length < 1000) throw new Error('Audio vacío');
            await fs.writeFile(archivo, buffer);
            return archivo;
        } catch (e) {
            if (intento === 3) throw new Error(`Falló la voz: ${e.message}`);
            await dormir(1500 * intento);
        }
    }
}

module.exports = { limpiarTextoParaVoz, sintetizar, audioDeEscena };
