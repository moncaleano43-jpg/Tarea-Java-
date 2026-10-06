# LevaBot con IA

LevaBot responde en dos capas:

1. **Exacta (siempre, gratis, instantánea):** cifras, fechas y estados salen directo de los datos de la plataforma.
2. **IA (opcional):** preguntas abiertas, comparaciones, recomendaciones y todo lo que la capa exacta no sabe. Claude recibe una foto compacta de los datos (tanques, colectores, extracto de alta, calidad por generación, últimos movimientos) y responde solo con eso.

Si la IA no está conectada o falla, LevaBot sigue funcionando como siempre.

## Conectarla (Netlify)

1. Subir este repositorio a Netlify (sitio estático + función `netlify/functions/levabot.mjs`).
2. En *Site configuration → Environment variables* crear:
   - `ANTHROPIC_API_KEY` — clave de la consola de Anthropic (obligatoria).
   - `LEVABOT_TOKEN` — clave compartida para que solo su plataforma use la función (recomendada).
   - `LEVABOT_MODEL` — opcional; por defecto `claude-opus-5-5`. `claude-sonnet-5-5` es más barato y rápido.
   - `LEVABOT_EFFORT` — opcional; `low`, `medium` (defecto) o `high`.
3. En la plataforma: **Ajustes → LevaBot con IA** → activar, pegar la dirección
   `/api/levabot` (ya viene puesta cuando la plataforma está en el mismo sitio de Netlify), la clave de acceso (`LEVABOT_TOKEN`) y pulsar **Probar conexión**.

La clave de Anthropic vive solo en Netlify; nunca viaja en el HTML.
