# Actuarial Workbench — Solution Accelerator (CoCo Plugin)

Point Cortex Code at your Snowflake account and deploy the **Actuarial Workbench** on your own payer core — medical + pharmacy claims, membership/exposure, and reference data — no hand-written SQL.

## What it does

The accelerator ships a **canonical logical contract** (the business elements, join graph, and vocabulary an actuarial team needs), **build templates**, and the **workbench app**. You supply only the mapping from your source to that contract. The plugin then generates and deploys the derived actuarial data product and the app.

The workbench spans the full actuarial cycle — **Reserve** (monthly IBNR close on paid-development triangles + actual-to-expected), **Study** (PMPM trend decomposition), and **Price** (MA bid / commercial rate build-up) — as a *workbench*, not a cockpit: editable working surfaces, method selection, override-with-rationale, and versioned work papers.

## Run order (4 phases)

| Phase | Skill | What happens |
|---|---|---|
| 1 | `/actuarial-workbench:conformance-discover` | Profiles your source and proposes rows for the 3 conformance tables (elements, relationships, code crosswalk). |
| 2 | `/actuarial-workbench:conformance-review` | Iterative review loop: you approve/adjust mappings; a readiness gate confirms all required elements are mapped, then a render preflight proves every template resolves. |
| 3 | `/actuarial-workbench:derived-build` | Renders the derived actuarial data product (DT_MEMBER_MONTHS / DT_PAID_FACT / DT_PMPM_HISTORY / V_CLAIM_TRIANGLE / V_IBNR_COMPLETION / DT_MEMBER_RISK_SCORE / work-paper store / SV / Agent) from templates bound to your approved contract, and deploys them in dependency order. |
| 4 | `/actuarial-workbench:app-deploy` | Deploys the bundled workbench app (App Runtime / SPCS) on the derived layer via `snow app deploy`, bakes in the data target, grants read access, and smoke-tests it. |

## Prerequisites

- A role with CREATE DATABASE / SCHEMA / TABLE / DYNAMIC TABLE / VIEW / SEMANTIC VIEW privileges (or a pre-created target DB.SCHEMA with USAGE + CREATE).
- A warehouse for dynamic-table refresh (set as `config.warehouse`, e.g. `<YOUR_REFRESH_WAREHOUSE>`).
- Source **medical claims** (header with incurred **and paid** dates, line detail), **pharmacy claims** (fill + paid dates), **member-month exposure**, a **completion-factor reference**, and a **place-of-service reference**. Optional: member enrollment (RAF/benefit/funding), plan-trend assumptions, rebates, drug-price history.
- A single **valuation anchor** (period clock). If absent, the accelerator can default to `max(paid_date)`.

### Per-account prerequisites (verify before running on a NEW account)
The Snowflake CLI can't fully verify these; confirm them first. Run `assets/validate/preflight_account.sql` for a best-effort automated check.

- **Snowflake CLI + connection**: `snow` installed and a named connection to the target account (used as `-c <conn>` throughout). `snow app setup --help` must succeed (Phase 4).
- **Incremental Dynamic Tables**: the build enables `CHANGE_TRACKING` on the mapped core base tables (an accepted core-side metadata change) so the fact DTs refresh incrementally.
- **Cortex availability in the target region**: Cortex Analyst + a Cortex Agent for the derivation/trace rail; `AI_COMPLETE` with `insight_format_model` (default `claude-opus-4-8`) if narrative insights are enabled.
- **Snowflake App Runtime enabled (Phase 4 only)**: an available compute pool and an external access integration for the container build.
- **Roles**: the role that runs `snow app deploy` becomes the app owner and the grantee for `GRANT_APP_ACCESS`; it must be able to read the derived objects.

## Configuration

Driven by **one file**: a `config.json` you create per customer.

```bash
cp assets/config.sample.json config.json   # then edit
```

The renderer (`assets/renderer/render.py`) reads it as strict JSON (no comments). Derived object names (`DT_*`, `V_*`, `SV_ACTUARIAL_INTELLIGENCE`, `AGT_ACTUARIAL_WORKBENCH`) are accelerator-owned and identical for every customer — baked into the templates, not this file.

| Key | Required | Phase | Meaning |
|---|---|---|---|
| `target_database` | Yes | 1,3,4 | Database for the derived data product + app object. |
| `target_schema` | Yes | 1,3,4 | Schema holding the accelerator-owned objects (fixed names). |
| `warehouse` | Yes | 3,4 | Warehouse for dynamic-table refresh and app queries. |
| `target_lag` | No (default `1 hour`) | 3 | Dynamic-table refresh lag for the incremental facts. |
| `risk_score_anchor` | No | 3 | `{lob: reference_mean}` the derived RAF is normalized to (default `{"Medicare Advantage":1.15,"default":1.00}`). Add a key per LOB — the renderer builds the anchor `CASE` from this dict, so no LOB is hardcoded. |
| `default_reserving` | No | 3 | Default params for the `DT_RESERVE_BY_METHOD` chain-ladder snapshot: `{tail, pooling_point, apriori_pmpm}` (default `{"tail":1.004,"pooling_point":250000,"apriori_pmpm":0}`). The UDTF still accepts per-run overrides. |
| `max_completion_lag` | No (default `12`) | 3 | Highest development-lag month in your completion-factor table; caps the `V_IBNR_COMPLETION` join. |
| `insight_format_model` | No (default `claude-opus-4-8`) | 3 | Model for optional narrative insights. Change if your region lacks it. |
| `cardinality_profile` | No | 3 | `{relationship_id: max_rows_per_key}` measured in Phase 1; `> 1` makes the renderer de-dup that join. |
| `app_name` | No (default `ACTUARIAL_WORKBENCH`) | 4 | Snowflake App object name. |
| `app_stage` | No (default `ACTUARIAL_WORKBENCH_CODE`) | 4 | Code stage (inside `target_schema`). |
| `app_role` | Yes (for grants) | 4 | Grantee in `GRANT_APP_ACCESS`; the role that owns the Application Service. |
| `app_database` | No (default = `target_database`) | 4 | Database hosting the app object + code workspace (App Runtime). |
| `app_schema` | No (default `ACTUARIAL_WORKBENCH`) | 4 | Schema the app object is deployed into (separate from the data `target_schema`). |
| `app_warehouse` | No (default `COMPUTE_WH`) | 4 | Query warehouse the app runs with (`snowflake.yml query_warehouse`). |
| `build_eai` | Yes | 4 | External access integration for the container build (`npm ci`). |
| `code_workspace` | Yes | 4 | Workspace to stage the app source (`DB.SCHEMA.NAME`); auto-created on first `snow app deploy`. |
| `app_valuation_date` | No (default `2026-06-30`) | 4 | Valuation anchor baked into the app (`lib/app_target.ts`). |
| `app_signing_actuary` / `app_signing_actuary_initials` | No | 4 | Author attributed to app writes, baked into `lib/app_target.ts`. |

**Phase 4 (app-deploy)** builds and deploys the bundled Next.js **App Runtime** workbench (vendored under `assets/app/`) via `snow app deploy`. Its `snowflake.yml.j2` + `lib/app_target.ts.j2` are rendered from `config.json` at deploy time, so the app points at your `target_database.target_schema` with nothing hardcoded except config.

## Layout

```
actuarial-workbench/
  .cortex-plugin/plugin.json
  skills/
    conformance-discover/SKILL.md
    conformance-review/SKILL.md
    derived-build/SKILL.md
    app-deploy/SKILL.md
  agents/conformance-mapper.md
  assets/
    contract/          # canonical logical contract (accelerator-owned):
                       #   logical_elements.json, logical_objects.json,
                       #   logical_relationships.json, canonical_vocabulary.json,
                       #   conformance_tables.sql
    templates/         # Jinja SQL templates for the derived objects  (next tranche)
    build_manifest.yaml
    config.sample.json # copy -> config.json, edit per customer
    renderer/
      render.py        # bindings + templates -> SQL DDL
      dump_bindings.py # APPROVED conformance tables -> elements/relationships/crosswalk JSON
    validate/
      readiness_gate.sql # Phase 2 structural gate (PASS/FAIL)
      checks.sql         # Phase 3 post-build validation (PASS/FAIL/WARN)
      preflight_account.sql
    app/               # workbench app (Next.js App Runtime) + snowflake.yml.j2  (next tranche)
```

## Accelerator-owned vs customer-specific

- **Accelerator-owned (ships here):** logical contract, SQL/agent templates, reserving/trend/pricing algorithms, semantic view + agent, the app, and `build_manifest.yaml`.
- **Customer-specific (produced at runtime):** the 3 populated conformance tables. Nothing else.

> Reserving note: the paid-development triangle and actual-to-expected require a per-claim **paid/processed date** on medical claims. If your medical source lacks one, the accelerator falls back to the completion-factor method (`V_IBNR_COMPLETION`) using your completion-factor reference; the triangle then reflects that seeded pattern rather than raw run-out.

> Build status: **Tranche A** (backbone + contract + phased skills + manifest + renderer + validation) is present. **Templates** (`assets/templates/*.j2`) and the **app** (`assets/app/`) are the next tranches.
