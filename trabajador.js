require('./modulos/config');
const { CFG } = require('./modulos/config');
const { detectarGPU } = require('./modulos/ffmpeg');
const { reiniciarUso } = require('./modulos/claude');
const { dormir, crearCarpetas } = require('./modulos/utilidades');
const { pedirCola, crearReportero } = require('./modulos/panel');
const { producirVideo } = require('./modulos/agente_capataz');

async function procesarCola() {
    console.log('📡 Conectando con el panel para buscar trabajo...');
    try {
        const proyectos = await pedirCola();

        if (!Array.isArray(proyectos) || proyectos.length === 0) {
            console.log('📭 La fila está vacía.');
            return;
        }
        console.log(`📦 ¡Se encontraron ${proyectos.length} proyectos pendientes!`);

        for (const proyecto of proyectos) {
            console.log(`\n===========================================`);
            console.log(`🚀 Iniciando producción: "${proyecto.titulo}"`);
            reiniciarUso();
            const reportar = crearReportero(proyecto);
            try {
                await producirVideo(proyecto, reportar);
            } catch (error) {
                console.error(`❌ Falló el proyecto "${proyecto.titulo}":`, error.message);
                await reportar({ estado: 'error', mensaje: error.message.slice(0, 280) }, true);
            }
        }
        console.log('\n🏁 Flujo terminado.');
    } catch (error) {
        console.error('❌ Error conectando con el panel:', error.message);
    }
}

async function main() {
    if (!CFG.claveWorker) {
        console.error('❌ Falta CLAVE_WORKER en el archivo .env (debe ser igual a la que pongas en Render).');
        process.exit(1);
    }
    await crearCarpetas();
    await detectarGPU();

    if (process.argv.includes('--vigilar')) {
        console.log(`👀 Modo vigilancia: revisando la cola cada ${CFG.intervaloMin} minutos.`);
        while (true) {
            await procesarCola();
            await dormir(CFG.intervaloMin * 60 * 1000);
        }
    } else {
        await procesarCola();
    }
}

main();
