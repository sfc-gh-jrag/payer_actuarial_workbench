#!/usr/bin/env python3
"""Deterministic renderer for the Actuarial Workbench derived build.

Reads the three conformance bindings (JSON dumps of ACCELERATOR_CORE_ELEMENTS /
_RELATIONSHIPS / _CODE_CROSSWALK), the build_manifest.yaml, and the Jinja SQL
templates, then resolves canonical element / relationship / crosswalk IDs to
physical SQL and writes one .sql file per target object.

No database access -- this is a pure text transform. The derived-build skill
dumps the bindings (via snowflake_sql_execute) and executes the rendered SQL.

Template helpers exposed as Jinja globals:
  tbl(element_id)                 -> fully-qualified source object (DB.SCHEMA.OBJECT)
  c(element_id)                   -> source column name
  col(element_id, alias)          -> "alias.column"
  stage(element_id)               -> stage path (UNSTRUCTURED elements)
  join(rel_id, lalias, ralias)    -> "lalias.LCOL = ralias.RCOL"
  canon(element_id, alias)        -> CASE expr mapping raw code -> canonical value
  target(object_name)             -> TARGET_DATABASE.TARGET_SCHEMA.object_name
  expr(element_id, alias)         -> transform-aware column ref ({a}=alias)
  present(logical_object)         -> True if any element mapped to that logical object
  has_element(id) / has_rel(id)   -> mapping existence checks
  rel_kind(rel_id)                -> equi | expression | temporal
  needs_dedup(rel_id)             -> True if lookup is many-per-key (profiled, else CARDINALITY)
  warehouse, target_lag, cfg      -> config values
"""
import argparse
import json
import os
from pathlib import Path

import yaml
from jinja2 import Environment, FileSystemLoader, StrictUndefined


def load_bindings(bindings_dir):
    d = Path(bindings_dir)

    def rd(name):
        p = d / name
        if not p.exists():
            return []
        return json.load(open(p))

    elements = {r["ELEMENT_ID"]: r for r in rd("elements.json")}
    relationships = {r["RELATIONSHIP_ID"]: r for r in rd("relationships.json")}
    crosswalk = {}
    for r in rd("crosswalk.json"):
        crosswalk.setdefault(r["ELEMENT_ID"], []).append(r)
    return elements, relationships, crosswalk


def build_env(templates_dir, elements, relationships, crosswalk, config):
    def _el(eid):
        if eid not in elements:
            raise KeyError(f"element '{eid}' is not mapped in ACCELERATOR_CORE_ELEMENTS")
        return elements[eid]

    def tbl(eid):
        e = _el(eid)
        return f"{e['SOURCE_DATABASE']}.{e['SOURCE_SCHEMA']}.{e['SOURCE_OBJECT']}"

    def c(eid):
        return _el(eid)["SOURCE_COLUMN"]

    def col(eid, alias):
        return f"{alias}.{_el(eid)['SOURCE_COLUMN']}"

    def stage(eid):
        return _el(eid).get("STAGE_PATH")

    def join(rid, lalias, ralias):
        if rid not in relationships:
            raise KeyError(f"relationship '{rid}' is not mapped in ACCELERATOR_CORE_RELATIONSHIPS")
        r = relationships[rid]
        return f"{lalias}.{r['LEFT_COLUMN']} = {ralias}.{r['RIGHT_COLUMN']}"

    def _sqlstr(v):
        return "'" + str(v).replace("'", "''") + "'"

    def canon(eid, alias):
        rows = crosswalk.get(eid)
        if not rows:
            raise KeyError(f"no crosswalk rows for element '{eid}'")
        col_ref = f"{alias}.{_el(eid)['SOURCE_COLUMN']}"
        groups = {}
        blank_canon = None
        for r in rows:
            sv = r["SOURCE_VALUE"]
            cv = r["CANONICAL_VALUE"]
            if sv is None or str(sv).strip() == "":
                blank_canon = cv
            else:
                groups.setdefault(cv, []).append(sv)
        canon_vals = set(groups.keys())
        if blank_canon is not None:
            canon_vals.add(blank_canon)
        is_bool = canon_vals <= {"TRUE", "FALSE"}

        def lit(cv):
            return cv if is_bool else _sqlstr(cv)

        whens = []
        if blank_canon is not None:
            whens.append(f"WHEN {col_ref} IS NULL OR TRIM({col_ref}) = '' THEN {lit(blank_canon)}")
        for cv, vals in groups.items():
            inlist = ", ".join(_sqlstr(v) for v in vals)
            whens.append(f"WHEN {col_ref} IN ({inlist}) THEN {lit(cv)}")
        return "CASE " + " ".join(whens) + " END"

    def target(obj):
        return f"{config['target_database']}.{config['target_schema']}.{obj}"

    present_objects = {e.get("LOGICAL_OBJECT") for e in elements.values() if e.get("LOGICAL_OBJECT")}
    card_profile = config.get("cardinality_profile", {})

    def present(logical_object):
        return logical_object in present_objects

    def has_element(eid):
        return eid in elements

    def has_rel(rid):
        return rid in relationships

    def expr(eid, alias):
        e = _el(eid)
        tx = e.get("TRANSFORM_EXPRESSION")
        if tx:
            return tx.replace("{a}", alias)
        return f"{alias}.{e['SOURCE_COLUMN']}"

    def rel_kind(rid):
        return relationships.get(rid, {}).get("REL_KIND", "equi")

    def needs_dedup(rid):
        if rid in card_profile:
            return card_profile[rid] > 1
        card = (relationships.get(rid, {}).get("CARDINALITY") or "").upper()
        return "MANY_TO_MANY" in card

    env = Environment(
        loader=FileSystemLoader(str(templates_dir)),
        undefined=StrictUndefined,
        trim_blocks=False,
        lstrip_blocks=False,
        keep_trailing_newline=True,
    )
    env.globals.update(
        tbl=tbl, c=c, col=col, stage=stage, join=join, canon=canon, target=target,
        expr=expr, present=present, has_element=has_element, has_rel=has_rel,
        rel_kind=rel_kind, needs_dedup=needs_dedup,
        cfg=config,
        warehouse=config.get("warehouse", "COMPUTE_WH"),
        target_lag=config.get("target_lag", "1 hour"),
    )
    return env


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bindings", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--templates", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--config", required=True)
    ap.add_argument("--only", nargs="*", help="render only these object_names")
    a = ap.parse_args()

    config = json.load(open(a.config))
    elements, relationships, crosswalk = load_bindings(a.bindings)
    env = build_env(a.templates, elements, relationships, crosswalk, config)
    manifest = yaml.safe_load(open(a.manifest))

    os.makedirs(a.out, exist_ok=True)
    rendered = []
    for obj in manifest["objects"]:
        name = obj["object_name"]
        if a.only and name not in a.only:
            continue
        tmpl = env.get_template(obj["template"])
        sql = tmpl.render(obj=obj, params=obj.get("params", {}))
        outp = Path(a.out) / f"{name}.sql"
        outp.write_text(sql)
        rendered.append(str(outp))
    print(json.dumps({"rendered": rendered}, indent=2))


if __name__ == "__main__":
    main()
