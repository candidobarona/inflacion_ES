# IPC España — Evolución de precios e inflación (v2)

Dashboard estático (HTML + CSS + JavaScript, sin dependencias de build ni backend) para analizar el **Índice de Precios de Consumo** oficial del INE por categoría, construir una **cartera personalizada** y comparar entre **comunidades autónomas**.

## Qué cambia respecto a la v1

- **Los datos vienen embebidos en `js/data.js`** (no se cargan con `fetch()`). Esto corrige el fallo de la versión anterior: al abrir `index.html` con doble clic (protocolo `file://`), los navegadores bloquean `fetch()` de ficheros locales por CORS, así que nada cargaba (ni categorías, ni gráficos). Ahora `data.js` es un `<script>` normal: funciona igual en GitHub Pages que abriendo el fichero directamente.
- **Las categorías son directamente las 12 divisiones oficiales del IPC (ECOICOP) + el índice general** — el mismo desglose que usa el INE. Se eliminó la capa confusa "categoría → lista de productos", que mezclaba divisiones con agregados especiales mal etiquetados. Ahora cada tarjeta que seleccionas **es** una categoría real del IPC, verificada contra su código INE oficial (400010–400120).
- **Se corrigieron datos mal etiquetados**: en la v1, "Vivienda" y "Transporte" apuntaban por error a series equivocadas (un fallo de mapeo al construir el dataset). En esta versión las 13 series se han verificado una a una contra su código INE.
- **Navegación simplificada**: un grid de categorías que envuelve en varias filas (sin scroll horizontal forzado), 5 botones de periodo en vez de un desplegable + inputs de fecha, y una sola sección de selección en lugar de categoría+búsqueda+lista por separado.
- **Nueva sección "Comparativa por comunidad autónoma"**: ranking de las 19 comunidades y ciudades autónomas para la categoría que elijas, con la media nacional resaltada.
- Los gráficos se probaron en un DOM simulado (jsdom) reproduciendo clics, búsquedas y cambios de periodo reales antes de la entrega, para confirmar que no lanzan errores.

## Características

- 13 categorías oficiales del IPC (índice general + 12 divisiones ECOICOP), seleccionables como tarjetas.
- Gráfico de evolución con Chart.js, con opción "comparar en %" (cada serie normalizada a 100 al inicio del periodo).
- Tabla comparativa con variación interanual, del periodo elegido y desde 2002.
- Cartera personalizada con pesos ajustables, gráfico de distribución (donut) y evolución del índice de la cesta.
- Escenario "¿Cuánto gastaba?": proyecta un gasto mensual pasado según la evolución de la cartera.
- Comparativa por comunidad autónoma (foto del último mes disponible, 19 territorios).
- Exportar CSV, descargar el gráfico como imagen, y compartir el análisis por URL.
- `localStorage` para recordar tu selección; modo oscuro; diseño responsive.

## Fuente de los datos

INE, **Índice de Precios de Consumo** (operación IOE 30138), base 2021 = 100. Los valores mensuales (enero de 2002 a noviembre de 2025) se han tomado literalmente de las series que redistribuye [tematicas.org](https://tematicas.org/ipc/), verificando cada división contra su código oficial del INE (visible en la ficha de cada serie, p. ej. "Código: 400070" para Transporte) antes de incorporarla. La comparativa por comunidades autónomas usa la foto de noviembre de 2025 publicada en las mismas fichas por territorio.

No se ha generado, estimado ni interpolado ningún valor.

## Metodología

- **Inflación interanual**: variación frente al mismo mes del año anterior.
- **Inflación del periodo/acumulada**: `(índice_final / índice_inicial − 1) × 100` entre las dos fechas del rango elegido (nunca se suman variaciones mensuales).
- **Índice de cartera ponderada**: `Σ(índice_i × peso_i) / Σ(peso_i)`, calculado mes a mes sobre los periodos en que todas las categorías de la cartera tienen dato.
- **Escenario de gasto**: `gasto_estimado = gasto_inicial × (índice_final_cartera / índice_inicial_cartera)`; es una proyección, no una predicción real.

## Uso local / GitHub Pages

No requiere build. Basta con abrir `index.html` (doble clic, funciona sin servidor) o publicarlo en GitHub Pages:

1. Sube el repositorio a GitHub.
2. **Settings → Pages → Deploy from a branch**, rama `main`, carpeta `/ (root)`.
3. Listo: `https://<usuario>.github.io/<repo>/`.

## Actualización automática (mensual, sin intervención manual)

El repositorio incluye `.github/workflows/update-data.yml`, un GitHub Action programado que:

1. El día 15 de cada mes (el INE suele publicar el IPC entre el 12 y el 14), ejecuta `scripts/fetch_ine.py`.
2. Ese script llama a la **API pública oficial del INE** (`servicios.ine.es/wstempus`, tabla Tempus3 `76125` — "Índices nacionales: general y de grupos ECOICOP"), pide los últimos 6 periodos y añade a `data/raw/*.tsv` **solo los meses que todavía no tenías** (nunca sobrescribe un valor histórico ya guardado).
3. Si hay datos nuevos, regenera `js/data.js` con `build.py` y hace commit y push automáticamente.
4. Si no hay datos nuevos ese mes (o el INE no responde), no hace ningún cambio — el workflow no falla el repositorio, solo lo deja como estaba.

Esto significa que **la página en producción no llama a ningún sitio en tiempo real** (sigue siendo 100% estática, tal como pedía el planteamiento original): el "refresco" ocurre una vez al mes en la infraestructura de GitHub, no en el navegador de cada visitante — que es, además, la única cadencia con sentido, porque el INE no publica el IPC más de una vez al mes.

**Por qué no se hace con `fetch()` directo desde el navegador:** la API del INE bloquea el acceso automatizado vía su `robots.txt` y no hay garantía de que envíe cabeceras CORS que permitan leerla desde JavaScript en un dominio de GitHub Pages. Un GitHub Action corre servidor a servidor (sin navegador de por medio), así que ninguno de los dos problemas aplica.

**Cómo comprobarlo tú mismo:** en tu repositorio, pestaña **Actions → Actualizar datos del IPC → Run workflow**, para lanzarlo a mano sin esperar al día 15. Revisa el log: te dirá exactamente cuántas divisiones identificó (debería ser 13/13) y qué periodos añadió. No he podido probar esta llamada contra la API real del INE desde este entorno (la misma restricción de red que me impidió acceder a `servicios.ine.es` durante el desarrollo), así que el primer disparo manual es importante para confirmar que todo encaja con el formato real de respuesta del INE.

**Si el matching de nombres de serie falla** (el INE cambia ligeramente el texto de sus series de vez en cuando): el log del Action mostrará un aviso "X/13 divisiones identificadas" con X menor a 13. En ese caso hay que abrir `scripts/fetch_ine.py`, mirar qué `Nombre` de serie llegó realmente (se puede añadir un `print(nombre)` temporal) y ajustar las cadenas de `DIVISION_MATCH`.

## Actualización manual

También puedes actualizar a mano en cualquier momento:

1. Añade las filas nuevas (`YYYY-MM<TAB>valor`) al fichero correspondiente en `data/raw/*.tsv`, o actualiza `data/raw/regiones_nov2025.tsv` con la foto regional más reciente.
2. Ejecuta `python3 build.py`. Esto regenera `js/data.js` (los datos embebidos) automáticamente.
3. Sube los cambios; no hace falta tocar `index.html`, `app.js` ni `styles.css`.

## Arquitectura

```text
index.html                          Página única, sin backend
css/styles.css                       Estilos (variables CSS, modo oscuro)
js/data.js                            Dataset embebido (generado por build.py) — sin fetch
js/app.js                              Estado, render, eventos, export, persistencia
data/raw/*.tsv                       Series originales (fuente de build.py)
build.py                              Genera js/data.js a partir de data/raw/
scripts/fetch_ine.py                Consulta la API del INE y añade periodos nuevos a data/raw/
.github/workflows/update-data.yml   GitHub Action mensual que ejecuta fetch_ine.py + build.py
```

## Limitaciones

- El IPC mide la evolución de precios (un índice), no el precio de venta de un producto concreto.
- La comparativa regional es una **foto de un único mes** (noviembre de 2025), no una serie histórica por comunidad autónoma; ampliarla a series completas por región multiplicaría el volumen de datos (19 regiones × 13 categorías × 287 meses) y queda fuera del alcance de esta versión.
- Una cartera personalizada no equivale a la cesta oficial de la compra del IPC, que usa ponderaciones oficiales por hogar tipo.
- Las estimaciones de "¿Cuánto gastaba?" son una proyección basada en índices, no una predicción real del gasto de nadie.

## Licencia

Código bajo licencia MIT. Los datos del IPC son de titularidad del INE.
