// =====================================================================
// PROBADOR DE MINIATURAS (independiente: NO toca el worker)
//
// Uso:
//   node miniatura_prueba.js                      -> usa lo que dice CONFIG
//   node miniatura_prueba.js fondo.png            -> usa tu propia imagen de fondo
//   node miniatura_prueba.js fondo.png "EL BARCO FANTASMA" "Nadie sobrevivió"
//   node miniatura_prueba.js comfy "TEXTO"        -> pinta el fondo con ComfyUI (debe estar abierto)
//
// Requisitos:  npm install sharp      (dotenv es opcional, para leer tu .env)
// Resultado:   carpeta miniaturas_prueba/ con 3 estilos + vista de celular + comparativa
// =====================================================================
const fs = require('fs');
const path = require('path');
try { require('dotenv').config(); } catch { /* dotenv es opcional */ }
const sharp = require('sharp');

// ---------------------------------------------------------------------
// 1) LO QUE NORMALMENTE EDITARÁS
// ---------------------------------------------------------------------
const CONFIG = {
    texto: 'EL BARCO FANTASMA',      // 2 a 4 palabras, en MAYÚSCULAS se ve mejor
    subtexto: '',                    // línea pequeña opcional (ej. "Nadie sobrevivió"); '' = sin subtexto
    fondo: 'fondo.png',              // imagen de fondo; si no existe, se intenta pintar con ComfyUI
    promptFondo: 'a lone man drenched in blood standing on the deck of an abandoned sailing ship at night, dramatic close-up, fog, moonlight, intense expression, highly detailed, cinematic',

    // Fuente gruesa. Windows ya trae "Impact". Si instalas Anton o Bebas Neue, también se usan.
    fuente: 'Impact, Anton, Bebas Neue, Arial Black, Sans',

    salida: 'miniaturas_prueba',     // carpeta de salida
    maxKB: 1900                      // YouTube pide menos de 2 MB
};

// Estilos a comparar. Cambia colores, posición y ajustes de imagen a tu gusto.
const ESTILOS = {
    amarillo: {
        color: '#FFE600', resalte: null, trazo: '#000000',
        posicion: 'izquierda', brillo: 1.05, saturacion: 1.25, contraste: 1.15, sombraIzq: 0.78
    },
    blanco_rojo: {
        color: '#FFFFFF', resalte: '#FF2A2A', trazo: '#000000',   // la ÚLTIMA palabra va en rojo
        posicion: 'izquierda', brillo: 1.0, saturacion: 1.2, contraste: 1.2, sombraIzq: 0.8
    },
    cian_centro: {
        color: '#2BE8FF', resalte: '#FFFFFF', trazo: '#001018',   // la ÚLTIMA palabra va en blanco
        posicion: 'centro', brillo: 1.0, saturacion: 1.3, contraste: 1.2, sombraIzq: 0
    }
};

// ---------------------------------------------------------------------
// 2) AJUSTES AVANZADOS (rara vez los tocarás)
// ---------------------------------------------------------------------
const W = 1280, H = 720;
const AJUSTES = {
    tamanoMax: 210,          // tamaño máximo de letra
    margen: 56,              // margen a los lados
    anchoTextoIzq: 760,      // ancho disponible para el texto en estilo "izquierda"
    anchoTextoCentro: 1130,  // ancho disponible en estilo "centro"
    altoMaxTexto: 430,       // alto máximo del bloque de texto
    interlineado: 1.0,
    grosorTrazo: 0.13        // trazo negro alrededor de la letra (fracción del tamaño)
};

const comfy = {
    url: process.env.COMFY_URL || 'http://127.0.0.1:8188',
    checkpoint: process.env.COMFY_CHECKPOINT || '',
    pasos: Number(process.env.IMAGEN_PASOS || 30),
    cfg: Number(process.env.IMAGEN_CFG || 6.5),
    negativo: 'text, letters, words, watermark, logo, signature, blurry, low quality, deformed, extra fingers, bad anatomy, extra limbs, cartoon'
};

// ---------------------------------------------------------------------
// 3) FONDO: tu imagen o una pintada con ComfyUI
// ---------------------------------------------------------------------
const dormir = (ms) => new Promise(r => setTimeout(r, ms));

async function pintarFondoComfy(prompt) {
    console.log('🎨 Pintando el fondo con ComfyUI...');
    if (!comfy.checkpoint) {
        const r = await fetch(`${comfy.url}/object_info/CheckpointLoaderSimple`);
        const d = await r.json();
        const lista = d?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
        if (!lista.length) throw new Error('ComfyUI no tiene modelos (checkpoints).');
        comfy.checkpoint = lista[0];
        console.log(`   modelo: ${comfy.checkpoint}`);
    }
    const flujo = {
        '3': { class_type: 'KSampler', inputs: { seed: Math.floor(Math.random() * 1e9), steps: comfy.pasos, cfg: comfy.cfg, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
        '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: comfy.checkpoint } },
        '5': { class_type: 'EmptyLatentImage', inputs: { width: 1344, height: 768, batch_size: 1 } },
        '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
        '7': { class_type: 'CLIPTextEncode', inputs: { text: comfy.negativo, clip: ['4', 1] } },
        '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
        '9': { class_type: 'PreviewImage', inputs: { images: ['8', 0] } }
    };
    const r = await fetch(`${comfy.url}/prompt`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: flujo, client_id: 'miniatura-prueba' })
    });
    if (!r.ok) throw new Error(`ComfyUI rechazó el flujo: ${(await r.text()).slice(0, 300)}`);
    const { prompt_id } = await r.json();
    const limite = Date.now() + 5 * 60 * 1000;
    while (Date.now() < limite) {
        await dormir(800);
        const h = await (await fetch(`${comfy.url}/history/${prompt_id}`)).json();
        const item = h[prompt_id];
        if (!item) continue;
        if (item.status && item.status.status_str === 'error') throw new Error('ComfyUI reportó un error.');
        const img = Object.values(item.outputs || {}).flatMap(o => o.images || [])[0];
        if (img) {
            const v = await fetch(`${comfy.url}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'temp')}`);
            if (!v.ok) throw new Error(`No se pudo descargar la imagen (HTTP ${v.status})`);
            return Buffer.from(await v.arrayBuffer());
        }
    }
    throw new Error('Tiempo agotado esperando a ComfyUI.');
}

async function obtenerFondo(origen) {
    if (origen && origen !== 'comfy') {
        if (!fs.existsSync(origen)) {
            throw new Error(`No encuentro la imagen "${origen}". Revisa el nombre o usa "comfy" para pintarla con ComfyUI.`);
        }
        console.log(`🖼️  Usando tu imagen de fondo: ${origen}`);
        return fs.readFileSync(origen);
    }
    try {
        const buf = await pintarFondoComfy(CONFIG.promptFondo);
        fs.mkdirSync(CONFIG.salida, { recursive: true });
        fs.writeFileSync(path.join(CONFIG.salida, 'fondo_generado.png'), buf);
        console.log(`   fondo guardado en ${CONFIG.salida}/fondo_generado.png (úsalo otra vez sin repintar)`);
        return buf;
    } catch (e) {
        throw new Error(`No hay fondo: no existe "${CONFIG.fondo}" y ComfyUI falló (${e.message}). Pon una imagen en esa ruta o abre ComfyUI.`);
    }
}

// ---------------------------------------------------------------------
// 4) TEXTO: medir, repartir en líneas y ajustar el tamaño
// ---------------------------------------------------------------------
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const familiaSVG = () => CONFIG.fuente.split(',').map(f => `'${f.trim()}'`).join(', ');

// Ancho real del texto con tamaño 100, medido con la misma fuente del sistema
async function anchoA100(texto) {
    try {
        const { info } = await sharp({
            text: { text: `<span>${esc(texto)}</span>`, font: `${CONFIG.fuente} Bold 100`, rgba: true, dpi: 72 }
        }).png().toBuffer({ resolveWithObject: true });
        return info.width;
    } catch {
        return texto.length * 55; // estimación si no se puede medir
    }
}

// Reparte las palabras en 1 a 3 líneas y elige la combinación que permite la letra más grande
async function disenarTexto(texto, anchoDisponible) {
    const palabras = texto.trim().split(/\s+/).filter(Boolean);
    if (palabras.length === 0) throw new Error('El texto de la miniatura está vacío.');
    const n = palabras.length;
    const anchos = {};
    const medir = async (t) => (anchos[t] ??= await anchoA100(t));

    // todas las formas de cortar las palabras en k líneas consecutivas
    function cortes(k, desde = 0) {
        if (k === 1) return [[palabras.slice(desde)]];
        const res = [];
        for (let i = desde + 1; i <= n - (k - 1); i++) {
            for (const resto of cortes(k - 1, i)) res.push([palabras.slice(desde, i), ...resto]);
        }
        return res;
    }

    const opciones = [];
    for (let k = 1; k <= Math.min(3, n); k++) {
        for (const c of cortes(k)) {
            const lineas = c.map(g => g.join(' '));
            let mayor = 0;
            for (const l of lineas) mayor = Math.max(mayor, await medir(l));
            const porAncho = (anchoDisponible / mayor) * 100 * 0.96;
            const porAlto = AJUSTES.altoMaxTexto / (lineas.length * AJUSTES.interlineado);
            opciones.push({ grupos: c, tamano: Math.min(AJUSTES.tamanoMax, porAncho, porAlto) });
        }
    }
    opciones.sort((a, b) => b.tamano - a.tamano);
    return opciones[0];
}

// ---------------------------------------------------------------------
// 5) COMPONER LA MINIATURA
// ---------------------------------------------------------------------
function construirSVG(estilo, diseno) {
    const { grupos, tamano } = diseno;
    const centro = estilo.posicion === 'centro';
    const lineH = tamano * AJUSTES.interlineado;
    const bloqueAlto = grupos.length * lineH;
    const sub = CONFIG.subtexto ? Math.round(Math.min(58, tamano * 0.34)) : 0;
    const altoTotal = bloqueAlto + (sub ? sub * 1.5 : 0);

    const yInicio = centro ? H - altoTotal - 46 : (H - altoTotal) / 2 + 10;
    const x = centro ? W / 2 : AJUSTES.margen;
    const ancla = centro ? 'middle' : 'start';
    const trazoW = Math.round(tamano * AJUSTES.grosorTrazo);
    const fam = familiaSVG();

    const totalPalabras = grupos.flat().length;
    const capa = (modo) => {
        let contador = 0;
        return grupos.map((g, i) => {
            const y = yInicio + tamano * 0.84 + i * lineH;
            const partes = g.map((p) => {
                contador++;
                if (modo === 'trazo') return esc(p);
                const color = (contador === totalPalabras && estilo.resalte) ? estilo.resalte : estilo.color;
                return `<tspan fill="${color}">${esc(p)}</tspan>`;
            });
            const atributos = modo === 'trazo'
                ? `fill="${estilo.trazo}" stroke="${estilo.trazo}" stroke-width="${trazoW * 2}" stroke-linejoin="round"`
                : '';
            return `<text x="${x}" y="${y}" text-anchor="${ancla}" font-family="${fam}" font-weight="700" font-size="${tamano}" ${atributos}>${partes.join(' ')}</text>`;
        }).join('\n  ');
    };

    const ySub = yInicio + bloqueAlto + sub * 0.55 + sub;
    const subSVG = sub ? `
  <text x="${x}" y="${ySub}" text-anchor="${ancla}" font-family="${fam}" font-weight="700" font-size="${sub}" fill="#000" stroke="#000" stroke-width="${Math.round(sub * 0.3)}" stroke-linejoin="round">${esc(CONFIG.subtexto)}</text>
  <text x="${x}" y="${ySub}" text-anchor="${ancla}" font-family="${fam}" font-weight="700" font-size="${sub}" fill="#FFFFFF">${esc(CONFIG.subtexto)}</text>` : '';

    const sombra = estilo.sombraIzq > 0
        ? `<rect width="${W}" height="${H}" fill="url(#izq)"/>`
        : `<rect width="${W}" height="${H}" fill="url(#abajo)"/>`;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="izq" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#000" stop-opacity="${estilo.sombraIzq}"/>
      <stop offset="0.62" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="abajo" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.45" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.8"/>
    </linearGradient>
    <radialGradient id="vineta" cx="50%" cy="50%" r="75%">
      <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.55"/>
    </radialGradient>
  </defs>
  ${sombra}
  <rect width="${W}" height="${H}" fill="url(#vineta)"/>
  ${capa('trazo')}
  ${capa('relleno')}${subSVG}
</svg>`;
}

async function guardarJPG(buffer, destino) {
    let calidad = 92;
    let salida;
    do {
        salida = await sharp(buffer).jpeg({ quality: calidad, mozjpeg: true }).toBuffer();
        calidad -= 6;
    } while (salida.length > CONFIG.maxKB * 1024 && calidad > 50);
    fs.writeFileSync(destino, salida);
    return salida.length;
}

async function crearMiniatura(fondoBuf, nombre, estilo, texto) {
    const diseno = await disenarTexto(texto, estilo.posicion === 'centro' ? AJUSTES.anchoTextoCentro : AJUSTES.anchoTextoIzq);
    const svg = construirSVG(estilo, diseno);

    const a = estilo.contraste, b = 128 * (1 - a);
    const base = await sharp(fondoBuf)
        .resize(W, H, { fit: 'cover', position: 'attention' })
        .modulate({ brightness: estilo.brillo, saturation: estilo.saturacion })
        .linear(a, b)
        .sharpen()
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .png()
        .toBuffer();

    const archivo = path.join(CONFIG.salida, `miniatura_${nombre}.jpg`);
    const bytes = await guardarJPG(base, archivo);
    // Vista de celular: así se verá de pequeña en una lista de videos
    await sharp(base).resize(320, 180).jpeg({ quality: 88 }).toFile(path.join(CONFIG.salida, `miniatura_${nombre}_celular.jpg`));
    console.log(`✅ ${nombre}: ${diseno.grupos.map(g => g.join(' ')).join(' / ')}  (letra ${Math.round(diseno.tamano)}px, ${(bytes / 1024).toFixed(0)} KB)`);
    return base;
}

async function hacerComparativa(bases) {
    const w = 400, h = 225, gap = 14;
    const piezas = [];
    for (let i = 0; i < bases.length; i++) {
        piezas.push({ input: await sharp(bases[i]).resize(w, h).jpeg({ quality: 88 }).toBuffer(), left: gap + i * (w + gap), top: gap });
    }
    await sharp({ create: { width: gap + bases.length * (w + gap), height: h + gap * 2, channels: 3, background: '#111111' } })
        .composite(piezas).jpeg({ quality: 90 }).toFile(path.join(CONFIG.salida, 'comparativa.jpg'));
}

// ---------------------------------------------------------------------
// 6) EJECUCIÓN
// ---------------------------------------------------------------------
(async () => {
    const [argFondo, argTexto, argSub] = process.argv.slice(2);
    if (argTexto) CONFIG.texto = argTexto;
    if (argSub !== undefined) CONFIG.subtexto = argSub;
    const origen = argFondo || (fs.existsSync(CONFIG.fondo) ? CONFIG.fondo : 'comfy');

    fs.mkdirSync(CONFIG.salida, { recursive: true });
    const fondo = await obtenerFondo(origen);
    console.log(`\n📝 Texto: "${CONFIG.texto}"${CONFIG.subtexto ? ` | subtexto: "${CONFIG.subtexto}"` : ''}\n`);

    const bases = [];
    for (const [nombre, estilo] of Object.entries(ESTILOS)) {
        bases.push(await crearMiniatura(fondo, nombre, estilo, CONFIG.texto));
    }
    await hacerComparativa(bases);
    console.log(`\n📁 Listo. Abre la carpeta "${CONFIG.salida}":\n   - miniatura_*.jpg  (1280x720, para subir)\n   - miniatura_*_celular.jpg  (tamaño real en un celular)\n   - comparativa.jpg  (los 3 estilos juntos)`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
