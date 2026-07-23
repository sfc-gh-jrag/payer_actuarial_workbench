---
name: conformance-discover
description: "Phase 1 of the Actuarial Workbench deployment. Profiles the customer's Snowflake payer core and proposes rows for the 3 conformance tables (elements, relationships, code crosswalk) that bind their data to the accelerator's canonical actuarial contract. Triggers: actuarial workbench discover, conformance discover, map my source to actuarial accelerator, start actuarial workbench, phase 1 actuarial."
---

# Phase 1 - Conformance Discovery

Map the customer's source objects to the accelerator's **canonical logical contract** by proposing rows for the three conformance tables. Assisted, not fully automatic: everything you write is `PROPOSED` and is finalized in Phase 2.

## Paths & connection (set once)
- `PLUGIN_DIR` - the plugin root (the directory containing `.cortex-plugin/`). The contract lives at `$PLUGIN_DIR/assets/contract/`.
- `CONN` - the Snowflake CLI connection name (`snow ... -c "$CONN"`).
- `CONFIG` - the customer's `config.json` (copy from `$PLUGIN_DIR/assets/config.sample.json` and edit).

## Naming seam (read first)
- The contract's element id field is `LOGICAL_ID` (in `logical_elements.json`); the conformance table column is `ELEMENT_ID`. **`ELEMENT_ID` == `LOGICAL_ID`** — copy verbatim.
- `LOGICAL_OBJECT` on each element = the `objects[].id` it belongs to (from `logical_objects.json`).
- Relationship ids and their canonical endpoints come from `logical_relationships.json`.

## Inputs to collect (ask once, concisely)
- Target for the derived data product: `TARGET_DATABASE.TARGET_SCHEMA` (created if absent).
- Customer source databases/schemas to search (medical claims, pharmacy claims, membership/eligibility, reference, and — if present — enrollment, plan-trend, rebates, price history).
- Whether a valuation anchor / period clock exists (else default to `max(paid_date)`).

## The canonical contract (accelerator-owned, read from `$PLUGIN_DIR/assets/contract/`)
- `logical_elements.json` - business elements (`LOGICAL_ID`, `LABEL`, `TIER`, `LOGICAL_OBJECT`, `DATA_TYPE`, `IS_REQUIRED`).
- `logical_objects.json` - the logical objects + which are `required`.
- `logical_relationships.json` - the canonical join graph.
- `canonical_vocabulary.json` - canonical values coded columns must crosswalk to.

## Steps
1. **Create the conformance tables** in `TARGET_DATABASE.TARGET_SCHEMA` (idempotent) using `$PLUGIN_DIR/assets/contract/conformance_tables.sql` with `{{TARGET_DATABASE}}`/`{{TARGET_SCHEMA}}` substituted (via `snow sql -c "$CONN"`): `ACCELERATOR_CORE_ELEMENTS`, `ACCELERATOR_CORE_RELATIONSHIPS`, `ACCELERATOR_CORE_CODE_CROSSWALK` (each has `MAPPING_STATUS` = `PROPOSED` | `APPROVED`).

2. **Seed the required skeleton (deterministic gate enabler).** Insert one `PROPOSED` row per **required** contract item so the Phase-2 gate is a pure structural check:
   - one `ACCELERATOR_CORE_ELEMENTS` row per element with `IS_REQUIRED = TRUE` in `logical_elements.json` (`ELEMENT_ID`, `ELEMENT_NAME`, `LOGICAL_OBJECT`, `IS_REQUIRED=TRUE`, `SOURCE_*` left NULL for now);
   - one `ACCELERATOR_CORE_RELATIONSHIPS` row per relationship with `REQUIRED = TRUE` in `logical_relationships.json`.
   Optional elements/relationships are added only when matched.

3. **Profile the customer source (read-only) and match.** Launch the `conformance-mapper` agent, or profile directly with `INFORMATION_SCHEMA.COLUMNS` + bounded distinct-value scans. Never invent a column profiling did not confirm.

4. **Medical paid-date check (do not skip).** The single highest-risk required element is `MCH_CLAIM_PAID_DATE`. Verify the candidate genuinely lags service/discharge (distribution of `DATEDIFF('day', service_through, candidate)` and `COUNT(DISTINCT DATE_TRUNC('month', candidate))`). A bulk-load timestamp spanning 1-2 months is NOT a paid date — record it as a gap and note that reserving will fall back to the completion-factor method (`V_IBNR_COMPLETION`) using `COMPLETION_FACTOR_REF`.

5. **Fill / add element rows.** For each matched element: UPDATE the seeded required row (or INSERT a PROPOSED row for optional elements) with `SOURCE_DATABASE/SCHEMA/OBJECT/COLUMN`, `DATA_TYPE`, `SOURCE_GRAIN`, optional `TRANSFORM_EXPRESSION` (`{a}` = alias), and `TRANSFORM_NOTES` (rationale + confidence). Leave genuinely unmatched required elements with NULL source (the gate will flag them).

6. **Instantiate relationships.** For each relationship whose BOTH endpoint objects matched, set physical `LEFT_OBJECT/LEFT_COLUMN` + `RIGHT_OBJECT/RIGHT_COLUMN`, carry `CARDINALITY`/`REL_KIND`, set `JOIN_CONDITION`. Note the two claim->member-month joins are on member id **and** incurred-month = eligibility-month.

7. **Crosswalk coded values.** For each coded element (LOB, claim status, reversal flag, specialty/generic, setting/inpatient flag, benefit type), map observed raw values to `canonical_vocabulary.json`; flag any raw value with no canonical target.

8. **Discovery report (do NOT build).** Summarize matched vs unmatched **required** elements/relationships, low-confidence matches, uncrosswalked coded values, the paid-date finding, and which OPTIONAL objects are absent (so the user knows which arms will be `present()`-gated off — e.g., no PLAN_TREND => projection assumptions are actuary-entered; no REBATE_SOURCE => Rx net = gross).

## Hand-off
Tell the user to run `/actuarial-workbench:conformance-review` to finalize.

> Keep proposals conservative; never invent a column that does not exist. Everything here is `PROPOSED` — Phase 2 approves.
