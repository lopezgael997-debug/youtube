// =====================================================================
// MINIATURAS · ADN DE DISEÑO
// Cada miniatura recibe un "ADN": plantilla + paleta + tipografía + efecto del texto +
// tratamiento del fondo + acentos + etiqueta + zoom/espejo. Se elige entre miles de
// combinaciones respetando la personalidad del canal y buscando SIEMPRE la más distinta
// a las últimas miniaturas de ese canal (historial) y a las otras del mismo video.
// =====================================================================
const fs = require('fs');
const path = require('path');
const { DIR } = require('./config');
const { FUENTES, crearRng, hslAHex } = require('./miniatura_util');
const { COMPAT, ACENTO_CONFLICTO } = require('./miniatura_capas');

const ESTILO_BASE = { color: '#FFFFFF', resalte: '#FF2A2A', trazo: '#000000', brillo: 1.0, saturacion: 1.15, contraste: 1.15 };

const pal = (id, color, resalte, trazo, ex = {}) => ({ id, color, resalte, trazo, brillo: 1.0, saturacion: 1.15, contraste: 1.15, ...ex });

// Lado del encuadre para el que está pensada cada plantilla (el sujeto de la imagen debe quedar del lado contrario)
const LADO = {
    impacto_izq: 'izq', apilado: 'izq', dividida: 'izq', circulo: 'izq', pregunta: 'izq', nivel: 'izq', numero: 'izq', bloques: 'izq', sello: 'izq',
    cinema: 'centro', banda: 'centro', marco: 'centro', cabecera: 'centro', etereo: 'centro'
};

// ---------------------------------------------------------------------
// PERSONALIDAD DE CADA NICHO (pesos: más alto = sale más seguido)
// ---------------------------------------------------------------------
const PERSONALIDADES = {
    metafisica: {
        plantillas: { etereo: 3, marco: 3, circulo: 2, cabecera: 2, pregunta: 2, cinema: 2, numero: 2, apilado: 1, impacto_izq: 1 },
        paletas: [
            pal('amatista', '#F3E8FF', '#C084FC', '#1E0B36', { brillo: 1.05, saturacion: 1.1, contraste: 1.1 }),
            pal('aurora', '#E6FFFA', '#5EEAD4', '#062A2E', { brillo: 1.05, saturacion: 1.1, contraste: 1.1 }),
            pal('rosa_dorado', '#FFF1F2', '#FDA4AF', '#3B0A1F', { brillo: 1.05, saturacion: 1.1, contraste: 1.1 }),
            pal('oro_blanco', '#FFFFFF', '#FACC15', '#1A1205', { brillo: 1.05, saturacion: 1.1, contraste: 1.1 }),
            pal('azul_noche', '#EAF2FF', '#93C5FD', '#0B1230', { brillo: 1.05, saturacion: 1.1, contraste: 1.1 }),
            pal('ambar', '#FFF7E0', '#FB923C', '#2B1200', { brillo: 1.05, saturacion: 1.1, contraste: 1.1 })
        ],
        fuentes: { cinzel: 3, playfair: 2, cormorant: 2, abril: 1, anton: 1, bebas: 1, base: 1 },
        efectos: { brillo: 3, degradado: 3, contorno: 2, neon: 1, doble: 1 },
        tratamientos: { natural: 3, luz_lateral: 3, calido: 2, niebla: 2, duotono: 1, cine: 1 },
        acentos: { polvo: 3, bokeh: 3, destello: 2, rayos: 2, marco_fino: 1, esquinas: 1 },
        etiquetas: ['TU ALMA RECUERDA', 'VIDAS PASADAS', 'MENSAJE', 'EL ALMA SABE', 'DESPERTAR', 'SEÑALES', 'EL OTRO LADO'],
        huesPermitidos: [[255, 330], [35, 60], [165, 190]]
    },
    misterio: {
        plantillas: { sello: 3, apilado: 3, dividida: 2, pregunta: 2, impacto_izq: 2, banda: 2, bloques: 2, circulo: 2, numero: 2, cabecera: 1, cinema: 1, marco: 1 },
        paletas: [
            pal('amarillo_alerta', '#FFFFFF', '#FFD60A', '#000000', { saturacion: 1.2, contraste: 1.25 }),
            pal('verde_toxico', '#F0FFF4', '#4ADE80', '#021A0B', { saturacion: 1.2, contraste: 1.25 }),
            pal('naranja_peligro', '#FFFFFF', '#FB923C', '#1A0A00', { saturacion: 1.2, contraste: 1.25 }),
            pal('azul_helado', '#E0F2FE', '#38BDF8', '#00131F', { saturacion: 1.2, contraste: 1.25 }),
            pal('magenta_noir', '#FFFFFF', '#F472B6', '#1F0014', { saturacion: 1.2, contraste: 1.25 }),
            pal('rojo_sangre', '#FFF5F5', '#EF4444', '#140000', { saturacion: 1.2, contraste: 1.25 })
        ],
        fuentes: { anton: 3, bebas: 2, oswald: 2, elite: 2, teko: 1, staatliches: 1, base: 1 },
        efectos: { extruido: 3, contorno: 3, doble: 2, neon: 1, brillo: 1 },
        tratamientos: { bn_acento: 3, duotono: 2, cine: 2, frio: 2, alto_contraste: 2, natural: 1 },
        acentos: { scanlines: 3, rasgado: 3, rec: 2, esquinas: 2, marco_fino: 1, destello: 1, polvo: 1 },
        etiquetas: ['CASO SIN RESOLVER', 'DESCLASIFICADO', 'SIN EXPLICACIÓN', 'EXPEDIENTE', 'ÚLTIMA PISTA', 'SIN RESPUESTA', 'EVIDENCIA'],
        huesPermitidos: [[0, 20], [340, 360], [40, 60], [190, 210]]
    },
    historia: {
        plantillas: { sello: 3, marco: 3, cinema: 2, dividida: 2, impacto_izq: 2, cabecera: 2, numero: 2, apilado: 1, bloques: 1, circulo: 1 },
        paletas: [
            pal('pergamino', '#FFF3D1', '#D97706', '#1C1003', { saturacion: 1.1 }),
            pal('rojo_imperial', '#FFFFFF', '#DC2626', '#120000', { saturacion: 1.2, contraste: 1.2 }),
            pal('oro_viejo', '#FDE68A', '#FFFFFF', '#2A1A00', { saturacion: 1.1 }),
            pal('verde_militar', '#F7FEE7', '#A3E635', '#0C1A00', { saturacion: 1.15 }),
            pal('azul_acero', '#E2E8F0', '#60A5FA', '#020617', { saturacion: 1.1 })
        ],
        fuentes: { playfair: 2, abril: 2, cinzel: 2, anton: 2, oswald: 1, elite: 1, base: 1 },
        efectos: { contorno: 3, extruido: 2, doble: 2, degradado: 1 },
        tratamientos: { calido: 3, duotono: 2, bn_acento: 2, natural: 2, luz_lateral: 1, cine: 1 },
        acentos: { rasgado: 3, marco_fino: 3, esquinas: 2, polvo: 2, destello: 1 },
        etiquetas: ['EXPEDIENTE ABIERTO', 'HISTORIA OCULTA', 'ARCHIVO SECRETO', 'NO TE LO CONTARON', 'DOCUMENTO', 'OLVIDADO', 'CASO HISTÓRICO'],
        huesPermitidos: [[20, 55], [0, 15], [200, 225]]
    },
    iceberg: {
        plantillas: { nivel: 3, numero: 3, impacto_izq: 2, banda: 2, pregunta: 2, apilado: 2, circulo: 2, bloques: 2, cabecera: 2, cinema: 1, dividida: 1 },
        paletas: [
            pal('hielo_rojo', '#E0FBFF', '#FF3B3B', '#00121A', { saturacion: 1.3, contraste: 1.2 }),
            pal('verde_abismo', '#D1FAE5', '#34D399', '#00110A', { saturacion: 1.3, contraste: 1.2 }),
            pal('violeta_profundo', '#EDE9FE', '#A78BFA', '#0A0320', { saturacion: 1.3, contraste: 1.2 }),
            pal('amarillo_sonar', '#FFFBEB', '#FACC15', '#001018', { saturacion: 1.3, contraste: 1.2 }),
            pal('blanco_puro', '#FFFFFF', '#38BDF8', '#00101A', { saturacion: 1.3, contraste: 1.2 })
        ],
        fuentes: { bebas: 3, oswald: 2, anton: 2, teko: 2, staatliches: 2, base: 1 },
        efectos: { brillo: 3, neon: 2, degradado: 2, contorno: 2, extruido: 1 },
        tratamientos: { frio: 3, cine: 2, duotono: 2, niebla: 2, natural: 2, luz_lateral: 1, alto_contraste: 1 },
        acentos: { bokeh: 2, polvo: 2, rayos: 2, esquinas: 2, scanlines: 1, destello: 1, marco_fino: 1 },
        etiquetas: ['LO QUE NADIE DICE', 'NIVEL PROHIBIDO', 'EL FONDO', 'SECRETO', 'MÁS PROFUNDO', 'SIGUE BAJANDO', 'EL ABISMO'],
        huesPermitidos: [[175, 215], [255, 280], [145, 165]]
    },
    ciencia: {
        plantillas: { circulo: 3, numero: 3, dividida: 2, banda: 2, impacto_izq: 2, bloques: 2, apilado: 2, cabecera: 2, pregunta: 1, marco: 1 },
        paletas: [
            pal('electrico', '#FFFFFF', '#22D3EE', '#001018'),
            pal('violeta_lab', '#F5F3FF', '#8B5CF6', '#0A0320'),
            pal('verde_neon', '#F0FFF4', '#4ADE80', '#021A0B'),
            pal('naranja_exp', '#FFFFFF', '#FB923C', '#1A0A00')
        ],
        fuentes: { oswald: 2, teko: 2, bebas: 2, anton: 1, staatliches: 1, base: 1 },
        efectos: { degradado: 2, neon: 2, contorno: 2, brillo: 2 },
        tratamientos: { natural: 2, cine: 2, frio: 2, luz_lateral: 2, alto_contraste: 1 },
        acentos: { bokeh: 2, esquinas: 2, scanlines: 2, destello: 2, rayos: 1 },
        etiquetas: ['DESCUBRIMIENTO', 'LA CIENCIA LO CONFIRMA', 'SIN EXPLICAR', 'EXPERIMENTO'],
        huesPermitidos: [[170, 220], [260, 300], [90, 150]]
    },
    finanzas: {
        plantillas: { banda: 3, bloques: 3, numero: 3, dividida: 2, impacto_izq: 2, cabecera: 2, circulo: 1, apilado: 1 },
        paletas: [
            pal('verde_billete', '#FFFFFF', '#34D399', '#02130B'),
            pal('azul_banco', '#FFFFFF', '#60A5FA', '#020617'),
            pal('dorado', '#FFFBEB', '#FBBF24', '#1A1000'),
            pal('rojo_alerta', '#FFFFFF', '#F87171', '#140000')
        ],
        fuentes: { oswald: 2, anton: 2, bebas: 2, staatliches: 1, playfair: 1, base: 1 },
        efectos: { contorno: 3, extruido: 2, doble: 2, degradado: 1 },
        tratamientos: { natural: 3, luz_lateral: 2, alto_contraste: 2, cine: 1 },
        acentos: { esquinas: 2, marco_fino: 2, destello: 1, bokeh: 1 },
        etiquetas: ['LO QUE NO TE DICEN', 'EVÍTALO', 'ENTIÉNDELO', 'PASO A PASO'],
        huesPermitidos: [[100, 160], [200, 225], [35, 55]]
    }
};

const ESTILOS_ETIQUETA = [['pastilla', 3], ['contorno', 2], ['negra', 2], ['blanca', 1], ['redonda', 2], ['subrayada', 2]];

// ---------------------------------------------------------------------
// ANÁLISIS DE LA IMAGEN (se ejecuta dentro del navegador: no usa nada de afuera)
// Devuelve dónde está el sujeto, el tono dominante y qué tan luminosa/saturada es.
// ---------------------------------------------------------------------
async function analizarImagen(uri) {
    const img = new Image();
    img.src = uri;
    await img.decode();
    const W = 96, H = 54;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;
    const L = new Float32Array(W * H), S = new Float32Array(W * H), bins = new Float32Array(12);
    let lumSum = 0, satSum = 0;
    for (let i = 0; i < W * H; i++) {
        const r = px[i * 4] / 255, g = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const s = mx === 0 ? 0 : d / mx;
        L[i] = l; S[i] = s; lumSum += l; satSum += s;
        if (d > 0.08) {
            let h;
            if (mx === r) h = ((g - b) / d + 6) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
            bins[Math.min(11, Math.floor(h * 2))] += s * mx;
        }
    }
    const E = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
            const i = y * W + x, gx = L[i + 1] - L[i - 1], gy = L[i + W] - L[i - W];
            E[i] = Math.sqrt(gx * gx + gy * gy) + 0.25 * S[i] * L[i];
        }
    }
    const umbral = Array.from(E).sort((a, b) => a - b)[Math.floor(E.length * 0.75)];
    let sx = 0, sy = 0, sw = 0;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const e = E[y * W + x];
            if (e >= umbral && e > 0) { sx += x * e; sy += y * e; sw += e; }
        }
    }
    const cx = sw ? sx / sw / W : 0.5, cy = sw ? sy / sw / H : 0.5;
    let mejor = 0;
    for (let k = 1; k < 12; k++) if (bins[k] > bins[mejor]) mejor = k;
    return {
        lum: lumSum / (W * H), sat: satSum / (W * H), hue: mejor * 30 + 15, cx, cy,
        zona: cx < 0.42 ? 'izq' : cx > 0.58 ? 'der' : 'centro'
    };
}

// ---------------------------------------------------------------------
// FUENTES DISPONIBLES (las que realmente existen como archivo en /fuentes)
// ---------------------------------------------------------------------
function fuentesDisponibles() {
    const ok = new Set(['base']);
    try {
        for (const f of fs.readdirSync(DIR.fuentes)) {
            if (!/\.(ttf|otf|woff2?)$/i.test(f)) continue;
            const n = f.toLowerCase().replace(/[^a-z0-9]/g, '');
            for (const [id, def] of Object.entries(FUENTES)) if (def.patron.test(n)) ok.add(id);
        }
    } catch { /* carpeta inexistente */ }
    return ok;
}

// ---------------------------------------------------------------------
// HISTORIAL (qué diseños llevan las últimas miniaturas de cada canal)
// ---------------------------------------------------------------------
const archivoHistorial = () => path.join(DIR.cache, 'miniaturas_historial.json');

function leerHistorial(canalId) {
    try {
        const h = JSON.parse(fs.readFileSync(archivoHistorial(), 'utf-8'));
        return Array.isArray(h[canalId]) ? h[canalId] : [];
    } catch { return []; }
}

function guardarHistorial(canalId, firmas) {
    let h = {};
    try { h = JSON.parse(fs.readFileSync(archivoHistorial(), 'utf-8')); } catch { /* primera vez */ }
    h[canalId] = [...firmas.slice().reverse(), ...(h[canalId] || [])].slice(0, 40);
    fs.mkdirSync(path.dirname(archivoHistorial()), { recursive: true });
    fs.writeFileSync(archivoHistorial(), JSON.stringify(h, null, 1), 'utf-8');
}

// ---------------------------------------------------------------------
// DIVERSIDAD: distancia entre dos diseños (más alta = más distintos)
// ---------------------------------------------------------------------
function distancia(a, b) {
    let d = 0;
    if (a.plantilla !== b.plantilla) d += 4;
    if (a.paleta !== b.paleta) d += 3;
    if (a.fuente !== b.fuente) d += 2;
    if (a.efecto !== b.efecto) d += 2;
    if (a.tratamiento !== b.tratamiento) d += 2;
    if (a.etiquetaEstilo !== b.etiquetaEstilo) d += 1;
    const A = new Set(a.acentos), B = new Set(b.acentos);
    d += Math.min(2, [...A].filter(x => !B.has(x)).length + [...B].filter(x => !A.has(x)).length);
    if (Math.abs((a.zoom || 1) - (b.zoom || 1)) > 0.05) d += 0.5;
    return d;
}

function puntuar(firma, previos, historial) {
    let min = Infinity;
    for (const p of previos) min = Math.min(min, distancia(firma, p));
    // lo más reciente del canal pesa más: las entradas viejas se perdonan poco a poco
    historial.forEach((h, i) => { min = Math.min(min, distancia(firma, h) * (1 + i / 18)); });
    return min === Infinity ? 20 : min;
}

// ---------------------------------------------------------------------
// PALETAS
// ---------------------------------------------------------------------
function distanciaHue(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

function ajustarAHuesPermitidos(h, rangos) {
    h = ((h % 360) + 360) % 360;
    let mejor = h, mejorD = Infinity;
    for (const [min, max] of rangos) {
        if (h >= min && h <= max) return h;
        for (const borde of [min, max]) {
            const d = distanciaHue(h, borde);
            if (d < mejorD) { mejorD = d; mejor = borde; }
        }
    }
    return mejor;
}

// Paleta sacada de la propia imagen: el resalte es el tono que contrasta con el dominante,
// siempre dentro de los tonos que le quedan bien al nicho (el canal no pierde identidad).
function paletaAdaptativa(analisis, P, rng) {
    const hue = analisis.sat < 0.12 ? P.huesPermitidos[0][0] : analisis.hue;
    const objetivo = rng() < 0.6 ? hue + 180 : hue + 35;
    const hr = ajustarAHuesPermitidos(objetivo, P.huesPermitidos);
    return pal('adaptativa', hslAHex(hue, 45, 95), hslAHex(hr, 92, 58), hslAHex(hue, 55, 6), { saturacion: 1.15, contraste: 1.15 });
}

// ---------------------------------------------------------------------
// ELEGIR EL ADN
// ---------------------------------------------------------------------
function ajusteLado(plantilla, analisis) {
    if (!analisis || analisis.zona !== 'centro') return 1;
    return LADO[plantilla] === 'centro' ? 3 : 0.25;
}

function elegirAcentos(P, plantilla, rng) {
    const n = rng.ponderado([[0, 3], [1, 5], [2, 2]]);
    const elegidos = [];
    for (let k = 0; k < n; k++) {
        const pool = Object.entries(P.acentos).filter(([a]) => !elegidos.includes(a) && !(ACENTO_CONFLICTO[a] || []).includes(plantilla));
        if (!pool.length) break;
        elegidos.push(rng.ponderado(pool));
    }
    return elegidos.sort();
}

/**
 * Elige el ADN de UNA miniatura.
 *  canal      objeto de canales.json
 *  gancho     texto de la miniatura
 *  previos    firmas de las otras miniaturas de este mismo video
 *  historial  firmas de las últimas miniaturas del canal (leerHistorial)
 *  analisis   resultado de analizarImagen (o null si no hay imagen)
 *  semilla    número (misma semilla + mismos datos = mismo resultado)
 *  forzarPlantilla  nombre de plantilla (opcional)
 */
function elegirADN({ canal, gancho, previos = [], historial = [], analisis = null, fuentesOk, semilla, forzarPlantilla, intentos = 90 }) {
    const nicho = PERSONALIDADES[canal.nicho] ? canal.nicho : 'misterio';
    const P = PERSONALIDADES[nicho];
    const cfg = canal.miniatura || {};
    const rng = crearRng(semilla);
    const ok = fuentesOk || fuentesDisponibles();
    const tieneNumero = /\d/.test(gancho || '');
    const favoritas = new Set(cfg.plantillas || []);   // en canales.json "plantillas" ahora significa "favoritas", ya no es un límite
    const marca = { id: 'marca', ...ESTILO_BASE, ...(cfg.estilo || {}) };
    const marcaInv = { ...marca, id: 'marca_inv', color: marca.resalte, resalte: marca.color };

    const pesosPlantilla = Object.entries(P.plantillas)
        .filter(([k]) => k !== 'numero' || tieneNumero)
        .map(([k, w]) => [k, w * (favoritas.has(k) ? 1.5 : 1) * ajusteLado(k, analisis)]);
    const pesosFuente = Object.entries(P.fuentes).filter(([f]) => ok.has(f));
    const pesosPaleta = [['marca', 4], ['marca_inv', 0.7], ...P.paletas.map(p => [p.id, 1.2])];
    if (analisis) pesosPaleta.push(['adaptativa', 2.2]);
    const pesosEtiqueta = [...new Set([...(cfg.etiquetas || []), ...P.etiquetas])];
    const prohibidas = new Set(previos.map(p => p.plantilla));

    let mejor = null, mejorPuntaje = -Infinity;
    for (let n = 0; n < intentos; n++) {
        const plantilla = forzarPlantilla && LADO[forzarPlantilla] ? forzarPlantilla : rng.ponderado(pesosPlantilla);
        const paletaId = rng.ponderado(pesosPaleta);
        const paleta = paletaId === 'marca' ? marca
            : paletaId === 'marca_inv' ? marcaInv
                : paletaId === 'adaptativa' ? paletaAdaptativa(analisis, P, rng)
                    : P.paletas.find(p => p.id === paletaId);
        const fuente = pesosFuente.length ? rng.ponderado(pesosFuente) : 'base';
        const efecto = COMPAT.efecto.has(plantilla) ? rng.ponderado(Object.entries(P.efectos)) : 'contorno';
        const tratamiento = rng.ponderado(Object.entries(P.tratamientos));
        const etiquetaEstilo = COMPAT.etiqueta.has(plantilla) ? rng.ponderado(ESTILOS_ETIQUETA) : 'pastilla';
        const acentos = elegirAcentos(P, plantilla, rng);
        const zoom = rng.ponderado([[1, 5], [1.08, 3], [1.16, 2]]);
        const etiqueta = rng() < 0.15 ? '' : rng.pick(pesosEtiqueta);
        const voltear = !!(analisis && analisis.zona === 'izq' && LADO[plantilla] === 'izq');

        const firma = { plantilla, paleta: paleta.id, fuente, efecto, tratamiento, etiquetaEstilo, acentos, zoom };
        let puntaje = puntuar(firma, previos, historial) + rng() * 0.5;
        if (prohibidas.has(plantilla) && !forzarPlantilla) puntaje -= 6;   // dentro de un mismo video no se repite plantilla
        if (puntaje > mejorPuntaje) {
            mejorPuntaje = puntaje;
            mejor = { plantilla, paleta, fuente, efecto, tratamiento, etiquetaEstilo, acentos, zoom, etiqueta, voltear, firma };
        }
    }
    mejor.semilla = Math.floor(rng() * 4294967295);
    mejor.diversidad = Number(mejorPuntaje.toFixed(1));
    return mejor;
}

module.exports = {
    ESTILO_BASE, LADO, PERSONALIDADES, analizarImagen, fuentesDisponibles,
    leerHistorial, guardarHistorial, distancia, elegirADN
};
