// =====================================================================
// MINIATURAS · UTILIDADES COMPARTIDAS
// Color, azar con semilla (misma semilla = mismo resultado) y catálogo de fuentes.
// Lo usan miniatura_adn.js, miniatura_capas.js y miniatura_plantillas.js
// =====================================================================
const crypto = require('crypto');

const CONFIG = {
    fuenteTitulo: "'Anton','Bebas Neue','Oswald',Impact,'Arial Narrow','Liberation Sans Narrow',sans-serif",
    fuenteElegante: "'Cinzel','Playfair Display','Cormorant Garamond',Georgia,'Times New Roman',serif"
};

const ANCHO = 1280, ALTO = 720;

// Fuentes que el sistema aprovecha si existen como archivo en /fuentes (ver fuentes/LEEME.txt).
// "nombre" es el nombre de la familia; "patron" reconoce el nombre del archivo ya normalizado.
const FUENTES = {
    anton: { nombre: 'Anton', patron: /^anton(?!io)/ },
    bebas: { nombre: 'Bebas Neue', patron: /^bebasneue/ },
    oswald: { nombre: 'Oswald', patron: /^oswald/ },
    teko: { nombre: 'Teko', patron: /^teko/ },
    staatliches: { nombre: 'Staatliches', patron: /^staatliches/ },
    elite: { nombre: 'Special Elite', patron: /^specialelite/ },
    cinzel: { nombre: 'Cinzel', patron: /^cinzel/ },
    playfair: { nombre: 'Playfair Display', patron: /^playfairdisplay/ },
    abril: { nombre: 'Abril Fatface', patron: /^abrilfatface/ },
    cormorant: { nombre: 'Cormorant Garamond', patron: /^cormorantgaramond/ }
};

const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Texto -> número de 32 bits (estable)
const semillaDe = (t) => parseInt(crypto.createHash('md5').update(String(t)).digest('hex').slice(0, 8), 16) >>> 0;
const numeroDeTexto = semillaDe;

// Generador pseudoaleatorio con semilla (mulberry32) y ayudas para elegir con pesos
function crearRng(semilla) {
    let a = semilla >>> 0;
    const rng = () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.entre = (min, max) => min + rng() * (max - min);
    rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
    // pares: [[valor, peso], ...]
    rng.ponderado = (pares) => {
        const lista = pares.filter(p => p[1] > 0);
        if (!lista.length) return pares[0][0];
        let r = rng() * lista.reduce((s, p) => s + p[1], 0);
        for (const [v, w] of lista) { r -= w; if (r <= 0) return v; }
        return lista[lista.length - 1][0];
    };
    return rng;
}

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

// Mezcla dos colores: t=0 -> a, t=1 -> b
function mezclar(a, b, t) {
    const A = hexARgb(a), B = hexARgb(b);
    const m = (x, y) => Math.round(x + (y - x) * t);
    return '#' + [m(A.r, B.r), m(A.g, B.g), m(A.b, B.b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

function hslAHex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const hx = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
    return `#${hx(f(0))}${hx(f(8))}${hx(f(4))}`;
}

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

module.exports = {
    CONFIG, ANCHO, ALTO, FUENTES, esc, semillaDe, numeroDeTexto, crearRng,
    hexARgb, rgba, luminancia, textoSobre, oscuro, mezclar, hslAHex, contorno, sombraTexto
};
