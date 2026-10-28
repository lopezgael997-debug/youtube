// =====================================================================
// PRUEBA DE MINIATURAS (línea de comandos)
// Usa los mismos módulos que el worker, así que lo que ves aquí es
// exactamente lo que saldrá en los videos. No toca ningún proyecto.
//
//   node miniatura_prueba.js fondo.png "NADIE SOBREVIVIÓ" --canal papa_misterio --variantes 3
//   node miniatura_prueba.js "NADIE SOBREVIVIÓ" --canal papa_misterio --comfy "a man drenched in blood on the deck of an abandoned ship at night"
//   node miniatura_prueba.js fondo.png "EL NIVEL 5 ES REAL" --canal leo_iceberg --plantilla nivel --nivel 5
//
// Opciones: --canal id | --variantes N | --sub "texto" | --etiqueta "TEXTO" | --nivel N
//           --plantilla nombre | --carpeta salida | --comfy "descripción en inglés del fondo"
// Plantillas: impacto_izq, banda, cinema, dividida, sello, nivel, pregunta, etereo
// =====================================================================
require('./modulos/config');
const fs = require('fs');
const path = require('path');
const { CANALES } = require('./modulos/config');
const { generarMiniaturas } = require('./modulos/agente_miniaturista');

function leerArgs(argv) {
    const pos = [], flags = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) flags[a.slice(2)] = (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
        else pos.push(a);
    }
    return { pos, flags };
}

(async () => {
    const { pos, flags } = leerArgs(process.argv.slice(2));
    let fondo = null, gancho = null;
    if (pos.length >= 2) [fondo, gancho] = pos;
    else if (pos.length === 1) { if (fs.existsSync(pos[0])) fondo = pos[0]; else gancho = pos[0]; }
    gancho = gancho || 'EL ICEBERG DE LA HISTORIA OCULTA';
    if (fondo && !fs.existsSync(fondo)) throw new Error(`No encuentro la imagen de fondo "${fondo}".`);

    const canal = CANALES.find(c => c.id === flags.canal) || CANALES[0];
    if (flags.canal && canal.id !== flags.canal) {
        console.log(`⚠️ El canal "${flags.canal}" no existe en canales.json; se usa "${canal.id}". Disponibles: ${CANALES.map(c => c.id).join(', ')}`);
    }
    const promptFondo = !fondo && flags.comfy ? (flags.comfy === true ? 'a dramatic mysterious scene related to: ' + gancho : flags.comfy) : undefined;
    if (!fondo && !promptFondo) console.log('ℹ️  Sin imagen de fondo se usa un degradado. Para pintarla con tu generador de imágenes añade  --comfy "descripción en inglés"');

    console.log(`🎨 "${gancho}" | canal: ${canal.id} | fondo: ${fondo || (promptFondo ? 'se pintará con IA' : '(degradado)')}`);
    const carpeta = flags.carpeta ? path.resolve(flags.carpeta) : undefined;
    await generarMiniaturas({
        gancho, canal, fondo, promptFondo, carpeta,
        sub: flags.sub === true ? '' : flags.sub,
        etiqueta: flags.etiqueta === undefined ? undefined : (flags.etiqueta === true ? '' : flags.etiqueta),
        nivel: flags.nivel, plantilla: flags.plantilla, variantes: flags.variantes,
        nombreBase: 'Prueba'
    });
    console.log(`\n📁 Revisa la carpeta: ${carpeta || path.join(__dirname, 'miniaturas_prueba')}`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
