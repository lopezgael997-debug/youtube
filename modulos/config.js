require('dotenv').config();
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const RAIZ = path.join(__dirname, '..');

// =====================================================================
// CONFIGURACIÓN
// =====================================================================
const CFG = {
    urlPanel: (process.env.URL_PANEL || 'https://panel-youtube-familia.onrender.com').replace(/\/$/, ''),
    claveWorker: process.env.CLAVE_WORKER || '',

    // Capítulos (la narración final)
    modelo: process.env.MODELO_CLAUDE || 'claude-sonnet-5-5',
    // Plan y shorts
    modeloEconomico: process.env.MODELO_ECONOMICO || process.env.MODELO_CLAUDE || 'claude-sonnet-5-5',
    // Nivel de "esfuerzo" (cuánto razona/escribe): low | medium | high
    efforts: {
        capitulos: process.env.EFFORT_CAPITULOS || 'medium',
        plan: process.env.EFFORT_PLAN || 'low'
    },

    telegram: {
        token: process.env.TELEGRAM_BOT_TOKEN || '',
        chatId: process.env.TELEGRAM_CHAT_ID || ''
    },
    driveUrl: process.env.DRIVE_CARPETA_URL || '',

    intervaloMin: Number(process.env.INTERVALO_MIN || 5),
    duracionMin: Number(process.env.DURACION_MIN || 10),
    shortsPorVideo: Number(process.env.SHORTS_POR_VIDEO || 3),
    // Palabras por minuto de la voz. Se autocalibra con tus videos reales (cache/calibracion.json)
    palabrasPorMinuto: Number(process.env.WPM || 150),
    minutosPorCapitulo: 3,
    // Palabras por escena: cada escena = 1 imagen. Más cortas = más imágenes distintas (más fieles a la narración)
    escenaMin: Number(process.env.ESCENA_PALABRAS_MIN || 20),
    escenaMax: Number(process.env.ESCENA_PALABRAS_MAX || 35),
    umbralCapituloCorto: 0.8, // si un capítulo trae menos del 80% de las palabras pedidas, se amplía
    maxCharsTranscripcion: 60000,

    // Voz: AllTalk TTS (instalado con Pinokio). Debe estar ENCENDIDO mientras corre el worker.
    alltalk: {
        url: (process.env.ALLTALK_URL || 'http://127.0.0.1:7851').replace(/\/$/, ''),
        idioma: process.env.ALLTALK_IDIOMA || 'es',
        concurrencia: Number(process.env.ALLTALK_CONCURRENCIA || 1)
    },

    // Miniaturas (se generan junto con el video; si fallan, el video sigue)
    miniatura: {
        activa: process.env.MINIATURAS !== '0',
        variantes: Number(process.env.MINIATURAS_VARIANTES || 3)
    },

    fps: 30,
    pausaEscena: 0.35,
    concurrenciaRender: Number(process.env.CONCURRENCIA_RENDER || 3),

    imagen: {
        proveedor: (process.env.IMAGEN_PROVEEDOR || 'comfyui').toLowerCase(),
        comfyUrl: process.env.COMFY_URL || 'http://127.0.0.1:8188',
        forgeUrl: process.env.FORGE_URL || 'http://127.0.0.1:7860',
        checkpoint: process.env.COMFY_CHECKPOINT || '',
        pasos: Number(process.env.IMAGEN_PASOS || 30),
        cfg: Number(process.env.IMAGEN_CFG || 6.5),
        negativo: 'text, letters, words, watermark, logo, signature, blurry, low quality, deformed, extra fingers, bad anatomy, extra limbs, cropped, modern clothing, cartoon'
    }
};

const FORMATOS = {
    horizontal: {
        ancho: 1920, alto: 1080, imgAncho: 1344, imgAlto: 768,
        fuente: 62, outline: 4, margenH: 120, margenV: 70, palabrasSub: 6, colorSub: '&H00FFFFFF'
    },
    vertical: {
        ancho: 1080, alto: 1920, imgAncho: 768, imgAlto: 1344,
        fuente: 84, outline: 5, margenH: 80, margenV: 560, palabrasSub: 4, colorSub: '&H0000FFFF'
    }
};

const DIR = {
    cache: path.join(RAIZ, 'cache'),
    transcripciones: path.join(RAIZ, 'cache', 'transcripciones'),
    guiones: path.join(RAIZ, 'cache', 'guiones'),
    audio: path.join(RAIZ, 'cache', 'audio'),
    imagenes: path.join(RAIZ, 'cache', 'imagenes'),
    trabajo: path.join(RAIZ, 'trabajo'),
    salida: process.env.SALIDA_DIR || path.join(RAIZ, 'salida'),
    musica: path.join(RAIZ, 'musica'),
    fuentes: path.join(RAIZ, 'fuentes')
};

// Nombres de archivo .wav que existen en la carpeta "voices" de AllTalk.
// Si un nicho no tiene su propia voz, usa VOZ_DEFAULT (cámbiala en .env con VOZ_DEFAULT=mi_voz.wav).
const VOZ_DEFAULT = process.env.VOZ_DEFAULT || 'voz_misterio.wav';

const NICHOS = {
    misterio: {
        audiencia: 'personas mayores de 50 años de habla hispana, apasionadas por los misterios históricos, la arqueología prohibida y los enigmas sin resolver',
        tono: 'misterio, intriga y respeto, similar a los documentales clásicos',
        voz: process.env.VOZ_MISTERIO || VOZ_DEFAULT,
        estilo: 'cinematic dramatic lighting, moody atmosphere, oil painting style, highly detailed, dark tones',
        estructura: `Estructura de "caso misterioso" (cronológica o detectivesca). Cuenta el misterio como una investigación:
- Apertura: el hecho inexplicable, con un gancho que genere preguntas.
- Desarrollo: los hechos en orden, las pistas, los testigos y los documentos, uno por uno.
- Giro: el dato que complica o cambia todo lo anterior.
- Teorías: las explicaciones posibles (la oficial y las alternativas), cada una con sus pruebas y sus puntos débiles.
- Cierre: lo que sigue sin resolverse y una pregunta que deje al público pensando.
Reparte estas partes a lo largo de los capítulos, en ese orden. No uses niveles ni estructura de iceberg.`,
    },
    historia: {
        audiencia: 'adultos de habla hispana interesados en historia universal y grandes personajes',
        tono: 'narrativo, riguroso y apasionante, como un buen documental histórico',
        voz: process.env.VOZ_HISTORIA || VOZ_DEFAULT,
        estilo: 'epic historical painting, realistic, warm cinematic lighting, highly detailed, museum quality',
        estructura: `Estructura de relato histórico narrativo, en orden cronológico claro: contexto de la época → personajes y motivaciones → el momento decisivo → consecuencias → legado. Cuenta los hechos como una historia con personas, no como una lista de fechas. No uses niveles ni estructura de iceberg.`,
    },
    ciencia: {
        audiencia: 'público curioso de habla hispana que disfruta la divulgación científica',
        tono: 'claro, entusiasta y sorprendente, sin tecnicismos innecesarios',
        voz: process.env.VOZ_CIENCIA || VOZ_DEFAULT,
        estilo: 'clean cinematic illustration, vivid colors, dramatic lighting, highly detailed, sharp focus',
        estructura: `Estructura de divulgación científica: parte de una pregunta o paradoja que intrigue → explica en capas, de lo simple a lo complejo, con analogías cotidianas → incluye un dato que sorprenda → termina con lo que significa para la vida real o con lo que aún falta por descubrir. No uses niveles ni estructura de iceberg.`,
    },

    // "estructura" se aplica al plan y a cada capítulo; "reglas" se aplica a TODAS las llamadas de ese canal
    iceberg: {
        audiencia: 'jóvenes y adultos de habla hispana a quienes les fascinan los videos de "iceberg": historias, casos y datos del mundo ordenados desde lo más conocido hasta lo más oscuro y desconocido',
        tono: 'inmersivo, curioso y cada vez más inquietante a medida que se desciende, siempre riguroso',
        voz: process.env.VOZ_ICEBERG || VOZ_DEFAULT,
        estilo: 'cinematic dramatic lighting, deep blue and teal color palette, volumetric depth, highly detailed',
        estructura: `Es un video de "iceberg" que desciende por niveles. Cada capítulo es UN NIVEL del iceberg (puede incluir 2 o 3 casos o historias dentro del nivel):
- Nivel 1, "La superficie": lo que casi todos conocen.
- Los niveles intermedios: datos y casos cada vez menos conocidos.
- El último nivel, "Las profundidades": lo más oscuro, extraño o desconocido, pero REAL y documentado.
Al empezar cada capítulo, anuncia el nivel con una frase corta y atmosférica (por ejemplo: "Bajamos al nivel 3...").
En los prompt_imagen, la profundidad solo cambia la luz y el color (luminoso arriba, cada vez más oscuro y frío abajo); el CONTENIDO de cada imagen es lo que dice su escena, no un iceberg ni el mar.`,
        reglas: `- Incluye solo casos reales y verificables. En las profundidades es tentador inventar: no lo hagas. Si algo no está confirmado, dilo ("se cree que", "no hay pruebas concluyentes").
- Trata los temas oscuros con respeto y sin violencia gráfica ni detalles morbosos.`
    },
    finanzas: {
        audiencia: 'adultos de habla hispana que quieren entender mejor su dinero: ahorro, deudas, presupuesto, inversión básica y economía cotidiana',
        tono: 'claro, tranquilo, cercano y práctico, sin tecnicismos ni promesas de enriquecimiento rápido',
        voz: process.env.VOZ_FINANZAS || VOZ_DEFAULT,
        estilo: 'clean modern editorial illustration, soft natural light, warm neutral tones, no readable text or numbers, highly detailed',
        estructura: `Estructura práctica y educativa, en tono de conversación tranquila: una situación cotidiana que el público reconoce → el concepto explicado con palabras simples → un ejemplo con números ilustrativos (dichos como ejemplo) → errores comunes → opciones y cosas a considerar (sin recomendar nada concreto) → cierre con una idea clave. Nada de relatos bélicos, misterios ni niveles de iceberg.`,
        reglas: `- Es contenido EDUCATIVO: explica conceptos y opciones, nunca des recomendaciones personalizadas de inversión ni digas "compra" o "vende" algo concreto.
- No prometas ni insinúes ganancias seguras, rendimientos garantizados ni formas de hacerse rico rápido. Menciona siempre los riesgos.
- Usa cifras solo si vienen del material y preséntalas como ejemplos o aproximaciones; no inventes porcentajes ni estadísticas.
- Solo en el cierre del video (último capítulo) incluye una frase breve como: "Este video es solo informativo y no constituye asesoría financiera."`
    },
    metafisica: {
        audiencia: 'adultos de habla hispana curiosos por la espiritualidad, la conciencia, la reencarnación y las vidas pasadas',
        tono: 'sereno, contemplativo y respetuoso; invita a reflexionar sin imponer creencias',
        voz: process.env.VOZ_METAFISICA || VOZ_DEFAULT,
        estilo: 'ethereal cinematic lighting, soft glowing light, gentle mist, serene atmosphere, golden and violet tones, highly detailed',
        estructura: `Estructura contemplativa y descriptiva. NO es una historia lineal ni un iceberg: cada capítulo explora una faceta del tema (qué dice la tradición, cómo se describe la experiencia, relatos y casos documentados con la mirada escéptica, qué invita a reflexionar), con lenguaje sensorial y pausado que invite a la introspección. Alterna la descripción de las ideas con preguntas reflexivas al público. Cierra con una reflexión serena, no con un giro de suspenso. No uses niveles de iceberg ni relatos históricos bélicos.`,
        reglas: `- Presenta las vidas pasadas, la reencarnación y la metafísica como CREENCIAS, tradiciones, relatos o experiencias de personas, NUNCA como hechos comprobados. Usa expresiones como "según la tradición...", "quienes lo creen...", "algunos relatos cuentan...".
- Cuando existan estudios o casos documentados, preséntalos con su contexto e incluye brevemente la postura escéptica o científica.
- No hagas promesas de sanación ni afirmaciones médicas o psicológicas; no sugieras dejar tratamientos ni sustituir a médicos o terapeutas. No promociones terapias, cursos ni productos.
- Respeta todas las creencias, sin ridiculizar ni imponer.
- Solo en el cierre del video (último capítulo) incluye una frase breve como: "Este contenido es de carácter reflexivo y no sustituye la atención médica o psicológica."`
    }
};

function cargarCanales() {
    let lista;
    try {
        lista = JSON.parse(fsSync.readFileSync(path.join(RAIZ, 'canales.json'), 'utf-8'));
    } catch (e) {
        throw new Error(`No se pudo leer canales.json: ${e.message}`);
    }
    for (const c of lista) {
        if (!c.id || !NICHOS[c.nicho]) {
            throw new Error(`Canal inválido en canales.json: ${JSON.stringify(c)}. Nichos disponibles: ${Object.keys(NICHOS).join(', ')}`);
        }
    }
    return lista;
}

const CANALES = cargarCanales();

const CLIENT_ID = crypto.randomUUID();

module.exports = { CFG, FORMATOS, DIR, VOZ_DEFAULT, NICHOS, cargarCanales, CANALES, CLIENT_ID, RAIZ };
