// ejecutar_cazador.js  (va en la raíz del proyecto, junto a trabajador.js)
//
// Uso:
//   node ejecutar_cazador.js                  -> patrulla todos los canales
//   node ejecutar_cazador.js papa_misterio    -> solo ese canal
//   node ejecutar_cazador.js gael_historias mama_metafisica
require('dotenv').config();
const { patrullar } = require('./modulos/cazador');

const canales = process.argv.slice(2);

patrullar(canales.length ? canales : undefined)
    .then(() => process.exit(0))
    .catch(e => {
        console.error('[Cazador] ❌ Error fatal:', e.message);
        process.exit(1);
    });
