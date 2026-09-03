#!/usr/bin/env python3
"""
Consulta la API oficial del INE (servicios.ine.es, Tempus3) y añade a
data/raw/*.tsv los periodos mensuales nuevos que todavía no estén en el
dataset. Nunca sobrescribe un valor ya existente: solo añade periodos
posteriores al último que ya tenemos.

Uso:
    python3 scripts/fetch_ine.py            # actualiza y sale con código
                                              # 0 si hubo cambios, 1 si no
    python3 scripts/fetch_ine.py --dry-run   # solo muestra qué añadiría

Fuente: INE, tabla Tempus3 76125 "Índices nacionales: general y de
grupos ECOICOP". Documentación: https://www.ine.es/dyngs/DataLab/manual.html?cid=45
API pública sin autenticación: https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/76125

Nota: esta API la bloquea el robots.txt de servicios.ine.es para bots de
rastreo, pero es una API REST pública documentada y pensada para consumo
programático (no para navegación web); una petición GET puntual, mensual,
desde un GitHub Action es un uso normal y respetuoso de una API abierta,
muy distinto de un rastreo masivo.
"""
import argparse
import json
import os
import re
import sys
import urllib.request

RAW = os.path.join(os.path.dirname(__file__), "..", "data", "raw")
TABLE_ID = "76125"
API_URL = f"https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/{TABLE_ID}?nult=6&tip=AM"

MONTHS_ES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}

# Mapea (subcadena a buscar en el nombre de la serie, en minúsculas) -> fichero .tsv
DIVISION_MATCH = [
    ("alimentación y bebidas no alcohólicas", "alimentos.tsv"),
    ("bebidas alcohólicas y tabaco", "bebidas_tabaco.tsv"),
    ("vestido y calzado", "vestido_calzado.tsv"),
    ("vivienda, agua, electricidad", "vivienda.tsv"),
    ("muebles, artículos del hogar", "muebles.tsv"),
    ("sanidad", "sanidad.tsv"),
    ("transporte", "transporte.tsv"),
    ("comunicaciones", "comunicaciones.tsv"),
    ("ocio y cultura", "ocio_cultura.tsv"),
    ("enseñanza", "ensenanza.tsv"),
    ("restaurantes y hoteles", "restaurantes_hoteles.tsv"),
    ("otros bienes y servicios", "otros_bienes_servicios.tsv"),
    ("índice general", "general.tsv"),
]


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ipc-espana-dashboard-updater/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def normalize(s):
    return re.sub(r"\s+", " ", s or "").strip().lower()


def match_division(nombre_serie):
    n = normalize(nombre_serie)
    # Debe ser la serie de ÍNDICE (no variación mensual/anual/acumulada) y ámbito Nacional.
    if "nacional" not in n:
        return None
    if any(w in n for w in ["variación", "variacion"]):
        return None
    for needle, fname in DIVISION_MATCH:
        if needle in n:
            return fname
    return None


def load_existing_periods(fname):
    path = os.path.join(RAW, fname)
    periods = set()
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    periods.add(line.split("\t")[0])
    return periods


def append_periods(fname, new_rows):
    """new_rows: lista de (periodo 'YYYY-MM', valor float), se añaden al principio (orden desc)."""
    path = os.path.join(RAW, fname)
    existing = ""
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            existing = f.read()
    new_lines = "\n".join(f"{p}\t{v}" for p, v in new_rows)
    with open(path, "w", encoding="utf-8") as f:
        f.write(new_lines + "\n" + existing)


def period_from_data_entry(entry):
    """Convierte una entrada Data de la API (Anyo + NombrePeriodo/T3_Periodo) a 'YYYY-MM'."""
    anyo = entry.get("Anyo")
    periodo_nombre = normalize(entry.get("T3_Periodo") or entry.get("NombrePeriodo") or "")
    mes = None
    for name, num in MONTHS_ES.items():
        if name in periodo_nombre:
            mes = num
            break
    if anyo is None or mes is None:
        return None
    return f"{anyo}-{mes:02d}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print(f"Consultando {API_URL} ...")
    try:
        data = fetch_json(API_URL)
    except Exception as e:
        print(f"ERROR al consultar la API del INE: {e}", file=sys.stderr)
        print("No se modifica ningún fichero. Reintenta más tarde o revisa la URL/tabla.", file=sys.stderr)
        sys.exit(1)

    if not isinstance(data, list):
        print(f"ERROR: respuesta inesperada de la API (no es una lista): {str(data)[:300]}", file=sys.stderr)
        sys.exit(1)

    total_new = 0
    matched_series = 0

    for serie in data:
        nombre = serie.get("Nombre", "")
        fname = match_division(nombre)
        if not fname:
            continue
        matched_series += 1
        existing_periods = load_existing_periods(fname)
        new_rows = []
        for entry in serie.get("Data", []):
            if entry.get("Secreto"):
                continue
            period = period_from_data_entry(entry)
            if not period or period in existing_periods:
                continue
            valor = entry.get("Valor")
            if valor is None:
                continue
            new_rows.append((period, float(valor)))
            existing_periods.add(period)

        if new_rows:
            new_rows.sort(reverse=True)  # más reciente primero, como el resto del fichero
            print(f"  {fname}: +{len(new_rows)} periodo(s) nuevo(s) -> {new_rows}")
            total_new += len(new_rows)
            if not args.dry_run:
                append_periods(fname, new_rows)
        else:
            print(f"  {fname}: sin periodos nuevos (ya actualizado)")

    print(f"\nSeries de división identificadas en la respuesta: {matched_series} / {len(DIVISION_MATCH)} esperadas")
    if matched_series < len(DIVISION_MATCH):
        print("AVISO: no se han identificado todas las divisiones esperadas. Puede que el INE haya",
              "cambiado el texto de los nombres de serie; revisa DIVISION_MATCH en este script.", file=sys.stderr)

    if total_new == 0:
        print("Sin cambios: el dataset ya estaba al día.")
        sys.exit(1)  # código 1 = "nada que commitear", lo usa el workflow

    print(f"\nTotal de periodos añadidos: {total_new}")
    sys.exit(0)


if __name__ == "__main__":
    main()
