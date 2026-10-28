// =====================================================================
// MINIATURAS · PLANTILLAS VISUALES
// Aquí viven los 8 diseños (HTML/CSS), los colores, las fuentes y el ajuste
// automático del texto. No hace nada por sí solo: lo usa agente_miniaturista.js
// =====================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DIR } = require('./config');

const CONFIG = {
    carpetaFuentes: DIR.fuentes,
    fuenteTitulo: "'Anton','Bebas Neue','Oswald',Impact,'Arial Narrow','Liberation Sans Narrow',sans-serif",
    fuenteElegante: "'Cinzel','Playfair Display','Cormorant Garamond',Georgia,'Times New Roman',serif"
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

module.exports = { ANCHO, ALTO, esc, numeroDeTexto, textoConResalte, PLANTILLAS, armarHTML, ajustarTextos, fondoComoDataURI };
