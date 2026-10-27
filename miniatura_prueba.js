// =====================================================================
// GENERADOR DE MINIATURAS v2 (Puppeteer) — independiente del worker
//
// Uso (CLI):
//   node miniatura_prueba.js fondo.png "EL ICEBERG DE LA HISTORIA OCULTA" --canal leo_iceberg --variantes 4
//   node miniatura_prueba.js fondo.png "NADIE SOBREVIVIÓ" --canal papa_misterio --sub "Caso sin resolver" --etiqueta "DESCLASIFICADO"
//   node miniatura_prueba.js fondo.png "EL NIVEL 5 ES REAL" --canal leo_iceberg --nivel 5 --plantilla nivel
//   node miniatura_prueba.js "SOLO TEXTO"     (sin fondo: usa un degradado de la paleta del canal)
//   node miniatura_prueba.js "EL BARCO FANTASMA" --canal papa_misterio --comfy "a man drenched in blood on the deck of an abandoned ship at night"
//        (pinta el fondo con ComfyUI; debe estar abierto. La descripción va en inglés)
//
// Opciones: --canal id | --variantes N | --sub "texto" | --etiqueta "TEXTO" | --nivel N
//           --plantilla nombre | --carpeta salida | --comfy "descripción en inglés del fondo"
//
// Plantillas: impacto_izq, banda, cinema, dividida, sello, nivel, pregunta, etereo
// Fuentes (opcional pero recomendado): pon .ttf/.otf en la carpeta "fuentes" junto a este archivo
//   (Anton, Bebas Neue, Oswald, Cinzel...). Si no hay, usa Impact y fuentes del sistema.
// Los colores y plantillas de cada canal se leen de canales.json (bloque "miniatura").
// =====================================================================
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
try { require('dotenv').config(); } catch { /* dotenv es opcional */ }

// ---------------------------------------------------------------------
// 1) AJUSTES QUE PUEDES EDITAR
// ---------------------------------------------------------------------
const CONFIG = {
    carpetaSalida: path.join(__dirname, 'miniaturas_prueba'),
    carpetaFuentes: path.join(__dirname, 'fuentes'),
    archivoCanales: path.join(__dirname, 'canales.json'),
    variantesPorDefecto: 3,
    maxKB: 1900,                       // YouTube pide menos de 2 MB
    fuenteTitulo: "'Anton','Bebas Neue','Oswald',Impact,'Arial Narrow','Liberation Sans Narrow',sans-serif",
    fuenteElegante: "'Cinzel','Playfair Display','Cormorant Garamond',Georgia,'Times New Roman',serif"
};

// Qué plantillas usa cada nicho (si el canal no define "plantillas" en canales.json)
const PLANTILLAS_POR_NICHO = {
    iceberg: ['nivel', 'impacto_izq', 'banda', 'pregunta'],
    historia: ['sello', 'impacto_izq', 'cinema', 'dividida'],
    metafisica: ['etereo', 'pregunta', 'cinema'],
    misterio: ['sello', 'dividida', 'pregunta', 'impacto_izq', 'banda'],
    ciencia: ['dividida', 'banda', 'impacto_izq', 'pregunta'],
    finanzas: ['banda', 'dividida', 'impacto_izq']
};

// Etiquetas (la "pastilla" o sello) que rotan entre videos. Se pueden sobrescribir en canales.json ("etiquetas")
const ETIQUETAS_POR_NICHO = {
    iceberg: ['LO QUE NADIE DICE', 'NIVEL PROHIBIDO', 'EL FONDO', 'SECRETO'],
    historia: ['EXPEDIENTE ABIERTO', 'HISTORIA OCULTA', 'ARCHIVO SECRETO'],
    metafisica: ['TU ALMA RECUERDA', 'VIDAS PASADAS', 'MENSAJE'],
    misterio: ['CASO SIN RESOLVER', 'DESCLASIFICADO', 'SIN EXPLICACIÓN'],
    ciencia: ['DESCUBRIMIENTO', 'LA CIENCIA LO CONFIRMA'],
    finanzas: ['LO QUE NO TE DICEN', 'EVÍTALO']
};

// Paleta por defecto si un canal no trae "estilo"
const ESTILO_BASE = {
    color: '#FFFFFF', resalte: '#FF2A2A', trazo: '#000000',
    brillo: 1.0, saturacion: 1.15, contraste: 1.15
};

const ANCHO = 1280, ALTO = 720;

// ---------------------------------------------------------------------
// 2) UTILIDADES
// ---------------------------------------------------------------------
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const numeroDeTexto = (t) => parseInt(crypto.createHash('md5').update(String(t)).digest('hex').slice(0, 8), 16);

function hexARgb(hex) {
    let h = String(hex || '#000000').replace('#', '');
    if (h.length === 3) h = h.split('').map(x => x + x).join('');
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
const rgba = (hex, a) => { const { r, g, b } = hexARgb(hex); return `rgba(${r},${g},${b},${a})`; };
function luminancia(hex) {
    const { r, g, b } = hexARgb(hex);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
const textoSobre = (hex) => (luminancia(hex) > 0.55 ? '#111111' : '#FFFFFF');
const oscuro = (hex) => (luminancia(hex) > 0.35 ? '#0b0b0f' : hex);

// Contorno grueso alrededor de las letras (funciona en cualquier versión de Chrome)
function contorno(color, px) {
    const sombras = [];
    for (let i = 0; i < 16; i++) {
        const a = (i / 16) * 2 * Math.PI;
        sombras.push(`${(Math.cos(a) * px).toFixed(1)}px ${(Math.sin(a) * px).toFixed(1)}px 0 ${color}`);
    }
    return sombras.join(', ');
}
const sombraTexto = (c, px = 7, extra = '') =>
    `${contorno(c.trazo, px)}, 0 10px 24px rgba(0,0,0,.7)${extra ? ', ' + extra : ''}`;

// Texto en MAYÚSCULAS con la(s) última(s) palabra(s) resaltada(s)
function textoConResalte(gancho, resaltar = 1) {
    const palabras = String(gancho || '').trim().toLocaleUpperCase('es').split(/\s+/).filter(Boolean);
    if (!palabras.length) return '';
    const n = palabras.length === 1 ? 1 : Math.min(resaltar, palabras.length - 1);
    const normales = palabras.slice(0, palabras.length - n).map(esc).join(' ');
    const resaltadas = palabras.slice(palabras.length - n).map(esc).join(' ');
    return normales ? `${normales} <span class="hl">${resaltadas}</span>` : `<span class="hl">${resaltadas}</span>`;
}

// ---------------------------------------------------------------------
// 3) FUENTES Y FONDO (todo embebido: sin depender de internet ni de rutas)
// ---------------------------------------------------------------------
let cacheFuentes = null;
function cssFuentesLocales() {
    if (cacheFuentes !== null) return cacheFuentes;
    cacheFuentes = '';
    if (!fs.existsSync(CONFIG.carpetaFuentes)) return cacheFuentes;
    const formatos = { '.ttf': 'truetype', '.otf': 'opentype', '.woff': 'woff', '.woff2': 'woff2' };
    const mimes = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
    for (const archivo of fs.readdirSync(CONFIG.carpetaFuentes)) {
        const ext = path.extname(archivo).toLowerCase();
        if (!formatos[ext]) continue;
        const familia = path.basename(archivo, ext).replace(/[-_ ](Regular|Bold|Medium|Black|Light|SemiBold|ExtraBold|Italic)$/i, '');
        const nombres = new Set([familia, familia.replace(/([a-z])([A-Z])/g, '$1 $2')]);
        const b64 = fs.readFileSync(path.join(CONFIG.carpetaFuentes, archivo)).toString('base64');
        for (const nombre of nombres) {
            cacheFuentes += `@font-face{font-family:'${nombre}';src:url(data:${mimes[ext]};base64,${b64}) format('${formatos[ext]}');font-weight:100 900;}\n`;
        }
    }
    return cacheFuentes;
}

function fondoComoDataURI(fondo) {
    if (!fondo) return null;
    const buf = Buffer.isBuffer(fondo) ? fondo : fs.readFileSync(fondo);
    let mime = 'image/png';
    if (buf[0] === 0xFF && buf[1] === 0xD8) mime = 'image/jpeg';
    else if (buf.slice(0, 4).toString() === 'RIFF') mime = 'image/webp';
    return `data:${mime};base64,${buf.toString('base64')}`;
}


// ---------------------------------------------------------------------
// 3b) FONDO CON COMFYUI (si no tienes imagen)
// ---------------------------------------------------------------------
const COMFY = {
    url: (process.env.COMFY_URL || 'http://127.0.0.1:8188').replace(/\/$/, ''),
    checkpoint: process.env.COMFY_CHECKPOINT || '',
    pasos: Number(process.env.IMAGEN_PASOS || 30),
    cfg: Number(process.env.IMAGEN_CFG || 6.5),
    negativo: 'text, letters, words, watermark, logo, signature, blurry, low quality, deformed, extra fingers, bad anatomy, extra limbs, cartoon'
};

// Arma el prompt del fondo: la escena (en inglés) + el aspecto del canal + composición que deja espacio al texto
function promptDeFondo(escena, canal) {
    const estiloCanal = (canal.miniatura && canal.miniatura.fondoEstilo) || '';
    return [escena, estiloCanal, 'dramatic cinematic composition, main subject on the right side of the frame, dark empty space on the left, strong focal point, highly detailed, sharp focus, no text']
        .filter(Boolean).join(', ');
}

async function pintarFondoComfy(prompt) {
    console.log('🎨 Pintando el fondo con ComfyUI (puede tardar unos segundos)...');
    let r;
    try {
        if (!COMFY.checkpoint) {
            r = await fetch(`${COMFY.url}/object_info/CheckpointLoaderSimple`);
            const d = await r.json();
            const lista = d?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
            if (!lista.length) throw new Error('ComfyUI no tiene modelos (checkpoints) instalados.');
            COMFY.checkpoint = lista[0];
            console.log(`   modelo: ${COMFY.checkpoint}`);
        }
    } catch (e) {
        throw new Error(`No pude hablar con ComfyUI en ${COMFY.url}. ¿Está abierto? (${e.message})`);
    }
    const flujo = {
        '3': { class_type: 'KSampler', inputs: { seed: Math.floor(Math.random() * 1e9), steps: COMFY.pasos, cfg: COMFY.cfg, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
        '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: COMFY.checkpoint } },
        '5': { class_type: 'EmptyLatentImage', inputs: { width: 1344, height: 768, batch_size: 1 } },
        '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
        '7': { class_type: 'CLIPTextEncode', inputs: { text: COMFY.negativo, clip: ['4', 1] } },
        '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
        '9': { class_type: 'PreviewImage', inputs: { images: ['8', 0] } }
    };
    r = await fetch(`${COMFY.url}/prompt`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: flujo, client_id: 'miniatura-prueba' })
    });
    if (!r.ok) throw new Error(`ComfyUI rechazó el flujo: ${(await r.text()).slice(0, 300)}`);
    const { prompt_id } = await r.json();
    const limite = Date.now() + 5 * 60 * 1000;
    while (Date.now() < limite) {
        await new Promise(res => setTimeout(res, 800));
        const h = await (await fetch(`${COMFY.url}/history/${prompt_id}`)).json();
        const item = h[prompt_id];
        if (!item) continue;
        if (item.status && item.status.status_str === 'error') throw new Error('ComfyUI reportó un error al pintar.');
        const img = Object.values(item.outputs || {}).flatMap(o => o.images || [])[0];
        if (img) {
            const v = await fetch(`${COMFY.url}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'temp')}`);
            if (!v.ok) throw new Error(`No se pudo descargar la imagen de ComfyUI (HTTP ${v.status}).`);
            return Buffer.from(await v.arrayBuffer());
        }
    }
    throw new Error('Se agotó el tiempo esperando a ComfyUI.');
}

// ---------------------------------------------------------------------
// 4) PLANTILLAS (cada una devuelve { css, html, filtroFondo? })
//    d = { t (título con resalte), sub, etiqueta, nivel, total, c (paleta), semilla }
// ---------------------------------------------------------------------
const PLANTILLAS = {

    // Texto grande a la izquierda, pastilla inclinada arriba y barra de acento
    impacto_izq: (d) => ({
        css: `
        .sombra{position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.88) 0%,rgba(0,0,0,.6) 38%,rgba(0,0,0,0) 72%)}
        .titulo{left:54px;top:150px;width:700px;height:430px;text-shadow:${sombraTexto(d.c, 7)}}
        .badge{left:54px;top:46px;transform:rotate(-3deg)}
        .barra{left:54px;top:610px;width:320px;height:16px;background:${d.c.resalte};transform:skewX(-25deg);box-shadow:0 0 24px ${rgba(d.c.resalte, .8)}}
        .sub{left:54px;top:636px;width:700px}`,
        html: `
        <div class="sombra"></div>
        ${d.etiqueta ? `<div class="z badge">${esc(d.etiqueta)}</div>` : ''}
        <h1 class="z titulo" data-fit="190,64" data-v="centro"><span class="t">${d.t}</span></h1>
        <div class="z barra"></div>
        ${d.sub ? `<div class="z sub">${esc(d.sub)}</div>` : ''}`
    }),

    // Banda de color inclinada abajo, estilo YouTube clásico
    banda: (d) => ({
        css: `
        .sombra{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.15) 0%,rgba(0,0,0,0) 40%,rgba(0,0,0,.75) 100%)}
        .banda{left:-30px;right:-30px;top:430px;height:250px;background:${d.c.resalte};transform:rotate(-2.5deg);box-shadow:0 16px 0 #000,0 30px 50px rgba(0,0,0,.6)}
        .titulo{left:70px;top:446px;width:1140px;height:216px;color:${textoSobre(d.c.resalte)};text-align:center;transform:rotate(-2.5deg);text-shadow:none}
        .titulo .hl{color:${textoSobre(d.c.resalte)};text-decoration:underline;text-decoration-thickness:10px;text-underline-offset:8px}
        .badge{left:60px;top:370px;transform:rotate(-4deg);background:#000;color:${d.c.color};border-color:${d.c.resalte}}
        .sub{left:0;right:0;top:48px;text-align:center}`,
        html: `
        <div class="sombra"></div>
        ${d.sub ? `<div class="z sub">${esc(d.sub)}</div>` : ''}
        <div class="z banda"></div>
        ${d.etiqueta ? `<div class="z badge">${esc(d.etiqueta)}</div>` : ''}
        <h1 class="z titulo" data-fit="150,56" data-v="centro"><span class="t">${d.t}</span></h1>`
    }),

    // Barras de cine arriba y abajo; sobrio y elegante
    cinema: (d) => ({
        css: `
        .barraTop,.barraBot{position:absolute;left:0;right:0;height:84px;background:#000}
        .barraTop{top:0;border-bottom:3px solid ${d.c.resalte}}
        .barraBot{bottom:0;border-top:3px solid ${d.c.resalte}}
        .sombra{position:absolute;left:0;right:0;top:84px;bottom:84px;background:linear-gradient(180deg,rgba(0,0,0,0) 35%,rgba(0,0,0,.78) 100%)}
        .tag{left:0;right:0;top:0;height:84px;display:flex;align-items:center;justify-content:center;color:${d.c.resalte};font-size:34px;letter-spacing:14px}
        .titulo{left:90px;top:372px;width:1100px;height:230px;text-align:center;text-shadow:${sombraTexto(d.c, 6)}}
        .sub{left:0;right:0;bottom:0;height:84px;display:flex;align-items:center;justify-content:center;font-size:32px;letter-spacing:8px;color:#fff;text-shadow:none}`,
        html: `
        <div class="sombra"></div><div class="barraTop"></div><div class="barraBot"></div>
        ${d.etiqueta ? `<div class="z tag">${esc(d.etiqueta)}</div>` : ''}
        <h1 class="z titulo" data-fit="165,58" data-v="abajo"><span class="t">${d.t}</span></h1>
        ${d.sub ? `<div class="z sub">${esc(d.sub)}</div>` : ''}`
    }),

    // Panel oscuro diagonal a la izquierda con franja de acento; la imagen respira a la derecha
    dividida: (d) => ({
        css: `
        .panel{position:absolute;inset:0;background:linear-gradient(135deg,${oscuro(d.c.trazo)} 0%,#000 100%);clip-path:polygon(0 0,650px 0,505px 720px,0 720px)}
        .franja{position:absolute;inset:0;background:${d.c.resalte};clip-path:polygon(650px 0,684px 0,539px 720px,505px 720px)}
        .tag{left:50px;top:70px;color:${d.c.resalte};font-size:36px;letter-spacing:7px;border-bottom:4px solid ${d.c.resalte};padding-bottom:6px;white-space:nowrap}
        .titulo{left:50px;top:150px;width:470px;height:420px;text-shadow:${sombraTexto({ trazo: '#000' }, 4)}}
        .sub{left:50px;top:600px;width:440px;font-size:34px}`,
        html: `
        <div class="panel"></div><div class="franja"></div>
        ${d.etiqueta ? `<div class="z tag">${esc(d.etiqueta)}</div>` : ''}
        <h1 class="z titulo" data-fit="150,54" data-v="centro"><span class="t">${d.t}</span></h1>
        ${d.sub ? `<div class="z sub">${esc(d.sub)}</div>` : ''}`
    }),

    // Expediente: papel con el título + sello rojo inclinado. Ideal para misterio e historia
    sello: (d) => ({
        filtroFondo: 'grayscale(.55) sepia(.35)',
        css: `
        .sombra{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.45),rgba(0,0,0,.2) 45%,rgba(0,0,0,.7))}
        .papel{left:56px;top:232px;width:790px;height:300px;background:#efe6cf;background-image:repeating-linear-gradient(0deg,rgba(120,90,40,.05) 0 2px,transparent 2px 5px);transform:rotate(-2deg);box-shadow:0 18px 40px rgba(0,0,0,.7),inset 0 0 40px rgba(120,90,40,.25)}
        .cinta{left:330px;top:206px;width:200px;height:52px;background:rgba(235,225,190,.85);transform:rotate(3deg);box-shadow:0 4px 10px rgba(0,0,0,.4)}
        .titulo{left:84px;top:252px;width:734px;height:262px;color:#141414;transform:rotate(-2deg);text-shadow:none}
        .titulo .hl{color:#B3121A}
        .stamp{right:64px;top:74px;transform:rotate(11deg);border:9px solid #C1121F;color:#C1121F;background:rgba(240,230,210,.93);padding:6px 26px;font-size:58px;letter-spacing:6px;box-shadow:0 8px 24px rgba(0,0,0,.55);white-space:nowrap}
        .sub{left:60px;top:578px;width:780px;transform:rotate(-1deg)}`,
        html: `
        <div class="sombra"></div>
        <div class="z papel"></div><div class="z cinta"></div>
        <h1 class="z titulo" data-fit="150,52" data-v="centro"><span class="t">${d.t}</span></h1>
        ${d.etiqueta ? `<div class="z stamp">${esc(d.etiqueta)}</div>` : ''}
        ${d.sub ? `<div class="z sub">${esc(d.sub)}</div>` : ''}`
    }),

    // Iceberg: medidor de profundidad a la izquierda y número de nivel gigante
    nivel: (d) => {
        const total = Math.max(2, d.total || 7);
        const nivel = d.nivel ? Math.min(total, Math.max(1, d.nivel)) : null;
        const posMarca = 22 + ((nivel ? nivel - 1 : total - 1) / (total - 1)) * 600;
        return {
            css: `
            .sombra{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,12,28,0) 0%,rgba(0,12,28,.55) 55%,rgba(0,8,20,.92) 100%)}
            .medidor{left:34px;top:40px;width:16px;height:640px;border-radius:8px;background:linear-gradient(180deg,${d.c.color},#0a4a8a 55%,#020b1c);border:3px solid #fff;box-shadow:0 0 26px ${rgba(d.c.color, .7)}}
            .marca{left:58px;top:${posMarca}px;width:0;height:0;border-top:18px solid transparent;border-bottom:18px solid transparent;border-right:30px solid ${d.c.resalte};filter:drop-shadow(0 0 8px #000)}
            .numero{right:70px;top:-10px;font-size:480px;line-height:1;color:transparent;-webkit-text-stroke:10px ${d.c.color};text-shadow:0 0 50px ${rgba(d.c.color, .75)};opacity:.95}
            .palabra{right:84px;top:420px;font-size:70px;letter-spacing:18px;color:${d.c.color};text-shadow:${sombraTexto({ trazo: '#000' }, 4)}}
            .titulo{left:110px;top:360px;width:690px;height:300px;text-shadow:${sombraTexto(d.c, 7)}}
            .badge{left:110px;top:46px;transform:rotate(-2deg)}
            .sub{left:110px;top:664px;width:690px;font-size:36px}`,
            html: `
            <div class="sombra"></div>
            <div class="z medidor"></div><div class="z marca"></div>
            ${nivel ? `<div class="z numero">${nivel}</div><div class="z palabra">NIVEL</div>` : ''}
            ${d.etiqueta ? `<div class="z badge">${esc(d.etiqueta)}</div>` : ''}
            <h1 class="z titulo" data-fit="150,54" data-v="abajo"><span class="t">${d.t}</span></h1>
            ${d.sub ? `<div class="z sub">${esc(d.sub)}</div>` : ''}`
        };
    },

    // Signo de interrogación gigante detrás del texto: curiosidad pura
    pregunta: (d) => ({
        css: `
        .sombra{position:absolute;inset:0;background:radial-gradient(ellipse at 70% 45%,rgba(0,0,0,.1) 0%,rgba(0,0,0,.75) 85%)}
        .signo{right:40px;top:-120px;font-size:880px;line-height:1;color:${rgba(d.c.resalte, .3)};text-shadow:0 0 60px ${rgba(d.c.resalte, .8)};filter:blur(1.5px)}
        .titulo{left:60px;top:140px;width:760px;height:400px;text-shadow:${sombraTexto(d.c, 7)}}
        .badge{left:60px;top:50px;background:transparent;color:${d.c.resalte};border:4px solid ${d.c.resalte};transform:none}
        .sub{left:60px;top:580px;width:760px}`,
        html: `
        <div class="sombra"></div>
        <div class="z signo">?</div>
        ${d.etiqueta ? `<div class="z badge">${esc(d.etiqueta)}</div>` : ''}
        <h1 class="z titulo" data-fit="180,60" data-v="centro"><span class="t">${d.t}</span></h1>
        ${d.sub ? `<div class="z sub">${esc(d.sub)}</div>` : ''}`
    }),

    // Etéreo: luz, rayos suaves y tipografía elegante. Para metafísica
    etereo: (d) => {
        let polvo = '';
        for (let i = 0; i < 26; i++) {
            const s = numeroDeTexto(d.semilla + 'p' + i);
            const x = s % 1280, y = (s >> 5) % 720, r = 2 + (s % 5);
            polvo += `<div class="z" style="left:${x}px;top:${y}px;width:${r}px;height:${r}px;border-radius:50%;background:${d.c.resalte};opacity:${0.35 + (s % 50) / 100};box-shadow:0 0 ${r * 4}px ${d.c.resalte}"></div>`;
        }
        return {
            filtroFondo: 'saturate(1.05) brightness(.9)',
            css: `
            .luz{position:absolute;inset:0;background:radial-gradient(circle at 50% 44%,${rgba(d.c.resalte, .5)} 0%,rgba(0,0,0,0) 58%);mix-blend-mode:screen}
            .rayos{position:absolute;inset:0;background:repeating-conic-gradient(from 0deg at 50% 44%,rgba(255,255,255,.09) 0 5deg,transparent 5deg 13deg);-webkit-mask-image:radial-gradient(circle at 50% 44%,#000 0%,transparent 62%);mask-image:radial-gradient(circle at 50% 44%,#000 0%,transparent 62%)}
            .velo{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(20,5,40,.15) 0%,rgba(10,0,25,.78) 100%)}
            .titulo{left:110px;top:196px;width:1060px;height:330px;font-family:${CONFIG.fuenteElegante};font-weight:800;letter-spacing:5px;text-align:center;color:${d.c.color};text-shadow:0 0 30px ${rgba(d.c.resalte, .9)},0 4px 18px rgba(0,0,0,.85),${contorno(d.c.trazo, 3)}}
            .titulo .hl{color:${d.c.resalte}}
            .tag{left:0;right:0;top:78px;text-align:center;font-family:${CONFIG.fuenteElegante};font-size:32px;letter-spacing:16px;color:${d.c.resalte};text-shadow:0 0 18px ${rgba(d.c.resalte, .8)}}
            .linea{left:360px;width:560px;height:3px;background:linear-gradient(90deg,transparent,${d.c.resalte},transparent)}
            .sub{left:0;right:0;top:590px;text-align:center;font-family:${CONFIG.fuenteElegante};font-size:36px;letter-spacing:8px}`,
            html: `
            <div class="luz"></div><div class="rayos"></div><div class="velo"></div>${polvo}
            ${d.etiqueta ? `<div class="z tag">${esc(d.etiqueta)}</div>` : ''}
            <div class="z linea" style="top:148px"></div><div class="z linea" style="top:560px"></div>
            <h1 class="z titulo" data-fit="150,52" data-v="centro"><span class="t">${d.t}</span></h1>
            ${d.sub ? `<div class="z sub">${esc(d.sub)}</div>` : ''}`
        };
    }
};

// ---------------------------------------------------------------------
// 5) PÁGINA BASE + AJUSTE AUTOMÁTICO DEL TEXTO
// ---------------------------------------------------------------------
function armarHTML({ fondoURI, plantilla, d }) {
    const { css, html, filtroFondo } = PLANTILLAS[plantilla](d);
    const c = d.c;
    const fondoCSS = fondoURI
        ? `background-image:url("${fondoURI}")`
        : `background-image:radial-gradient(circle at 70% 40%,${rgba(c.resalte, .55)},${oscuro(c.trazo)} 70%,#000)`;
    const grano = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .9 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`);

    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>
${cssFuentesLocales()}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${ANCHO}px;height:${ALTO}px;overflow:hidden;background:#000}
.lienzo{position:relative;width:${ANCHO}px;height:${ALTO}px;overflow:hidden;font-family:${CONFIG.fuenteTitulo};font-weight:800;font-synthesis:none}
.fondo{position:absolute;inset:0;${fondoCSS};background-size:cover;background-position:center;filter:${filtroFondo || ''} saturate(${c.saturacion}) contrast(${c.contraste}) brightness(${c.brillo})}
.grano{position:absolute;inset:0;background-image:url("data:image/svg+xml;utf8,${grano}");opacity:.16;mix-blend-mode:overlay}
.vineta{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 55%,rgba(0,0,0,.6) 100%)}
.z{position:absolute}
.titulo{text-transform:uppercase;line-height:1.02;letter-spacing:.5px;color:${c.color};overflow:hidden;font-weight:800}
.titulo .t{display:block;text-wrap:balance}
.hl{color:${c.resalte}}
.badge{display:inline-block;background:${c.resalte};color:${textoSobre(c.resalte)};font-size:40px;letter-spacing:2px;padding:8px 26px;border:4px solid #fff;border-radius:8px;box-shadow:0 10px 22px rgba(0,0,0,.55);white-space:nowrap}
.sub{color:#fff;font-size:44px;letter-spacing:3px;text-transform:uppercase;text-shadow:${contorno('#000', 3)},0 6px 14px rgba(0,0,0,.7);white-space:nowrap;overflow:hidden}
${css}
</style></head><body><div class="lienzo">
<div class="fondo"></div>
<div class="vineta"></div><div class="grano"></div>
${html}
</div></body></html>`;
}

// Se ejecuta dentro del navegador: reduce la letra hasta que el texto quepa en su caja
function ajustarTextos() {
    document.querySelectorAll('[data-fit]').forEach((h) => {
        const [max, min] = h.dataset.fit.split(',').map(Number);
        const t = h.firstElementChild;
        let s = max;
        h.style.fontSize = s + 'px';
        t.style.marginTop = '0px';
        while ((t.offsetHeight > h.clientHeight + 1 || t.scrollWidth > h.clientWidth + 1) && s > min) {
            s -= 3;
            h.style.fontSize = s + 'px';
        }
        const libre = Math.max(0, h.clientHeight - t.offsetHeight);
        if (h.dataset.v === 'centro') t.style.marginTop = (libre / 2) + 'px';
        if (h.dataset.v === 'abajo') t.style.marginTop = libre + 'px';
    });
}

// ---------------------------------------------------------------------
// 6) CANALES Y ELECCIÓN DE DISEÑO
// ---------------------------------------------------------------------
function leerCanales() {
    try { return JSON.parse(fs.readFileSync(CONFIG.archivoCanales, 'utf-8')); }
    catch { return []; }
}

function resolverCanal(canal) {
    if (canal && typeof canal === 'object') return canal;
    const lista = leerCanales();
    return lista.find(c => c.id === canal) || lista[0] || { id: 'sin_canal', nicho: 'misterio' };
}

// Elige las plantillas de las variantes: determinista por historia (mismo título = mismo resultado),
// pero distinto entre títulos, para que no todos los videos se vean iguales.
function elegirDisenos(canal, gancho, cantidad, plantillaForzada) {
    const nicho = canal.nicho || 'misterio';
    const cfg = canal.miniatura || {};
    const lista = (cfg.plantillas || PLANTILLAS_POR_NICHO[nicho] || Object.keys(PLANTILLAS)).filter(p => PLANTILLAS[p]);
    const etiquetas = cfg.etiquetas || ETIQUETAS_POR_NICHO[nicho] || [''];
    const base = numeroDeTexto(`${canal.id}|${gancho}`);
    const disenos = [];
    for (let i = 0; i < cantidad; i++) {
        const plantilla = plantillaForzada && PLANTILLAS[plantillaForzada] ? plantillaForzada : lista[(base + i) % lista.length];
        // a partir de la segunda vuelta de plantillas, se invierten colores para que no se repitan
        const vuelta = Math.floor(i / lista.length);
        disenos.push({
            plantilla,
            etiqueta: etiquetas[(base + i) % etiquetas.length],
            invertir: vuelta % 2 === 1
        });
    }
    return disenos;
}

function paletaDe(canal, invertir) {
    const e = { ...ESTILO_BASE, ...((canal.miniatura && canal.miniatura.estilo) || {}) };
    if (invertir) [e.color, e.resalte] = [e.resalte, e.color];
    return e;
}

// ---------------------------------------------------------------------
// 7) GENERAR
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

/**
 * Genera una o varias miniaturas para una historia.
 * @param {object} o
 *  - gancho   (texto corto de 2 a 4 palabras)       [obligatorio]
 *  - fondo    (ruta o Buffer de la imagen de fondo)  [opcional; sin fondo usa un degradado]
 *  - canal    (id de canales.json u objeto del canal)
 *  - promptFondo (descripción en inglés de la escena; si no hay 'fondo', se pinta con ComfyUI)
 *  - sub, etiqueta, nivel, total, plantilla, variantes, carpeta, nombreBase
 *  - browser  (opcional: reutiliza un navegador ya abierto)
 * @returns {Promise<string[]>} rutas de las miniaturas
 */
async function generarMiniaturas(o) {
    if (!o || !String(o.gancho || '').trim()) throw new Error('Falta el texto (gancho) de la miniatura.');
    const canal = resolverCanal(o.canal);
    const carpeta = o.carpeta || CONFIG.carpetaSalida;
    fs.mkdirSync(carpeta, { recursive: true });
    const cantidad = Math.max(1, Number(o.variantes) || CONFIG.variantesPorDefecto);
    let fondoImg = o.fondo || null;
    if (!fondoImg && o.promptFondo) {
        fondoImg = await pintarFondoComfy(promptDeFondo(o.promptFondo, canal));
        const guardado = path.join(carpeta, `${o.nombreBase || 'miniatura'}_fondo.png`);
        fs.writeFileSync(guardado, fondoImg);
        console.log(`   fondo guardado en ${guardado} (puedes reutilizarlo sin repintar)`);
    }
    const fondoURI = fondoComoDataURI(fondoImg);
    const gancho = String(o.gancho).trim();
    const semilla = `${canal.id}|${gancho}`;
    const disenos = elegirDisenos(canal, gancho, cantidad, o.plantilla);

    const propio = !o.browser;
    const browser = o.browser || await puppeteer.launch({ headless: true });
    const archivos = [];
    try {
        for (let i = 0; i < disenos.length; i++) {
            const dis = disenos[i];
            const etiqueta = o.etiqueta !== undefined ? o.etiqueta : dis.etiqueta;
            const d = {
                t: textoConResalte(gancho, 1),
                sub: o.sub || '',
                etiqueta,
                nivel: o.nivel ? Number(o.nivel) : null,
                total: o.total ? Number(o.total) : 7,
                c: paletaDe(canal, dis.invertir),
                semilla: semilla + i
            };
            const html = armarHTML({ fondoURI, plantilla: dis.plantilla, d });
            const page = await prepararPagina(browser, html);
            const nombre = `${o.nombreBase || 'miniatura'}_${i + 1}_${dis.plantilla}${dis.invertir ? '_inv' : ''}.jpg`;
            const destino = path.join(carpeta, nombre);
            const bytes = await guardarImagen(page, destino);
            await page.close();
            archivos.push(destino);
            console.log(`✅ ${nombre}  (${(bytes / 1024).toFixed(0)} KB)`);
        }
        if (archivos.length > 1) await hacerComparativa(browser, archivos, path.join(carpeta, `${o.nombreBase || 'miniatura'}_comparativa.jpg`));
    } finally {
        if (propio) await browser.close();
    }
    return archivos;
}

// Hoja con todas las variantes juntas + fila en tamaño de celular (para ver si se lee de lejos)
async function hacerComparativa(browser, archivos, destino) {
    const uri = (f) => `data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}`;
    const grandes = archivos.map(f => `<div><img src="${uri(f)}" style="width:400px;height:225px;display:block"><p style="margin:4px 0 0">${esc(path.basename(f).replace(/\.jpg$/, ''))}</p></div>`).join('');
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

// ---------------------------------------------------------------------
// 8) LÍNEA DE COMANDOS
// ---------------------------------------------------------------------
function leerArgs(argv) {
    const pos = [], flags = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) flags[a.slice(2)] = (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
        else pos.push(a);
    }
    return { pos, flags };
}

async function principal() {
    const { pos, flags } = leerArgs(process.argv.slice(2));
    let fondo = null, gancho = null;
    if (pos.length >= 2) [fondo, gancho] = pos;
    else if (pos.length === 1) { if (fs.existsSync(pos[0])) fondo = pos[0]; else gancho = pos[0]; }
    gancho = gancho || 'EL ICEBERG DE LA HISTORIA OCULTA';
    if (!fondo && pos.length === 0) {
        fondo = ['fondo.png', 'fondo_generado_comfyui.jpg'].map(f => path.join(__dirname, f)).find(f => fs.existsSync(f)) || null;
    }
    if (fondo && !fs.existsSync(fondo)) throw new Error(`No encuentro la imagen de fondo "${fondo}".`);
    if (!fondo && !flags.comfy) console.log('ℹ️  No hay imagen de fondo: se usa un degradado. Para pintar una con ComfyUI añade  --comfy "descripción en inglés"');
    console.log(`🎨 Texto: "${gancho}" | fondo: ${fondo || '(degradado)'} | canal: ${flags.canal || '(el primero de canales.json)'}`);
    await generarMiniaturas({
        gancho, fondo,
        canal: flags.canal,
        sub: flags.sub === true ? '' : flags.sub,
        etiqueta: flags.etiqueta === undefined ? undefined : (flags.etiqueta === true ? '' : flags.etiqueta),
        nivel: flags.nivel,
        plantilla: flags.plantilla,
        variantes: flags.variantes,
        promptFondo: (!fondo && flags.comfy) ? (flags.comfy === true ? 'a dramatic mysterious scene related to: ' + gancho : flags.comfy) : undefined,
        carpeta: flags.carpeta
    });
    console.log(`\n📁 Revisa la carpeta: ${flags.carpeta || CONFIG.carpetaSalida}`);
}

module.exports = { generarMiniaturas, pintarFondoComfy, promptDeFondo, PLANTILLAS };

if (require.main === module) {
    principal().catch(e => { console.error('❌', e.message); process.exit(1); });
}
