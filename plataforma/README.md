# Plataforma de Control de Cavas · v42

Capas nuevas sobre el programa **Control de Cavas v36** del usuario: diseño neutro y minimalista, asistente renombrado
(**Cifra**), análisis ampliado, captura tipo Excel, carga de archivos en cada apartado y configuración.

## Construir

```bash
node plataforma/build.mjs /ruta/Control_Cavas_v36.html plataforma/dist/Control_Cavas_v42.html
```

El archivo resultante es un solo HTML que funciona sin conexión (doble clic). **Los datos de producción no se guardan
en este repositorio** (es público): se leen del HTML original en cada compilación y `dist/` está en `.gitignore`.

## Estructura

- `patches.mjs`: reemplazos exactos sobre el HTML original (se verifica el número de coincidencias).
- `src/css/*.css`: capas de estilo (se aplican al final, después de los estilos del programa).
- `src/js/*.js`: módulos nuevos (se ejecutan después de todos los módulos del programa).
- `tests/`: pruebas con Playwright sobre el HTML construido.
