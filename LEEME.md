# Fábrica de videos · versión modular

Tu `trabajador_local_v5.js` **no se toca**: esta carpeta es una versión nueva que hace lo mismo,
con cada agente en su propio archivo, y además crea las miniaturas junto con cada video.

## Estructura
```
trabajador.js              <- el que ejecutas (revisa la cola y llama a los agentes)
canales.json               <- tus canales (id, nicho, estilo de miniatura)
miniatura_prueba.js        <- para probar miniaturas sin producir un video
fuentes/                   <- (opcional) fuentes .ttf para las miniaturas
modulos/
  config.js                ajustes, formatos, nichos y canales
  utilidades.js            funciones de apoyo
  ffmpeg.js                FFmpeg, GPU y duración de audio
  claude.js                conexión con Claude, caché y costos
  memoria.js               calibración de la voz y historial de temas
  panel.js                 panel web y Telegram (texto y fotos)
  agente_cazador.js        subtítulos del video de referencia
  agente_guionista.js      plan, capítulos, shorts y gancho de miniatura
  agente_locutor.js        voz con AllTalk
  agente_director_arte.js  prompt de imagen fiel a cada narración
  agente_pintor.js         imágenes con ComfyUI / Forge
  agente_editor.js         clips, subtítulos, música y render
  agente_miniaturista.js   crea 3 miniaturas por video (fondo distinto en cada una)
  miniatura_plantillas.js  los 8 diseños y los colores
  produccion.js            arma una pieza (video o short)
  agente_capataz.js        coordina todo un proyecto
```

## Instalar y ejecutar
1. Copia esta carpeta junto a tu `.env` y tu carpeta `musica` (o copia el `.env` aquí).
2. Una sola dependencia nueva: `npm install puppeteer` (la primera vez descarga un navegador, ~170 MB).
3. Abre ComfyUI y AllTalk (Pinokio) y ejecuta: `node trabajador.js` (o `node trabajador.js --vigilar`).
4. **Borra `cache/guiones`** si repites un video de prueba: los planes viejos no traen el gancho de miniatura
   (en ese caso se usa el título, pero conviene regenerarlos).

## Qué pasa con las miniaturas
- Claude escribe el gancho (2 a 4 palabras) y la escena del fondo junto con el plan del video.
- Justo después del guion se crean 3 miniaturas en `<proyecto>/miniaturas/` (cada una con su propio fondo y diseño,
  según el canal) y la hoja comparativa se manda a tu Telegram.
- Si algo falla con las miniaturas, el video **sigue** igual.

## Probar miniaturas sin producir un video
```
node miniatura_prueba.js "NADIE SOBREVIVIÓ" --canal papa_misterio --comfy "a man on the deck of an abandoned ship at night" --variantes 3
node miniatura_prueba.js fondo.png "EL NIVEL 5 ES REAL" --canal leo_iceberg --plantilla nivel --nivel 5
```

## Variables nuevas del .env (todas opcionales)
```
MINIATURAS=1              # 0 = no crear miniaturas
MINIATURAS_VARIANTES=3    # cuántas por video
ALLTALK_URL=http://127.0.0.1:7851
VOZ_DEFAULT=voz_misterio.wav
```
