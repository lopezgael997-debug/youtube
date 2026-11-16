// =====================================================================
// MINIATURAS · PLANTILLAS VISUALES
// 14 composiciones (HTML/CSS) + el armado de la página con las capas del ADN
// (efecto de texto, tratamiento de fondo, acentos, tipografía...). El ajuste automático
// del texto también vive aquí. No hace nada por sí solo: lo usa agente_miniaturista.js
// =====================================================================
const fs = require('fs');
const path = require('path');
const { DIR } = require('./config');
const {
    CONFIG, ANCHO, ALTO, FUENTES, esc, numeroDeTexto, rgba, textoSobre, oscuro, contorno, sombraTexto
} = require('./miniatura_util');
const { construirCapas } = require('./miniatura_capas');

// ---------------------------------------------------------------------
// TEXTO
// ---------------------------------------------------------------------
// Palabras en MAYÚSCULAS con la(s) última(s) marcadas como resalte: [{ t, hl }]
function palabrasResalte(gancho, resaltar = 1) {
    const palabras = String(gancho || '').trim().toLocaleUpperCase('es').split(/\s+/).filter(Boolean);
    if (!palabras.length) return [];
    const n = palabras.length === 1 ? 1 : Math.min(resaltar, palabras.length - 1);
    return palabras.map((p, i) => ({ t: esc(p), hl: i >= palabras.length - n }));
}

// Texto en MAYÚSCULAS con la(s) última(s) palabra(s) resaltada(s) (HTML)
function textoConResalte(gancho, resaltar = 1) {
    const pal = palabrasResalte(gancho, resaltar);
    if (!pal.length) return '';
    const normales = pal.filter(p => !p.hl).map(p => p.t).join(' ');
    const resaltadas = pal.filter(p => p.hl).map(p => p.t).join(' ');
    return normales ? `${normales} <span class="hl">${resaltadas}</span>` : `<span class="hl">${resaltadas}</span>`;
}

// ---------------------------------------------------------------------
// FUENTES Y FONDO (todo embebido: sin depender de internet ni de rutas)
// ---------------------------------------------------------------------
let cacheFuentes = null;

function cssFuentesLocales() {
    if (cacheFuentes !== null) return cacheFuentes;
    cacheFuentes = '';
    if (!fs.existsSync(DIR.fuentes)) return cacheFuentes;
    const formatos = { '.ttf': 'truetype', '.otf': 'opentype', '.woff': 'woff', '.woff2': 'woff2' };
    const mimes = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
    const pesoDe = (n) => /variable|\[/i.test(n) ? 9 : /black/i.test(n) ? 8 : /extrabold/i.test(n) ? 7 : /semibold/i.test(n) ? 5 : /bold/i.test(n) ? 6 : /medium/i.test(n) ? 4 : /light|thin/i.test(n) ? 1 : 3;
    // Una familia puede venir en varios archivos (Regular, Bold...): se usa el más pesado
    const porFamilia = {};
    for (const archivo of fs.readdirSync(DIR.fuentes)) {
        const ext = path.extname(archivo).toLowerCase();
        if (!formatos[ext]) continue;
        const base = path.basename(archivo, ext);
        const familia = base.split(/[-\[_ ]/)[0];
        if (!familia) continue;
        if (!porFamilia[familia] || pesoDe(base) > pesoDe(porFamilia[familia].base)) porFamilia[familia] = { archivo, ext, base };
    }
    for (const [familia, f] of Object.entries(porFamilia)) {
        const nombres = new Set([familia, familia.replace(/([a-z])([A-Z])/g, '$1 $2')]);
        const norm = f.base.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (const def of Object.values(FUENTES)) {
            if (def.patron.test(norm)) nombres.add(def.nombre);
        }
        const b64 = fs.readFileSync(path.join(DIR.fuentes, f.archivo)).toString('base64');
        for (const nombre of nombres) {
            cacheFuentes += `@font-face{font-family:'${nombre}';src:url(data:${mimes[f.ext]};base64,${b64}) format('${formatos[f.ext]}');font-weight:100 900;}\n`;
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
// PLANTILLAS (cada una devuelve { css, html, filtroFondo? })
//    d = { t (título con resalte), g (gancho en texto), sub, etiqueta, nivel, total, c (paleta), semilla, foco }
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
    },

    // ----------------------------- NUEVAS -----------------------------

    // Cada palabra en su propia línea, a distinto tamaño, como un cartel de película
    apilado: (d) => {
        const pal = palabrasResalte(d.g, 1);
        const lineas = [];
        if (pal.length <= 4) pal.forEach(p => lineas.push({ t: p.t, hl: p.hl }));
        else for (let i = 0; i < pal.length; i += 2) {
            const par = pal.slice(i, i + 2);
            lineas.push({ t: par.map(x => x.t).join(' '), hl: par.some(x => x.hl) });
        }
        return {
            css: `
            .sombra{position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.86) 0%,rgba(0,0,0,.55) 44%,rgba(0,0,0,0) 72%)}
            .titulo{left:54px;top:110px;width:640px;height:500px;display:flex;flex-direction:column;justify-content:center;text-shadow:${sombraTexto(d.c, 6)}}
            .lin{display:block;white-space:nowrap;text-transform:uppercase;overflow:visible}
            .lin span{display:inline-block}
            .lin.h{color:${d.c.resalte}}
            .badge{left:54px;top:40px;transform:rotate(-2deg)}
            .sub{left:54px;top:636px;width:640px}`,
            html: `
            <div class="sombra"></div>
            ${d.etiqueta ? `<div class="z badge">${esc(d.etiqueta)}</div>` : ''}
            <div class="z titulo" data-stack="270">${lineas.map(l => `<div class="lin${l.hl ? ' h' : ''}"><span>${l.t}</span></div>`).join('')}</div>
            ${d.sub ? `<div class="z sub">${esc(d.sub)}</div>` : ''}`
        };
    },

    // Marco de cartel con doble borde y rombos en las esquinas
    marco: (d) => ({
        css: `
        .sombra{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,.25) 0%,rgba(0,0,0,.78) 100%)}
        .m1{left:24px;top:24px;right:24px;bottom:24px;border:7px solid ${d.c.resalte};box-shadow:0 0 30px ${rgba(d.c.resalte, .5)}}
        .m2{left:46px;top:46px;right:46px;bottom:46px;border:2px solid ${rgba('#ffffff', .75)}}
        .rb{width:26px;height:26px;background:${d.c.resalte};transform:rotate(45deg);border:3px solid #000}
        .tag{left:50%;top:4px;transform:translateX(-50%);background:#000;color:${d.c.resalte};border:3px solid ${d.c.resalte};padding:5px 34px;font-size:34px;letter-spacing:9px;white-space:nowrap}
        .titulo{left:110px;top:170px;width:1060px;height:340px;text-align:center;text-shadow:${sombraTexto(d.c, 6)}}
        .sub{left:0;right:0;top:556px;text-align:center}`,
        html: `
        <div class="sombra"></div><div class="z m1"></div><div class="z m2"></div>
        <div class="z rb" style="left:11px;top:11px"></div><div class="z rb" style="left:1243px;top:11px"></div>
        <div class="z rb" style="left:11px;top:683px"></div><div class="z rb" style="left:1243px;top:683px"></div>
        ${d.etiqueta ? `<div class="z tag">${esc(d.etiqueta)}</div>` : ''}
        <h1 class="z titulo" data-fit="170,56" data-v="centro"><span class="t">${d.t}</span></h1>
        ${d.sub ? `<div class="z sub">${esc(d.sub)}</div>` : ''}`
    }),

    // Cada palabra en una "pegatina" ligeramente inclinada
    bloques: (d) => {
        const pal = palabrasResalte(d.g, 1);
        const cajas = pal.map((p, i) => `<span class="bk${p.hl ? ' h' : ''}" style="transform:rotate(${(((i * 37) % 5) - 2) * 0.9}deg)">${p.t}</span>`).join(' ');
        return {
            css: `
            .sombra{position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.6) 0%,rgba(0,0,0,.3) 50%,rgba(0,0,0,0) 78%)}
            .titulo{left:60px;top:150px;width:780px;height:420px;text-shadow:none}
            .titulo .t{line-height:1.3}
            .bk{display:inline-block;background:#0b0b0f;color:${d.c.color};padding:.02em .24em;margin:6px 8px 6px 0;border:4px solid ${d.c.resalte};box-shadow:8px 8px 0 rgba(0,0,0,.55)}
            .bk.h{background:${d.c.resalte};color:${textoSobre(d.c.resalte)};border-color:#fff}
            .badge{left:60px;top:46px;transform:rotate(-2deg)}
            .sub{left:60px;top:600px;width:780px}`,
            html: `
            <div class="sombra"></div>
            ${d.etiqueta ? `<div class="z badge">${esc(d.etiqueta)}</div>` : ''}
            <h1 class="z titulo" data-fit="170,56" data-v="centro"><span class="t">${cajas}</span></h1>
            ${d.sub ? `<div class="z sub">${esc(d.sub)}</div>` : ''}`
        };
    },

    // Si el gancho trae un número ("21 DÍAS..."), el número es el protagonista (marca de agua gigante)
    numero: (d) => {
        const m = String(d.g || '').match(/\d{1,4}/);
        const num = m ? m[0] : '?';
        const resto = m ? String(d.g).replace(num, '').replace(/\s+/g, ' ').trim() : '';
        const tam = num.length <= 1 ? 720 : num.length === 2 ? 600 : num.length === 3 ? 440 : 340;
        const titulo = resto ? textoConResalte(resto, 1) : d.t;
        return {
            css: `
            .sombra{position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.82) 0%,rgba(0,0,0,.5) 48%,rgba(0,0,0,.05) 82%)}
            .num{left:10px;top:-70px;font-size:${tam}px;line-height:1;white-space:nowrap;color:${rgba(d.c.resalte, .22)};-webkit-text-stroke:8px ${rgba(d.c.resalte, .95)};text-shadow:0 0 60px ${rgba(d.c.resalte, .55)}}
            .titulo{left:54px;top:330px;width:740px;height:290px;text-shadow:${sombraTexto(d.c, 6)}}
            .badge{left:54px;top:46px;transform:rotate(-2deg)}
            .sub{left:54px;top:644px;width:740px}`,
            html: `
            <div class="sombra"></div>
            <div class="z num">${esc(num)}</div>
            ${d.etiqueta ? `<div class="z badge">${esc(d.etiqueta)}</div>` : ''}
            <h1 class="z titulo" data-fit="170,56" data-v="abajo"><span class="t">${titulo}</span></h1>
            ${d.sub ? `<div class="z sub">${esc(d.sub)}</div>` : ''}`
        };
    },

    // Foco: se oscurece todo menos un círculo que rodea al sujeto (usa el punto focal detectado en la imagen)
    circulo: (d) => {
        const R = 270;
        const fx = Math.min(1000, Math.max(840, (d.foco && d.foco.x) || 960));
        const fy = Math.min(460, Math.max(260, (d.foco && d.foco.y) || 360));
        return {
            css: `
            .foco{position:absolute;inset:0;background:radial-gradient(circle at ${fx}px ${fy}px,rgba(0,0,0,0) ${R}px,rgba(0,0,0,.82) ${R + 95}px)}
            .sombraI{position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.7) 0%,rgba(0,0,0,0) 55%)}
            .aro{left:${fx - R}px;top:${fy - R}px;width:${R * 2}px;height:${R * 2}px;border-radius:50%;border:12px solid ${d.c.resalte};box-shadow:0 0 50px ${rgba(d.c.resalte, .85)},inset 0 0 40px rgba(0,0,0,.35)}
            .titulo{left:52px;top:150px;width:${fx - R - 90}px;height:420px;text-shadow:${sombraTexto(d.c, 6)}}
            .badge{left:52px;top:46px;transform:rotate(-2deg)}
            .sub{left:52px;top:600px;width:${fx - R - 90}px}`,
            html: `
            <div class="foco"></div><div class="sombraI"></div><div class="z aro"></div>
            ${d.etiqueta ? `<div class="z badge">${esc(d.etiqueta)}</div>` : ''}
            <h1 class="z titulo" data-fit="170,56" data-v="centro"><span class="t">${d.t}</span></h1>
            ${d.sub ? `<div class="z sub">${esc(d.sub)}</div>` : ''}`
        };
    },

    // Título arriba, ancho completo; el sujeto queda debajo
    cabecera: (d) => ({
        css: `
        .sombra{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.88) 0%,rgba(0,0,0,.5) 36%,rgba(0,0,0,0) 62%,rgba(0,0,0,.55) 100%)}
        .titulo{left:50px;top:28px;width:1180px;height:270px;text-align:center;text-shadow:${sombraTexto(d.c, 6)}}
        .badge{left:50%;bottom:40px;transform:translateX(-50%)}
        .sub{left:0;right:0;bottom:112px;text-align:center}`,
        html: `
        <div class="sombra"></div>
        <h1 class="z titulo" data-fit="180,58" data-v="centro"><span class="t">${d.t}</span></h1>
        ${d.sub ? `<div class="z sub">${esc(d.sub)}</div>` : ''}
        ${d.etiqueta ? `<div class="z badge">${esc(d.etiqueta)}</div>` : ''}`
    })
};

// ---------------------------------------------------------------------
// PÁGINA BASE + AJUSTE AUTOMÁTICO DEL TEXTO
// d.c es la paleta; adn (opcional) trae las capas elegidas por miniatura_adn.js
// ---------------------------------------------------------------------
function armarHTML({ fondoURI, plantilla, d, adn }) {
    const { css, html, filtroFondo } = PLANTILLAS[plantilla](d);
    const c = d.c;
    const capas = adn ? construirCapas(adn, c, plantilla, d.foco) : null;
    const origen = adn && adn.voltear ? 'center center' : '70% 45%';
    const fondoCSS = fondoURI
        ? `background-image:url("${fondoURI}")`
        : `background-image:radial-gradient(circle at 70% 40%,${rgba(c.resalte, .55)},${oscuro(c.trazo)} 70%,#000)`;
    const grano = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .9 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`);

    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>
${cssFuentesLocales()}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${ANCHO}px;height:${ALTO}px;overflow:hidden;background:#000}
.lienzo{position:relative;width:${ANCHO}px;height:${ALTO}px;overflow:hidden;font-family:${CONFIG.fuenteTitulo};font-weight:800;font-synthesis:none}
.fondo{position:absolute;inset:0;${fondoCSS};background-size:cover;background-position:center;transform-origin:${origen};${capas ? `transform:${capas.transform};` : ''}filter:${filtroFondo || ''} ${capas ? capas.trat.filtro : ''} saturate(${c.saturacion}) contrast(${c.contraste}) brightness(${c.brillo})}
.grano{position:absolute;inset:0;background-image:url("data:image/svg+xml;utf8,${grano}");opacity:.16;mix-blend-mode:overlay}
.vineta{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 55%,rgba(0,0,0,.6) 100%)}
.z{position:absolute}
.titulo{text-transform:uppercase;line-height:1.02;letter-spacing:.5px;color:${c.color};overflow:hidden;font-weight:800}
.titulo .t{display:block;text-wrap:balance}
.hl{color:${c.resalte}}
.badge{display:inline-block;background:${c.resalte};color:${textoSobre(c.resalte)};font-size:40px;letter-spacing:2px;padding:8px 26px;border:4px solid #fff;border-radius:8px;box-shadow:0 10px 22px rgba(0,0,0,.55);white-space:nowrap}
.sub{color:#fff;font-size:44px;letter-spacing:3px;text-transform:uppercase;text-shadow:${contorno('#000', 3)},0 6px 14px rgba(0,0,0,.7);white-space:nowrap;overflow:hidden}
${css}
${capas ? capas.cssExtra : ''}
</style></head><body><div class="lienzo">
<div class="fondo"></div>
${capas ? capas.trat.html : ''}
<div class="vineta"></div><div class="grano"></div>
${capas ? capas.abajo.html : ''}
${html}
${capas ? capas.arriba.html : ''}
</div></body></html>`;
}

// Se ejecuta dentro del navegador: reduce la letra hasta que el texto quepa en su caja
// ([data-fit]) y reparte el tamaño de cada línea en los textos apilados ([data-stack]).
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
    document.querySelectorAll('[data-stack]').forEach((caja) => {
        const W = caja.clientWidth, H = caja.clientHeight, MAX = Number(caja.dataset.stack) || 260, LH = 0.98;
        const lineas = Array.from(caja.querySelectorAll('.lin'));
        lineas.forEach((l) => { l.style.fontSize = '100px'; l.style.lineHeight = String(LH); });
        let tam = lineas.map((l) => Math.min(MAX, 100 * W / Math.max(1, l.firstElementChild.getBoundingClientRect().width)));
        const total = tam.reduce((a, t) => a + t * LH, 0);
        if (total > H) tam = tam.map((t) => t * H / total);
        lineas.forEach((l, i) => { l.style.fontSize = tam[i] + 'px'; });
    });
}

module.exports = { ANCHO, ALTO, esc, numeroDeTexto, textoConResalte, palabrasResalte, PLANTILLAS, armarHTML, ajustarTextos, fondoComoDataURI };