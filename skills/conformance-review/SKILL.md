---
name: conformance-review
description: "Phase 2 of the Actuarial Workbench deployment. Iterative human-in-the-loop review of the 3 conformance tables: promote PROPOSED mappings to APPROVED, adjust or add rows, run a deterministic readiness gate + a render preflight before the derived build. Triggers: actuarial workbench review, conformance review, finalize mappings, approve conformance, phase 2 actuarial, readiness gate."
---

# Phase 2 - Conformance Review Loop

Walk the customer through finalizing the three conformance tables until the accelerator can build. Nothing here deploys the data product.

## Paths & connection (set once)
- `PLUGIN_DIR` - the plugin root (the directory containing `.cortex-plugin/`).
- `WORKDIR` - a fresh scratch dir: `WORKDIR=$(mktemp -d)`.
- `CONN` - the Snowflake CLI connection name.
- `CONFIG` - path to the customer's `config.json`.

## Loop
1. Show current `ACCELERATOR_CORE_ELEMENTS` / `_RELATIONSHIPS` / `_CODE_CROSSWALK` rows, grouped by `MAPPING_STATUS`, highlighting:
   - `IS_REQUIRED = TRUE` elements still `PROPOSED`, unmapped (NULL source), or seeded-but-empty — especially `MCH_CLAIM_PAID_DATE`.
   - Relationships with a missing endpoint.
   - Coded elements with raw values not yet crosswalked.
2. Let the customer approve, edit, remove, or add rows. Apply with UPDATE/INSERT/DELETE, set `MAPPING_STATUS='APPROVED'` on accepted rows and refresh `UPDATED_AT`.
3. Re-run the readiness gate (below). Repeat until it PASSES.

## Readiness gate (deterministic SQL)
Run `$PLUGIN_DIR/assets/validate/readiness_gate.sql` with `{{TARGET_DATABASE}}`/`{{TARGET_SCHEMA}}` substituted. It returns `CHECK_NAME | STATUS | DETAIL` for three structural checks:
- `REQUIRED_ELEMENTS_MAPPED` - every `IS_REQUIRED` element is `APPROVED` and bound (physical column or `STAGE_PATH`).
- `REQUIRED_RELATIONSHIPS_MAPPED` - every `IS_REQUIRED` relationship is `APPROVED` with both endpoints resolved.
- `CROSSWALK_CANONICAL_COVERAGE` - no approved crosswalk row is missing a `CANONICAL_VALUE`.

Show the PASS/FAIL table; on any FAIL, list exactly what is missing and loop back to step 2. Do NOT proceed while any check is FAIL.

> Paid-date policy: if the customer confirms there is no valid medical paid date, that is a deliberate decision — mark `MCH_CLAIM_PAID_DATE` as APPROVED with a `TRANSFORM_EXPRESSION` that supplies the fallback (or accept the gate FAIL and run reserving via the completion-factor method only). Record the choice in `TRANSFORM_NOTES` so Phase 3 renders the right triangle source.

## Render preflight (catch contract gaps before deploy)
After the gate PASSES, prove every template resolves against the approved bindings BEFORE Phase 3 touches the account:
1. Dump the approved bindings:
   ```bash
   python3 "$PLUGIN_DIR/assets/renderer/dump_bindings.py" --conn "$CONN" \
     --database <TARGET_DATABASE> --schema <TARGET_SCHEMA> --out "$WORKDIR/bindings"
   ```
2. Render EVERY manifest object (no deploy). `render.py` uses `StrictUndefined`, so any unmapped element/relationship raises immediately:
   ```bash
   python3 "$PLUGIN_DIR/assets/renderer/render.py" --bindings "$WORKDIR/bindings" \
     --manifest "$PLUGIN_DIR/assets/build_manifest.yaml" --templates "$PLUGIN_DIR/assets/templates" \
     --out "$WORKDIR/preflight" --config "$CONFIG"
   ```
   A `KeyError`/`StrictUndefined` here means a required element or relationship the templates need is still unmapped — return to step 2. Rendering is local only; nothing is deployed.

If the dump reports `No APPROVED elements`, the gate has not truly passed — loop back.

## Hand-off
When the gate PASSES and the render preflight renders all objects cleanly, tell the user to run `/actuarial-workbench:derived-build`.
