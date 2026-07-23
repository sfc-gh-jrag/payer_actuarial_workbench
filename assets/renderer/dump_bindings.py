#!/usr/bin/env python3
"""Dump the 3 APPROVED conformance tables to the JSON bindings render.py consumes.

Deterministic seam between Phase-2 (approved rows) and Phase-3 (render.py reads
elements.json / relationships.json / crosswalk.json). The conformance table
columns already match the keys render.py expects, so this is a straight
SELECT ... WHERE MAPPING_STATUS='APPROVED' per table, written out as JSON.

Usage:
  python3 dump_bindings.py --conn <name> --database <DB> --schema <SCHEMA> --out <dir>

Requires the Snowflake CLI (`snow`) on PATH. Read-only (SELECT only).
"""
import argparse
import json
import os
import subprocess
import sys

TABLES = {
    "ACCELERATOR_CORE_ELEMENTS": (
        "elements.json",
        ["ELEMENT_ID", "LOGICAL_OBJECT", "SOURCE_DATABASE", "SOURCE_SCHEMA",
         "SOURCE_OBJECT", "SOURCE_COLUMN", "STAGE_PATH", "TRANSFORM_EXPRESSION"],
    ),
    "ACCELERATOR_CORE_RELATIONSHIPS": (
        "relationships.json",
        ["RELATIONSHIP_ID", "REL_KIND", "LEFT_OBJECT", "LEFT_COLUMN",
         "RIGHT_OBJECT", "RIGHT_COLUMN", "CARDINALITY", "JOIN_CONDITION"],
    ),
    "ACCELERATOR_CORE_CODE_CROSSWALK": (
        "crosswalk.json",
        ["ELEMENT_ID", "SOURCE_VALUE", "CANONICAL_VALUE", "SEMANTIC_ROLE"],
    ),
}


def run_query(conn, sql):
    cmd = ["snow", "sql", "--format", "json", "--query", sql]
    if conn:
        cmd += ["-c", conn]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"snow sql failed for query:\n{sql}\n{proc.stderr or proc.stdout}")
    out = proc.stdout.strip()
    if not out:
        return []
    try:
        data = json.loads(out)
    except json.JSONDecodeError as e:
        sys.exit(f"Could not parse snow sql JSON output: {e}\n---\n{out[:2000]}")
    return data if isinstance(data, list) else [data]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--conn", help="Snowflake CLI connection name")
    ap.add_argument("--database", required=True)
    ap.add_argument("--schema", required=True)
    ap.add_argument("--out", required=True, help="bindings output dir")
    a = ap.parse_args()

    os.makedirs(a.out, exist_ok=True)
    summary = {}
    for table, (fname, cols) in TABLES.items():
        collist = ", ".join(cols)
        sql = (f"SELECT {collist} FROM {a.database}.{a.schema}.{table} "
               f"WHERE MAPPING_STATUS = 'APPROVED'")
        rows = run_query(a.conn, sql)
        rows = [{k.upper(): v for k, v in r.items()} for r in rows]
        path = os.path.join(a.out, fname)
        with open(path, "w") as f:
            json.dump(rows, f, indent=2)
        summary[fname] = len(rows)

    print(json.dumps({"out": a.out, "written": summary}, indent=2))
    if summary.get("elements.json", 0) == 0:
        sys.exit("No APPROVED elements found - run/finish Phase 2 (conformance-review) first.")


if __name__ == "__main__":
    main()
