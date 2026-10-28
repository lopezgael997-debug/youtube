const path = require('path');
const { CFG, DIR } = require('./config');
const { llamarClaude, jsonConCache } = require('./claude');
const { hash } = require('./utilidades');

// =====================================================================
// AGENTE DIRECTOR DE ARTE: un prompt de imagen fiel a CADA narración
// =====================================================================
async function refinarPromptsImagen(escenas, nicho, guiaVisual, tema, etiqueta) {
    const LOTE = 12;
    let mejorados = 0;
    for (let ini = 0; ini < escenas.length; ini += LOTE) {
        const grupo = escenas.slice(ini, ini + LOTE);
        const huella = hash(grupo.map(e => e.narracion).join('|') + '|' + guiaVisual + '|' + (tema || '') + '|v1');
        const archivo = path.join(DIR.guiones, `imgprompts_${huella}.json`);
        const anterior = ini > 0 ? escenas[ini - 1].narracion : '';
        try {
            const datos = await jsonConCache(
                archivo,
                async () => llamarClaude({
                    modelo: CFG.modeloEconomico, nicho, contexto: null, maxTokens: 4000, esfuerzo: CFG.efforts.plan,
                    instruccion: `Eres el director de arte de un documental. Para cada escena escribe el prompt de imagen (en INGLÉS, 20 a 35 palabras) que muestre EXACTAMENTE lo que dice su narración.

Tema del video (solo para entender la época y el lugar): ${tema || 'sin dato'}
Aspecto general fijo (solo época, color y luz; NO es contenido): ${guiaVisual || 'ninguno'}
${anterior ? 'Escena anterior (solo para seguir el hilo, NO la dibujes): ' + anterior + '\n' : ''}
ESCENAS:
${grupo.map((e, k) => `[${k}] ${e.narracion}`).join('\n')}

Reglas:
- Dibuja solo lo que dice ESA escena: la acción concreta, las personas, los objetos y el lugar. Si la narración habla de un hombre empapado en sangre, la imagen muestra a un hombre empapado en sangre (dramático, sin gore extremo); si habla de una puerta que se abre, muestra la puerta abriéndose.
- Empieza por el sujeto principal. Incluye el encuadre (wide shot, medium shot, close-up, detail, aerial, low angle) y varíalo entre escenas seguidas.
- Las personas se describen como personajes genéricos de la época (ropa, edad, expresión). No nombres personas reales.
- No repitas elementos del tema general (barcos, mar, faros, torres, etc.) si esa escena no los menciona.
- Si la escena es una idea abstracta, usa UNA metáfora visual concreta ligada a lo que dice.
- Sin texto ni letras en la imagen.

Responde con este JSON, con EXACTAMENTE ${grupo.length} prompts en el mismo orden:
{ "prompts": ["prompt de la escena 0", "prompt de la escena 1"] }`
                }),
                (d) => {
                    if (!Array.isArray(d.prompts) || d.prompts.length !== grupo.length || d.prompts.some(x => typeof x !== 'string' || x.trim().length < 10)) {
                        throw new Error(`Se esperaban ${grupo.length} prompts de imagen.`);
                    }
                },
                true
            );
            grupo.forEach((e, k) => { e.prompt_imagen = datos.prompts[k].replace(/\s+/g, ' ').trim(); });
            mejorados += grupo.length;
        } catch (e) {
            console.log(`[Director de arte] ⚠️ No se pudieron mejorar las escenas ${ini + 1}-${ini + grupo.length} (${e.message}). Se usan los prompts originales.`);
        }
    }
    console.log(`[Director de arte] 🖼️ ${etiqueta}: ${mejorados}/${escenas.length} prompts de imagen escritos a partir de la narración.`);
}

module.exports = { refinarPromptsImagen };
