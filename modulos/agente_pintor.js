const fs = require('fs').promises;
const path = require('path');
const { CFG, DIR, CLIENT_ID } = require('./config');
const { hash, dormir, existe } = require('./utilidades');

// =====================================================================
// AGENTE PINTOR: imágenes con IA en tu GPU (ComfyUI o Forge/A1111)
// =====================================================================
let imagenIAverificada = false;

async function verificarImagenIA() {
    if (imagenIAverificada) return;
    const I = CFG.imagen;

    if (I.proveedor === 'forge') {
        try {
            const r = await fetch(`${I.forgeUrl}/sdapi/v1/options`);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
        } catch (e) {
            throw new Error(`No se pudo conectar con Forge/A1111 en ${I.forgeUrl} (${e.message}). Ábrelo con el argumento --api.`);
        }
    } else {
        let datos;
        try {
            const r = await fetch(`${I.comfyUrl}/object_info/CheckpointLoaderSimple`);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            datos = await r.json();
        } catch (e) {
            throw new Error(`No se pudo conectar con ComfyUI en ${I.comfyUrl} (${e.message}). Abre ComfyUI antes de ejecutar el worker.`);
        }
        const lista = datos?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
        if (lista.length === 0) {
            throw new Error('ComfyUI no tiene modelos. Copia un checkpoint SDXL (.safetensors) en ComfyUI/models/checkpoints y reinicia ComfyUI.');
        }
        if (!I.checkpoint) {
            I.checkpoint = lista[0];
            console.log(`[Pintor] ℹ️ COMFY_CHECKPOINT no definido, se usará: ${I.checkpoint}`);
        } else if (!lista.includes(I.checkpoint)) {
            throw new Error(`El checkpoint "${I.checkpoint}" no existe en ComfyUI. Disponibles: ${lista.join(', ')}`);
        }
    }
    console.log(`[Pintor] 🟢 Generador de imágenes listo (${I.proveedor}).`);
    imagenIAverificada = true;
}

async function imagenComfy(prompt, semilla, formato) {
    const I = CFG.imagen;
    const flujo = {
        '3': { class_type: 'KSampler', inputs: { seed: semilla, steps: I.pasos, cfg: I.cfg, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
        '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: I.checkpoint } },
        '5': { class_type: 'EmptyLatentImage', inputs: { width: formato.imgAncho, height: formato.imgAlto, batch_size: 1 } },
        '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
        '7': { class_type: 'CLIPTextEncode', inputs: { text: I.negativo, clip: ['4', 1] } },
        '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
        '9': { class_type: 'PreviewImage', inputs: { images: ['8', 0] } }
    };

    const r = await fetch(`${I.comfyUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: flujo, client_id: CLIENT_ID })
    });
    if (!r.ok) throw new Error(`ComfyUI rechazó el flujo: ${(await r.text()).slice(0, 300)}`);
    const { prompt_id } = await r.json();

    const limite = Date.now() + 5 * 60 * 1000;
    while (Date.now() < limite) {
        await dormir(800);
        const h = await (await fetch(`${I.comfyUrl}/history/${prompt_id}`)).json();
        const item = h[prompt_id];
        if (!item) continue;
        if (item.status && item.status.status_str === 'error') throw new Error('ComfyUI reportó un error al generar.');
        const img = Object.values(item.outputs || {}).flatMap(o => o.images || [])[0];
        if (img) {
            const v = await fetch(`${I.comfyUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'temp')}`);
            if (!v.ok) throw new Error(`No se pudo descargar la imagen (HTTP ${v.status})`);
            return Buffer.from(await v.arrayBuffer());
        }
    }
    throw new Error('Tiempo agotado esperando a ComfyUI.');
}

async function imagenForge(prompt, semilla, formato) {
    const I = CFG.imagen;
    const r = await fetch(`${I.forgeUrl}/sdapi/v1/txt2img`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt, negative_prompt: I.negativo, steps: I.pasos, cfg_scale: I.cfg,
            width: formato.imgAncho, height: formato.imgAlto, seed: semilla, sampler_name: 'DPM++ 2M Karras'
        })
    });
    if (!r.ok) throw new Error(`Forge respondió HTTP ${r.status}`);
    const datos = await r.json();
    if (!datos.images || !datos.images[0]) throw new Error('Forge no devolvió imagen.');
    return Buffer.from(datos.images[0], 'base64');
}

// Orden del prompt: primero la escena (lo más importante), luego la guía visual y por último el estilo del nicho
async function generarImagen(promptEscena, nicho, formato, guiaVisual) {
    const I = CFG.imagen;
    const escena = String(promptEscena).replace(/[()\[\]{}:]/g, ' ').replace(/\s+/g, ' ').trim();
    const prompt = [`(${escena}:1.25)`, guiaVisual, nicho.estilo].filter(Boolean).join(', ');
    const archivo = path.join(DIR.imagenes, `${hash([prompt, formato.imgAncho, formato.imgAlto, I.proveedor, I.checkpoint, I.pasos].join('|'))}.png`);
    if (await existe(archivo)) return archivo;

    const semilla = parseInt(hash(prompt).slice(0, 8), 16);
    let ultimoError;
    for (let intento = 1; intento <= 3; intento++) {
        try {
            const buffer = I.proveedor === 'forge'
                ? await imagenForge(prompt, semilla, formato)
                : await imagenComfy(prompt, semilla, formato);
            await fs.writeFile(archivo, buffer);
            return archivo;
        } catch (e) {
            ultimoError = e;
            console.log(`[Pintor] ⚠️ Intento ${intento}/3 falló: ${e.message}`);
            await dormir(2000 * intento);
        }
    }
    throw new Error(`No se pudo generar la imagen: ${ultimoError.message}`);
}


// Pinta una imagen con el prompt EXACTO que le des (sin caché): la usan las miniaturas
async function pintarLibre(prompt, semilla, formato) {
    await verificarImagenIA();
    const I = CFG.imagen;
    let ultimoError;
    for (let intento = 1; intento <= 3; intento++) {
        try {
            return I.proveedor === 'forge'
                ? await imagenForge(prompt, semilla, formato)
                : await imagenComfy(prompt, semilla, formato);
        } catch (e) {
            ultimoError = e;
            console.log(`[Pintor] ⚠️ Intento ${intento}/3 falló: ${e.message}`);
            await dormir(2000 * intento);
        }
    }
    throw new Error(`No se pudo pintar la imagen: ${ultimoError.message}`);
}

module.exports = { verificarImagenIA, imagenComfy, imagenForge, generarImagen, pintarLibre };
