// =====================================================================
// MINIATURAS · CAPAS COMBINABLES
// Cada capa es independiente de la plantilla: efecto del texto, tratamiento del
// fondo, acentos decorativos, estilo de etiqueta, tipografía, zoom y espejo.
// miniatura_adn.js decide qué combinación lleva cada miniatura.
// =====================================================================
const { FUENTES, CONFIG, rgba, contorno, mezclar, crearRng } = require('./miniatura_util');

// Qué plantillas admiten cada capa (las demás ya traen su propio estilo de texto)
const COMPAT = {
    efecto: new Set(['impacto_izq', 'cinema', 'dividida', 'nivel', 'pregunta', 'apilado', 'marco', 'numero', 'circulo', 'cabecera']),
    etiqueta: new Set(['impacto_izq', 'nivel', 'apilado', 'circulo', 'cabecera', 'numero', 'marco', 'bloques']),
    fuente: (plantilla) => plantilla !== 'etereo'
};

// ---------------------------------------------------------------------
// EFECTOS DEL TEXTO (se aplican sobre .titulo)
// ---------------------------------------------------------------------
const EFECTOS = {
    contorno: () => '',

    brillo: (c) => `.titulo{text-shadow:${contorno(c.trazo, 3)},0 0 22px ${rgba(c.resalte, .95)},0 0 54px ${rgba(c.resalte, .65)},0 8px 18px rgba(0,0,0,.7)}`,

    extruido: (c) => {
        const cara = mezclar(c.resalte, '#000000', 0.55);
        const capas = Array.from({ length: 10 }, (_, i) => `${i + 1}px ${i + 1}px 0 ${cara}`).join(',');
        return `.titulo{text-shadow:${contorno(c.trazo, 3)},${capas},12px 16px 24px rgba(0,0,0,.6)}`;
    },

    degradado: (c) => {
        const borde = ['4px 0', '-4px 0', '0 4px', '0 -4px'].map(o => `drop-shadow(${o} 0 ${c.trazo})`).join(' ');
        return `.titulo{text-shadow:none}
.titulo .t{background:linear-gradient(180deg,${c.color} 8%,${mezclar(c.color, c.resalte, .55)} 60%,${c.resalte} 100%);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;filter:${borde} drop-shadow(0 8px 14px rgba(0,0,0,.65))}
.titulo .t .hl{background:linear-gradient(180deg,${mezclar(c.resalte, '#ffffff', .6)} 0%,${c.resalte} 70%);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}`;
    },

    neon: (c) => `.titulo{color:#ffffff;text-shadow:${contorno(c.trazo, 3)},0 0 12px ${c.resalte},0 0 28px ${c.resalte},0 0 56px ${rgba(c.resalte, .85)}}
.titulo .hl{color:${mezclar(c.resalte, '#ffffff', .45)};text-shadow:${contorno(c.trazo, 3)},0 0 16px ${c.resalte},0 0 36px ${c.resalte},0 0 72px ${c.resalte}}`,

    doble: (c) => `.titulo{text-shadow:${contorno(c.trazo, 3)},9px 9px 0 ${c.resalte}}
.titulo .hl{text-shadow:${contorno(c.trazo, 3)},9px 9px 0 ${c.color}}`
};

// ---------------------------------------------------------------------
// TRATAMIENTOS DE FONDO: devuelven { filtro, css, html }  (html = capa de tono sobre la imagen)
// ---------------------------------------------------------------------
const capaTono = (css) => ({ css: `.tono{position:absolute;inset:0;${css}}`, html: '<div class="tono"></div>' });

const TRATAMIENTOS = {
    natural: () => ({ filtro: '', css: '', html: '' }),

    duotono: (c) => ({
        filtro: 'grayscale(1) contrast(1.15) brightness(1.05)',
        ...capaTono(`background:linear-gradient(140deg,${c.resalte},${mezclar(c.resalte, c.trazo, .75)});mix-blend-mode:color;opacity:.92`)
    }),

    cine: () => ({
        filtro: 'contrast(1.12) saturate(1.1)',
        ...capaTono('background:linear-gradient(100deg,rgba(0,110,140,.5),rgba(255,130,40,.38));mix-blend-mode:soft-light')
    }),

    frio: () => ({
        filtro: 'saturate(.9) brightness(1.05)',
        ...capaTono('background:rgba(40,90,200,.38);mix-blend-mode:multiply')
    }),

    calido: () => ({
        filtro: 'sepia(.3)',
        ...capaTono('background:rgba(255,150,40,.3);mix-blend-mode:overlay')
    }),

    bn_acento: (c, _rng, foco) => {
        const fx = foco ? `${Math.round((foco.x / 1280) * 100)}%` : '72%';
        const fy = foco ? `${Math.round((foco.y / 720) * 100)}%` : '45%';
        return {
            filtro: 'grayscale(.9) contrast(1.2)',
            ...capaTono(`background:radial-gradient(circle at ${fx} ${fy},${rgba(c.resalte, .85)} 0%,rgba(0,0,0,0) 58%);mix-blend-mode:color`)
        };
    },

    luz_lateral: () => ({
        filtro: '',
        ...capaTono('background:radial-gradient(circle at 100% 0%,rgba(255,232,190,.8) 0%,rgba(255,200,120,.28) 35%,rgba(0,0,0,0) 65%);mix-blend-mode:screen')
    }),

    niebla: () => ({
        filtro: '',
        ...capaTono('background:linear-gradient(0deg,rgba(235,240,255,.4) 0%,rgba(235,240,255,.1) 38%,rgba(0,0,0,0) 62%)')
    }),

    alto_contraste: () => ({ filtro: 'contrast(1.35) saturate(1.25) brightness(.98)', css: '', html: '' })
};

// ---------------------------------------------------------------------
// ACENTOS: decoración extra. { css, html, encima }  (encima=false -> queda debajo del texto)
// ---------------------------------------------------------------------
const ACENTOS = {
    polvo: (c, rng) => {
        let html = '';
        for (let i = 0; i < 26; i++) {
            const x = Math.floor(rng() * 1280), y = Math.floor(rng() * 720), r = 2 + Math.floor(rng() * 5), o = (0.3 + rng() * 0.5).toFixed(2);
            html += `<div class="z" style="left:${x}px;top:${y}px;width:${r}px;height:${r}px;border-radius:50%;background:${c.resalte};opacity:${o};box-shadow:0 0 ${r * 4}px ${c.resalte}"></div>`;
        }
        return { css: '', html, encima: false };
    },

    rayos: (c, rng) => {
        const x = Math.round(55 + rng() * 40), y = Math.round(10 + rng() * 50), desde = Math.round(rng() * 360);
        const mascara = `radial-gradient(circle at ${x}% ${y}%,#000 0%,transparent 70%)`;
        return {
            css: `.ac-rayos{inset:0;background:repeating-conic-gradient(from ${desde}deg at ${x}% ${y}%,rgba(255,255,255,.11) 0 4deg,transparent 4deg 12deg);-webkit-mask-image:${mascara};mask-image:${mascara}}`,
            html: '<div class="z ac-rayos"></div>', encima: false
        };
    },

    destello: (c, rng) => {
        const x = 760 + Math.floor(rng() * 380), y = -60 + Math.floor(rng() * 200);
        return {
            css: `.ac-destello{left:${x}px;top:${y}px;width:520px;height:520px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.9) 0%,${rgba(c.resalte, .5)} 16%,rgba(0,0,0,0) 62%);mix-blend-mode:screen}`,
            html: '<div class="z ac-destello"></div>', encima: false
        };
    },

    bokeh: (c, rng) => {
        let html = '';
        for (let i = 0; i < 9; i++) {
            const x = Math.floor(rng() * 1180), y = Math.floor(rng() * 620), r = 40 + Math.floor(rng() * 90);
            const col = i % 2 ? c.resalte : c.color;
            html += `<div class="z" style="left:${x}px;top:${y}px;width:${r}px;height:${r}px;border-radius:50%;background:${rgba(col, .26)};filter:blur(5px);mix-blend-mode:screen"></div>`;
        }
        return { css: '', html, encima: false };
    },

    scanlines: () => ({
        css: '.ac-scan{inset:0;background:repeating-linear-gradient(0deg,rgba(0,0,0,.3) 0 2px,transparent 2px 5px);opacity:.55}',
        html: '<div class="z ac-scan"></div>', encima: false
    }),

    rasgado: (c, rng) => {
        const pts = ['0% 100%'];
        for (let i = 0; i <= 24; i++) pts.push(`${((i / 24) * 100).toFixed(1)}% ${(18 + rng() * 40).toFixed(1)}%`);
        pts.push('100% 100%');
        return {
            css: `.ac-rasgado{left:0;right:0;bottom:0;height:78px;background:#08080b;clip-path:polygon(${pts.join(',')})}`,
            html: '<div class="z ac-rasgado"></div>', encima: false
        };
    },

    rec: () => ({
        css: '.ac-rec{right:44px;top:34px;display:flex;align-items:center;gap:12px;color:#fff;font-size:34px;letter-spacing:5px;text-shadow:0 2px 8px #000}.ac-rec i{display:block;width:26px;height:26px;border-radius:50%;background:#ff2323;box-shadow:0 0 18px #ff2323}',
        html: '<div class="z ac-rec"><i></i>REC</div>', encima: true
    }),

    marco_fino: (c) => ({
        css: `.ac-marco{inset:20px;border:3px solid ${rgba(c.resalte, .85)}}`,
        html: '<div class="z ac-marco"></div>', encima: true
    }),

    esquinas: (c) => {
        const l = `60px;height:60px;border:0 solid ${c.resalte}`;
        return {
            css: `.ac-e{width:${l}}.ac-e1{left:26px;top:26px;border-top-width:6px;border-left-width:6px}.ac-e2{right:26px;top:26px;border-top-width:6px;border-right-width:6px}.ac-e3{left:26px;bottom:26px;border-bottom-width:6px;border-left-width:6px}.ac-e4{right:26px;bottom:26px;border-bottom-width:6px;border-right-width:6px}`,
            html: '<div class="z ac-e ac-e1"></div><div class="z ac-e ac-e2"></div><div class="z ac-e ac-e3"></div><div class="z ac-e ac-e4"></div>', encima: true
        };
    }
};

// Acentos que se estorban con ciertas plantillas
const ACENTO_CONFLICTO = {
    rec: ['sello', 'nivel', 'numero', 'circulo'],
    rayos: ['etereo'],
    polvo: ['etereo'],
    marco_fino: ['marco', 'cinema'],
    esquinas: ['marco', 'cinema'],
    rasgado: ['cinema', 'banda', 'marco']
};

// ---------------------------------------------------------------------
// ESTILOS DE ETIQUETA (la pastilla de arriba; solo plantillas con .badge simple)
// ---------------------------------------------------------------------
const ETIQUETAS = {
    pastilla: () => '',
    contorno: (c) => `.badge{background:transparent;color:${c.resalte};border-color:${c.resalte};border-radius:4px;box-shadow:none}`,
    negra: (c) => `.badge{background:#000;color:${c.resalte};border-color:${c.resalte}}`,
    blanca: (c) => `.badge{background:#fff;color:#111;border-color:${c.trazo}}`,
    redonda: () => '.badge{border-radius:999px;border-color:transparent}',
    subrayada: (c) => `.badge{background:transparent;border:none;border-bottom:6px solid ${c.resalte};border-radius:0;box-shadow:none;color:${c.color};padding:4px 4px;text-shadow:0 3px 10px rgba(0,0,0,.8)}`
};

// ---------------------------------------------------------------------
// ENSAMBLE: junta todas las capas de un ADN para una plantilla
// ---------------------------------------------------------------------
function construirCapas(adn, c, plantilla, foco = null) {
    const rng = crearRng(adn.semilla || 1);
    const trat = (TRATAMIENTOS[adn.tratamiento] || TRATAMIENTOS.natural)(c, rng, foco);
    const abajo = { css: '', html: '' }, arriba = { css: '', html: '' };
    for (const nombre of adn.acentos || []) {
        const f = ACENTOS[nombre];
        if (!f || (ACENTO_CONFLICTO[nombre] || []).includes(plantilla)) continue;
        const a = f(c, rng);
        const destino = a.encima ? arriba : abajo;
        destino.css += a.css;
        destino.html += a.html;
    }
    const efecto = COMPAT.efecto.has(plantilla) ? (EFECTOS[adn.efecto] || EFECTOS.contorno)(c) : '';
    const etiqueta = COMPAT.etiqueta.has(plantilla) ? (ETIQUETAS[adn.etiquetaEstilo] || ETIQUETAS.pastilla)(c) : '';
    let fuente = '';
    if (adn.fuente && FUENTES[adn.fuente] && COMPAT.fuente(plantilla)) {
        fuente = `.lienzo{font-family:'${FUENTES[adn.fuente].nombre}',${CONFIG.fuenteTitulo}}`;
    }
    return {
        trat, abajo, arriba,
        cssExtra: [fuente, efecto, etiqueta, trat.css, abajo.css, arriba.css].filter(Boolean).join('\n'),
        transform: `${adn.voltear ? 'scaleX(-1) ' : ''}scale(${adn.zoom || 1})`
    };
}

module.exports = { COMPAT, EFECTOS, TRATAMIENTOS, ACENTOS, ACENTO_CONFLICTO, ETIQUETAS, construirCapas };