#!/usr/bin/env python3
"""
Construye js/data.js embebiendo el dataset directamente como JavaScript
(en vez de JSON cargado con fetch), para que la aplicación funcione tanto
en GitHub Pages como al abrir index.html localmente con doble clic
(protocolo file://, donde fetch() de ficheros locales falla por CORS).

Fuente de los datos: INE, Índice de Precios de Consumo (IOE 30138),
series redistribuidas verbatim por tematicas.org (base 2021=100).
No se genera, estima ni interpola ningún valor.
"""
import csv
import json
import os

RAW = os.path.join(os.path.dirname(__file__), "data", "raw")
OUT_JS = os.path.join(os.path.dirname(__file__), "js", "data.js")


def load_tsv(fname):
    series = {}
    with open(os.path.join(RAW, fname), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            period, value = line.split("\t")
            series[period] = round(float(value), 3)
    return series


CATEGORIES = [
    {"id": "gen", "name": "Índice general", "icon": "🇪🇸"},
    {"id": "01", "name": "Alimentación y bebidas no alcohólicas", "icon": "🍎"},
    {"id": "02", "name": "Bebidas alcohólicas y tabaco", "icon": "🍷"},
    {"id": "03", "name": "Vestido y calzado", "icon": "👕"},
    {"id": "04", "name": "Vivienda, agua, electricidad, gas y combustibles", "icon": "🏠"},
    {"id": "05", "name": "Muebles y artículos del hogar", "icon": "🛋️"},
    {"id": "06", "name": "Sanidad", "icon": "💊"},
    {"id": "07", "name": "Transporte", "icon": "🚗"},
    {"id": "08", "name": "Comunicaciones", "icon": "📱"},
    {"id": "09", "name": "Ocio y cultura", "icon": "🎮"},
    {"id": "10", "name": "Enseñanza", "icon": "🎓"},
    {"id": "11", "name": "Restaurantes y hoteles", "icon": "🍽️"},
    {"id": "12", "name": "Otros bienes y servicios", "icon": "💳"},
]

PRODUCT_DEFS = [
    ("general", "Índice general", "gen", "general.tsv", "IOE30138"),
    ("alimentos", "Alimentación y bebidas no alcohólicas", "01", "alimentos.tsv", "400010"),
    ("bebidas_tabaco", "Bebidas alcohólicas y tabaco", "02", "bebidas_tabaco.tsv", "400020"),
    ("vestido_calzado", "Vestido y calzado", "03", "vestido_calzado.tsv", "400030"),
    ("vivienda", "Vivienda, agua, electricidad, gas y combustibles", "04", "vivienda.tsv", "400040"),
    ("muebles", "Muebles y artículos del hogar", "05", "muebles.tsv", "400050"),
    ("sanidad", "Sanidad", "06", "sanidad.tsv", "400060"),
    ("transporte", "Transporte", "07", "transporte.tsv", "400070"),
    ("comunicaciones", "Comunicaciones", "08", "comunicaciones.tsv", "400080"),
    ("ocio_cultura", "Ocio y cultura", "09", "ocio_cultura.tsv", "400090"),
    ("ensenanza", "Enseñanza", "10", "ensenanza.tsv", "400100"),
    ("restaurantes_hoteles", "Restaurantes y hoteles", "11", "restaurantes_hoteles.tsv", "400110"),
    ("otros_bienes_servicios", "Otros bienes y servicios", "12", "otros_bienes_servicios.tsv", "400120"),
]


def compute_meta(series):
    periods = sorted(series.keys())
    first, last = periods[0], periods[-1]
    last_val = series[last]
    y, m = last.split("-")
    prev = f"{int(y)-1}-{m}"
    yoy = round((last_val / series[prev] - 1) * 100, 2) if prev in series else None
    cum = round((last_val / series[first] - 1) * 100, 2)
    return {"firstPeriod": first, "lastPeriod": last, "lastValue": last_val, "yoyChangePct": yoy, "cumulativeChangePct": cum}


products = []
for pid, name, cat, fname, code in PRODUCT_DEFS:
    series = load_tsv(fname)
    products.append({
        "id": pid, "name": name, "category": cat, "ineCode": code,
        "series": series, "meta": compute_meta(series),
    })

# Datos regionales (foto de noviembre 2025, 19 CCAA x 13 series)
regions = []
with open(os.path.join(RAW, "regiones_nov2025.tsv"), encoding="utf-8") as f:
    reader = csv.DictReader(f, delimiter="\t")
    fieldnames = reader.fieldnames
    for row in reader:
        entry = {"name": row["region"]}
        for pid, _, _, _, _ in PRODUCT_DEFS:
            entry[pid] = float(row[pid])
        regions.append(entry)

REGION_PERIOD = "2025-11"

js = []
js.append("// Dataset del IPC España, generado por build.py a partir de data/raw/.")
js.append("// Fuente: INE (IOE 30138), vía series redistribuidas por tematicas.org. No contiene datos ficticios.")
js.append(f"const IPC_CATEGORIES = {json.dumps(CATEGORIES, ensure_ascii=False)};")
js.append(f"const IPC_PRODUCTS = {json.dumps(products, ensure_ascii=False)};")
js.append(f"const IPC_REGIONS = {json.dumps(regions, ensure_ascii=False)};")
js.append(f"const IPC_REGION_PERIOD = {json.dumps(REGION_PERIOD)};")

os.makedirs(os.path.dirname(OUT_JS), exist_ok=True)
with open(OUT_JS, "w", encoding="utf-8") as f:
    f.write("\n".join(js) + "\n")

size_kb = os.path.getsize(OUT_JS) / 1024
print(f"OK -> js/data.js generado ({size_kb:.1f} KB), {len(products)} series, {len(regions)} regiones")
for p in products:
    print(f"  {p['id']:24s} {p['meta']['firstPeriod']}..{p['meta']['lastPeriod']}  n={len(p['series'])}  ultimo={p['meta']['lastValue']}")
