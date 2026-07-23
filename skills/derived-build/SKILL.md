---
name: derived-build
description: "Phase 3 of the Actuarial Workbench deployment. Renders the derived actuarial data product (exposure, unified paid fact, PMPM history, triangle + IBNR views, normalized RAF, work-paper store, semantic view, agent) from templates bound to the customer's approved conformance tables, then deploys them in dependency order and validates. Triggers: actuarial workbench build, derived build, generate actuarial data product, deploy actuarial objects, phase 3 actuarial."
---

# Phase 3 — Generate & Deploy the Derived Actuarial Data Product

Turn the approved conformance tables + accelerator templates into live objects in the target schema. This is the deterministic core of the accelerator.

## Preconditions
- Phase 2 readiness gate PASSED (re-check here; refuse to build on FAIL).
- `TARGET_DATABASE.TARGET_SCHEMA` exists and the current role can create objects in it.
- A warehouse (`config.warehouse`, e.g. `<YOUR_REFRESH_WAREHOUSE>`) is available for dynamic-table refresh.

## Paths & connection (set once)
- `PLUGIN_DIR`, `WORKDIR=$(mktemp -d)`, `CONN`, `CONFIG` (as in Phase 2).

## Change tracking (incremental DTs)
The fact Dynamic Tables refresh incrementally, which requires `CHANGE_TRACKING = TRUE` on the mapped core base tables (medical header/line, pharmacy claims, member-month, POS reference). `CREATE DYNAMIC TABLE` auto-enables it when the role has privilege; if not, run the `ALTER TABLE ... SET CHANGE_TRACKING = TRUE` statements the manifest lists first. This is an accepted metadata change on the core source.

## Build engine
1. Load `$PLUGIN_DIR/assets/build_manifest.yaml` — the ordered target objects. Each entry declares `object_name`, `object_type` (dynamic_table | table | view | semantic_view | agent | script), `template`, `grain`, `consumes` (element/relationship IDs), `params` (refresh_mode, target_lag, risk_score_anchor), `depends_on`, `readiness`.
2. **Dump the approved bindings** to the JSON the renderer consumes (deterministic, APPROVED-only):
   ```bash
   python3 "$PLUGIN_DIR/assets/renderer/dump_bindings.py" --conn "$CONN" \
     --database <TARGET_DATABASE> --schema <TARGET_SCHEMA> --out "$WORKDIR/bindings"
   ```
3. Run `render.py` (deterministic Jinja) over those bindings to render each template to SQL DDL. The renderer is the single source of truth for placeholder resolution — do NOT hand-author DDL.
   ```bash
   python3 "$PLUGIN_DIR/assets/renderer/render.py" --bindings "$WORKDIR/bindings" \
     --manifest "$PLUGIN_DIR/assets/build_manifest.yaml" --templates "$PLUGIN_DIR/assets/templates" \
     --out "$WORKDIR/rendered" --config "$CONFIG"
   ```
4. Deploy in `depends_on` order using `CREATE OR REPLACE` (idempotent) via `snow sql -c "$CONN"`.

## Build order (from manifest)
`DT_MEMBER_MONTHS` + `DT_PAID_FACT` (incremental facts) -> `DT_PMPM_HISTORY` + `DT_MEMBER_RISK_SCORE` (FULL) -> `V_CLAIM_TRIANGLE` + `V_IBNR_COMPLETION` (views) -> work-paper store (`WORK_PAPER` / `ASSUMPTION_LEDGER` / `RESERVE_ESTIMATE` / `RATE_BUILDUP`) -> `SV_ACTUARIAL_INTELLIGENCE` -> `AGT_ACTUARIAL_WORKBENCH`.

## Refresh-mode expectations
- `DT_MEMBER_MONTHS`, `DT_PAID_FACT`, `DT_PMPM_HISTORY` should resolve to **INCREMENTAL** — verify via `refresh_mode_reason` (see checks).
- `DT_MEMBER_RISK_SCORE` is intentionally **FULL** (LOB-wide normalization); it is a leaf (nothing incremental depends on it).

## Validate
Run `$PLUGIN_DIR/assets/validate/checks.sql` (with `{{TARGET_DATABASE}}`/`{{TARGET_SCHEMA}}` substituted). It returns `CHECK_NAME | STATUS | DETAIL`:
- **FAIL** (must fix): required facts/views empty (`DT_MEMBER_MONTHS`, `DT_PAID_FACT`, `DT_PMPM_HISTORY`, `V_CLAIM_TRIANGLE`), any required fact DT not INCREMENTAL, or `DT_MEMBER_RISK_SCORE` not FULL.
- **WARN** (informational): optional-backed content empty (RAF when no enrollment, rebates, price history), or RAF mean outside the advisory band.
Report the table. Proceed only when there are no FAILs (WARNs are fine).

## Hand-off
On PASS, tell the user to run `/actuarial-workbench:app-deploy`.

> This skill (plus the manifest, templates, and renderer) is the make-or-break asset — the deterministic core validated against the reference derived spec.
