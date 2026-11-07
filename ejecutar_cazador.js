// ejecutar_cazador.js  (va en la raíz del proyecto, junto a trabajador.js)
//
// Uso:
//   node ejecutar_cazador.js                      -> patrulla TODOS los canales de canales.json
//   node ejecutar_cazador.js papa_misterio        -> solo ese canal
//   node ejecutar_cazador.js leo_iceberg mama_metafisica
//   node ejecutar_cazador.js --lista              -> muestra los canales disponibles
require('dotenv').config();
const { patrullar, NICHOS } = require('./modulos/cazador');

const args = process.argv.slice(2);

if (args.includes('--lista')) {
    console.log('Canales disponibles para el cazador:');
    for (const [id, n] of Object.entries(NICHOS)) {
        console.log(`  ${id.padEnd(18)} ${n.nombre}  [${n.nicho}]  (mín. ${n.minVistas} vistas)`);
    }
    process.exit(0);
}

patrullar(args.length ? args : undefined)
    .then(() => process.exit(0))
    .catch(e => {
        console.error('[Cazador] ❌ Error fatal:', e.message);
        process.exit(1);
    });
