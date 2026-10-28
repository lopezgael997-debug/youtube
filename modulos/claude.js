require('./config'); // carga el .env antes de leer variables de entorno
const fs = require('fs').promises;
const Anthropic = require('@anthropic-ai/sdk');
const { existe, extraerJSON } = require('./utilidades');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Tarifas publicadas (USD por millón de tokens). Son estimaciones: verifica en claude.com/pricing
const PRECIOS = {
    'haiku-5-5': { entrada: 0.10, salida: 0.50, cacheLeida: 0.01, cacheEscrita: 0.125 },
    'sonnet-5-5': { entrada: 2.00, salida: 10.00, cacheLeida: 0.10, cacheEscrita: 2.50 },
    'opus-5-5': { entrada: 4.00, salida: 20.00, cacheLeida: 0.20, cacheEscrita: 5.00 }
};

// Contador de tokens y costo del proyecto en curso
const USO = { entrada: 0, cacheLeida: 0, cacheEscrita: 0, salida: 0, costo: 0, sinTarifa: false };

function reiniciarUso() {
    USO.entrada = 0; USO.cacheLeida = 0; USO.cacheEscrita = 0; USO.salida = 0; USO.costo = 0; USO.sinTarifa = false;
}

// =====================================================================
// AGENTE GUIONISTA: plan + capítulos + shorts (todo con caché)
// =====================================================================
function promptSistema(nicho) {
    return `Eres un guionista experto en YouTube. Tu audiencia son ${nicho.audiencia}.
Escribes en español neutro con un tono de ${nicho.tono}.
${nicho.enfoque ? 'Enfoque específico de este canal: ' + nicho.enfoque + '\n' : ''}${nicho.reglas ? '\nReglas específicas de este canal (tienen prioridad):\n' + nicho.reglas + '\n' : ''}
Reglas permanentes de contenido:
- El material de referencia solo aporta el TEMA y los datos. La forma de contarlo (estructura, tono y enfoque) la define ESTE canal: no copies la organización del video original.
- Reescribe con tus propias palabras; nunca copies frases del material original.
- Elimina promociones, saludos y "paja" del youtuber original.
- No inventes datos, fechas, cifras ni citas. Si el material no alcanza, completa con contexto histórico o científico ampliamente aceptado y presenta lo incierto como hipótesis ("según algunas teorías...").
- La narración es SOLO texto para decir en voz alta: sin títulos, asteriscos ni acotaciones.
- Respeta la longitud pedida: es mejor pasarte un poco que quedarte corto.

Reglas de retención (que la gente no se vaya):
- Frases cortas y ritmo variado: alterna datos concretos con momentos de tensión.
- Abre bucles de curiosidad ("pero lo más extraño aún estaba por venir") y ciérralos más adelante.
- Cada minuto o dos, incluye un giro, una pregunta o un dato sorprendente.
- Evita el lenguaje robótico y las muletillas: "en este video", "sin más preámbulos", "es importante destacar", "en conclusión", "cabe mencionar".

Reglas de imagen (muy importantes para que lo que se ve coincida con lo que se dice):
- Cada "prompt_imagen" va en INGLÉS, de 20 a 35 palabras, y muestra LO QUE DICE ESA ESCENA, no el tema general del video: la acción concreta, las personas, los objetos y el lugar que menciona su narración. Empieza por el sujeto principal.
- Si la narración habla de una persona haciendo algo, muestra a esa persona haciéndolo (plano medio o cercano, con la ropa y la expresión de la época). Si habla de un objeto, muéstralo en primer plano. Si habla de una idea abstracta, usa UNA metáfora visual concreta ligada a lo que se dice.
- Varía el encuadre entre escenas seguidas (plano general, medio, primer plano, detalle, vista aérea, contrapicado).
- No metas en la imagen elementos del tema general (por ejemplo barcos, mar, faros) si esa escena no los menciona. Cada imagen se describe solo con lo que dice SU escena.
- Si un personaje u objeto reaparece, descríbelo con las mismas palabras, pero solo en las escenas donde la narración lo menciona.
- Sin texto ni letras en la imagen. No nombres a personas reales: describe un personaje genérico de la época.

Respondes ÚNICAMENTE con JSON válido, sin texto adicional ni bloques de código.`;
}

// Ajustes de razonamiento según el modelo (en los modelos 5.5 el razonamiento consume los mismos tokens que el texto)
function ajustesRazonamiento(modelo, esfuerzo) {
    const m = String(modelo);
    if (m.includes('sonnet-5-5')) return { thinking: { type: 'between_tools' }, output_config: { effort: esfuerzo } };
    if (m.includes('haiku-5-5')) return { thinking: { type: 'disabled' }, output_config: { effort: esfuerzo } };
    if (m.includes('opus-5-5') || m.includes('fable') || m.includes('mythos')) return { output_config: { effort: esfuerzo } };
    return {};
}

async function crearMensaje(params) {
    try {
        return await anthropic.messages.create(params);
    } catch (e) {
        const msg = String((e && e.message) || '');
        if (e && e.status === 400 && /thinking|output_config|effort/i.test(msg) && (params.thinking || params.output_config)) {
            console.log('[Guionista] ⚠️ La API rechazó los ajustes de razonamiento; se reintenta sin ellos.');
            const { thinking, output_config, ...resto } = params;
            return await anthropic.messages.create(resto);
        }
        throw e;
    }
}

function precioDe(modelo) {
    const clave = Object.keys(PRECIOS).find(k => String(modelo).includes(k));
    return clave ? PRECIOS[clave] : null;
}

async function llamarClaude({ modelo, nicho, contexto, instruccion, maxTokens, esfuerzo }) {
    const contenido = contexto ? [contexto, { type: 'text', text: instruccion }] : instruccion;
    const respuesta = await crearMensaje({
        model: modelo,
        max_tokens: maxTokens,
        system: promptSistema(nicho),
        messages: [{ role: 'user', content: contenido }],
        ...ajustesRazonamiento(modelo, esfuerzo)
    });
    const crudo = respuesta.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    if (!crudo) throw new Error(`Claude no devolvió texto (stop_reason: ${respuesta.stop_reason})`);
    if (respuesta.stop_reason === 'max_tokens') {
        console.log('[Guionista] ⚠️ La respuesta llegó al límite de tokens; se intentará rescatar lo completo.');
    }

    const u = respuesta.usage || {};
    const entrada = u.input_tokens || 0, leida = u.cache_read_input_tokens || 0;
    const escrita = u.cache_creation_input_tokens || 0, salida = u.output_tokens || 0;
    USO.entrada += entrada; USO.cacheLeida += leida; USO.cacheEscrita += escrita; USO.salida += salida;

    let costoLlamada = 0;
    const p = precioDe(modelo);
    if (p) {
        costoLlamada = (entrada * p.entrada + salida * p.salida + leida * p.cacheLeida + escrita * p.cacheEscrita) / 1e6;
        USO.costo += costoLlamada;
    } else {
        USO.sinTarifa = true;
    }
    const tokTexto = Math.round(crudo.length / 3.3);
    const tokRazon = Math.max(0, salida - tokTexto);
    console.log(`          (${modelo} | entrada: ${entrada} | caché leída: ${leida} | salida: ${salida} [texto≈${tokTexto}, razonamiento≈${tokRazon}] | ≈$${costoLlamada.toFixed(3)})`);
    return crudo;
}

// Lee de caché o genera y guarda ANTES de interpretar (así nunca se paga dos veces).
// Si regenerarSiInvalido=true y el resultado no sirve, lo genera de nuevo UNA vez.
async function jsonConCache(archivo, generar, validar, regenerarSiInvalido = false) {
    let crudo;
    if (await existe(archivo)) {
        crudo = await fs.readFile(archivo, 'utf-8');
    } else {
        crudo = await generar();
        await fs.writeFile(archivo, crudo, 'utf-8');
    }
    const intentar = (txt) => { const d = extraerJSON(txt); validar(d); return d; };

    try {
        return intentar(crudo);
    } catch (e) {
        if (!regenerarSiInvalido) throw new Error(`${e.message} Corrige o borra este archivo: ${archivo}`);
        console.log(`[Guionista] ♻️ Resultado inválido (${e.message}). Se generará de nuevo una vez.`);
        crudo = await generar();
        await fs.writeFile(archivo, crudo, 'utf-8');
        try {
            return intentar(crudo);
        } catch (e2) {
            throw new Error(`${e2.message} Corrige o borra este archivo: ${archivo}`);
        }
    }
}

module.exports = { PRECIOS, USO, reiniciarUso, promptSistema, ajustesRazonamiento, crearMensaje, precioDe, llamarClaude, jsonConCache, anthropic };
