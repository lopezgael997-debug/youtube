const path = require('path');
const { CFG } = require('./config');
const { dormir } = require('./utilidades');

// =====================================================================
// COMUNICACIÓN CON EL PANEL
// =====================================================================
async function pedirCola() {
    for (let intento = 1; intento <= 4; intento++) {
        try {
            const r = await fetch(`${CFG.urlPanel}/api/obtener-cola`, { headers: { 'x-clave': CFG.claveWorker } });
            if (r.status === 401 || r.status === 503) {
                const e = new Error(`El panel rechazó la clave (HTTP ${r.status}). Revisa que CLAVE_WORKER sea igual en .env y en Render.`);
                e.fatal = true;
                throw e;
            }
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return await r.json();
        } catch (e) {
            if (e.fatal || intento === 4) throw e;
            console.log(`[Sistema] ⏳ El panel no responde (${e.message}). Reintentando en 20 s (puede estar despertando)...`);
            await dormir(20000);
        }
    }
}

function crearReportero(proyecto) {
    let ultimo = 0;
    return async (datos, forzar = false) => {
        const ahora = Date.now();
        if (!forzar && ahora - ultimo < 4000) return;
        ultimo = ahora;
        try {
            await fetch(`${CFG.urlPanel}/api/actualizar/${proyecto.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-clave': CFG.claveWorker },
                body: JSON.stringify(datos)
            });
        } catch { /* no es crítico */ }
    };
}

async function avisarTelegram(texto) {
    const { token, chatId } = CFG.telegram;
    if (!token || !chatId) return;
    try {
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: texto })
        });
        if (!r.ok) console.log(`[Sistema] ⚠️ Telegram respondió HTTP ${r.status}. Revisa el token y el chat id.`);
    } catch (e) {
        console.log(`[Sistema] ⚠️ No se pudo avisar por Telegram: ${e.message}`);
    }
}


// Envía una imagen (por ejemplo la comparativa de miniaturas) a Telegram
async function enviarFotoTelegram(rutaImagen, texto) {
    const { token, chatId } = CFG.telegram;
    if (!token || !chatId) return;
    try {
        const form = new FormData();
        form.append('chat_id', chatId);
        if (texto) form.append('caption', texto.slice(0, 1000));
        form.append('photo', new Blob([require('fs').readFileSync(rutaImagen)], { type: 'image/jpeg' }), path.basename(rutaImagen));
        const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form });
        if (!r.ok) console.log(`[Sistema] ⚠️ Telegram respondió HTTP ${r.status} al enviar la imagen.`);
    } catch (e) {
        console.log(`[Sistema] ⚠️ No se pudo enviar la imagen por Telegram: ${e.message}`);
    }
}

module.exports = { pedirCola, crearReportero, avisarTelegram, enviarFotoTelegram };
