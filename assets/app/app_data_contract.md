# Actuarial Workbench — App Data Contract

**Purpose.** The binding spec between the workbench app (per `actuarial-workbench-mockup.html`) and the deployed derived data product. Every mockup surface maps to a live backing endpoint. The app is a thin client over these objects via the Snowflake SQL API.

- **Schema:** all objects live in `{target_database}.{target_schema}` (referred to below as `{S}`; rendered from `config.json` at deploy time into `lib/app_target.ts`).
- **Data posture:** every analytical surface derives live from the core → derived layer. The transactional tables start **empty** and populate through app use (see §Write endpoints). **No seed data.**
- **Global slicers** (workbench top bar) map to columns present on nearly every read object:
  - **LOB** → `line_of_business` (`Medicare Advantage`, `Commercial`)
  - **Constituent** → `constituent` (`Medical`, `Pharmacy`)
  - **Segment** → `service_category` (`Inpatient`/`Outpatient`/`Professional`/`Other`; `Specialty Rx`/`Brand Rx`/`Generic Rx`)
- **Anchor / DEMO_CLOCK** = 2026-06 (censoring is applied on-read; app passes no dates for reserving/triangle).

---

## Tab 1 — Reserve (IBNR close)

### Read
| Surface | Object | Grain | Key columns | Filters |
|---|---|---|---|---|
| Development triangle | `{S}.V_CLAIM_TRIANGLE` | LOB × constituent × service_category × incurred_month × dev_lag | `dev_lag, incremental_paid, cumulative_paid` | LOB, constituent, (segment). App divides `cumulative_paid` by member-months for PMPM triangle. |
| Completion-factor IBNR | `{S}.V_IBNR_COMPLETION` | LOB × constituent × incurred_month | `paid_to_date, reference_cf, override_cf, completion_factor, cf_source, ultimate_incurred, ibnr` | LOB, constituent. `cf_source` = MODELED/OVERRIDE drives the override badge. |
| Method switch (CL/BF/CapeCod) | `TABLE({S}.TF_RESERVE_BY_METHOD(method, tail, pooling_point, apriori_pmpm))` | LOB × constituent × incurred_month | `paid_to_date, completion_factor, ultimate, ibnr` | Args: `method` ∈ CHAIN_LADDER/BORNHUETTER_FERGUSON/CAPE_COD; defaults from `config.default_reserving`. |
| Reserve snapshot (fast read) | `{S}.DT_RESERVE_BY_METHOD` | LOB × constituent × incurred_month | chain-ladder at default params | — |
| Roll-forward + booked components + GL tie-out | `{S}.V_RESERVE_ROLLFORWARD` | valuation_month × LOB × constituent | `beginning_reserve, incurred_in_period, paid_in_period, ending_reserve, case/ibnp/ibnr_booked/lae/pfad, derived_ibnr, reserve_vs_gl_variance, margin_over_booked_pct` | LOB, constituent |
| Large-claim pooling | `{S}.V_LARGE_CLAIM_POOL` | LOB × constituent × incurred_month | `total_paid, pooled_excess, pooled_capped, large_claim_count, pooled_excess_pmpm` | LOB, constituent. Pool point = `config.default_reserving.pooling_point` ($250k). |
| Actual-to-expected | `{S}.V_ACTUAL_TO_EXPECTED` | LOB × constituent × incurred_month | `prior_valuation, current_valuation, expected_ultimate, restated_ultimate, development, ae_ratio, development_signal` | LOB, constituent. Live from real paid-date censoring (no snapshots needed). |
| Tornado / sensitivity | `TABLE({S}.TF_RESERVE_BY_METHOD(...))` called with varied `tail`/`pooling_point` | — | app builds the tornado by diffing IBNR across parameter sweeps | — |

### Write
| Action | Endpoint | Notes |
|---|---|---|
| Override a completion factor (modal) | `CALL {S}.SP_APPLY_CF_OVERRIDE(work_paper_id, lob, constituent, incurred_month, override_cf, rationale, author)` | Writes `RESERVE_CF_OVERRIDE` + `ASSUMPTION_LEDGER` audit row atomically; `V_IBNR_COMPLETION` immediately reflects it. |
| Save a valuation snapshot | `CALL {S}.SP_SAVE_RESERVE_ESTIMATE(work_paper_id, valuation_date, method, tail, pooling, apriori)` | Persists a run into `RESERVE_ESTIMATE`. |

---

## Tab 2 — Study (trend & experience)

### Read
| Surface | Object | Grain | Key columns |
|---|---|---|---|
| Experience exhibit | `{S}.V_TREND_DECOMP` | LOB × constituent × service_category × incurred_month | `units_per_1000, unit_cost, pmpm, yoy_trend_pct, util_effect, unitcost_effect, interaction_effect, is_mature` |
| Completed base series | `{S}.V_TREND_COMPLETED` | LOB × constituent × incurred_month | `paid_pmpm, completed_pmpm, completion_factor, lag_from_anchor` |
| Modeled trend + backtest | `{S}.V_TREND_SELECTED` | LOB × constituent | `annualized_trend, freq_trend, severity_trend, backtest_mape, n_months` |
| Trend build-up bridge | `{S}.V_TREND_SUMMARY` | LOB × constituent × step | `step_seq, component, delta_pmpm, basis` |
| Projection | `{S}.V_TREND_PROJECTION` | LOB × constituent | `base_pmpm, selected_trend, projection_years, projected_pmpm, freq_trend, severity_trend, backtest_mape` |

- **Trend method:** completion-factor-completed → log-linear fit on mature months (lag ≥ `config.trend_min_maturity_months`) → actuary-selectable. Filter the exhibit to `is_mature = TRUE` for the latest defensible comparison.
- **Note:** Medical trend ≈ +3.5% (MAPE ~4.5%); Pharmacy runs hot (~44%) due to a real utilization ramp in this book (see spec §8).
- **Normalization toggles:** "Exclude claims > pooling point" → `V_LARGE_CLAIM_POOL`; "Membership-mix normalize" → `V_TREND_DECOMP.interaction_effect`; **"Seasonality-adjust"** is an **actuary lever** (no seasonality model in the backend) — applied app-side and logged via `SP_LOG_ASSUMPTION`.
- **Basis toggle (Allowed/Paid):** the decomposition (`V_TREND_DECOMP`) and trend fit are **allowed-basis**; a Paid view reads `paid_pmpm` from `DT_PMPM_HISTORY`/`V_TREND_COMPLETED`. Full paid-basis frequency×severity decomposition is a documented enhancement, not currently exposed.

### Write
| Action | Endpoint | Notes |
|---|---|---|
| Override the selected trend | `CALL {S}.SP_LOG_ASSUMPTION(work_paper_id, 'Trend', segment, value, 'pct', source_basis, rationale, is_judgment, author)` | Modeled value pre-filled from `V_TREND_SELECTED`; the override is logged to `ASSUMPTION_LEDGER`. |

---

## Tab 3 — Price (bid & rate filing)

### Read
| Surface | Object | Grain | Key columns |
|---|---|---|---|
| Rate build-up seed | `{S}.V_PRICING_INPUT` | LOB × constituent × plan_year | `base_experience_pmpm, manual_pmpm, credibility_z, credibility_blended_pmpm, selected_trend, projected_pmpm, raf_current, raf_normalization_factor, required_pmpm_before_loads` |
| Bid / URRT / BPT checks | `{S}.V_BID_CHECKS` | LOB × constituent × plan_year × check | `check_name, status (PASS/WARN/FAIL), detail` |

- The derivable build-up rows (base → credibility → trend → RAF-norm → required-before-loads) come from `V_PRICING_INPUT`. Judgment rows (benefit/induced util, non-benefit expense, gain/loss margin, premium) are actuary-entered into `RATE_BUILDUP`; `V_BID_CHECKS` re-evaluates MLR/completeness as those are entered.
- **Filing target (MA BPT / Commercial URRT)** and the **basis label** ("MA Part C — Medical") are app-side presentation derived from the LOB/constituent slicers — no backend object needed. **Export to BPT / URRT memo** is an app-side artifact rendered from `V_PRICING_INPUT` + `RATE_BUILDUP` + `V_BID_CHECKS` (no data gap).
- **Bid-check coverage:** `V_BID_CHECKS` computes the checks derivable from available data (trend reasonableness, MLR floor, RAF normalization, credibility, experience completeness, backtest accuracy, rate-buildup completeness). MA-Stars/QBP rebate and negotiated-margin checks require inputs outside the payer core (Stars rating, negotiated margin) — extensible via the same view when those inputs are supplied.

### Write
| Action | Endpoint | Notes |
|---|---|---|
| Save rate build-up steps | `CALL {S}.SP_SAVE_RATE_BUILDUP(work_paper_id, lob, constituent, plan_year, steps_json)` | Atomic replace from a JSON array of `{step_seq, component, value, basis}`. Judgment loads + final required PMPM/premium. Drives `V_BID_CHECKS.MLR_FLOOR` and `RATE_BUILDUP_COMPLETE`. |

---

## Shared — work papers, ledger, trace agent

### System-of-record (all writes via procedures; tables **populate through app use**)
| Object | Role | Written by |
|---|---|---|
| `{S}.WORK_PAPER` | Versioned work paper (`status` DRAFT/REVIEW/SIGNED/FILED, `version_no`, `parent_id`, `signed_by/at`, `filed_at`) | `SP_CREATE_WORK_PAPER`, `SP_BRANCH_WORK_PAPER`, `SP_TRANSITION_WORK_PAPER` |
| `{S}.WORK_PAPER_EVENT` | Append-only lifecycle audit trail (ASOP 41) | the three lifecycle procs (CREATE/BRANCH/STATUS_CHANGE/SIGN/FILE) |
| `{S}.ASSUMPTION_LEDGER` | Every assumption/override with source + rationale + author | `SP_LOG_ASSUMPTION`, `SP_APPLY_CF_OVERRIDE` |
| `{S}.RESERVE_ESTIMATE` | Saved valuation snapshots | `SP_SAVE_RESERVE_ESTIMATE`; also auto-written by `SP_TRANSITION_WORK_PAPER` on SIGN (freeze) |
| `{S}.RESERVE_CF_OVERRIDE` | Active CF overrides consumed by `V_IBNR_COMPLETION` | `SP_APPLY_CF_OVERRIDE` |
| `{S}.RATE_BUILDUP` | Rate build-up steps | `SP_SAVE_RATE_BUILDUP` |

**Rail panels (read):** the work-paper **tree** reads `WORK_PAPER` (`status`, `version_no`, `parent_id`); the **assumption-ledger** panel reads `ASSUMPTION_LEDGER` (filtered by `work_paper_id`); the **history/audit** view reads `WORK_PAPER_EVENT`.

**Work-paper lifecycle procedures (write actions):**

| Proc | Signature | Effect |
|---|---|---|
| Create | `SP_CREATE_WORK_PAPER(name, mode, lob, constituent, segment, valuation_date, created_by)` | New WORK_PAPER (DRAFT, v1); returns `work_paper_id`; logs CREATE. |
| Branch | `SP_BRANCH_WORK_PAPER(source_id, new_name, created_by)` | Clones header (`parent_id`, `version_no`+1, DRAFT) + **deep-copies** ledger, rate build-up, CF overrides; returns new id; logs BRANCH. |
| Transition | `SP_TRANSITION_WORK_PAPER(work_paper_id, to_status, actor, note)` | Enforces `DRAFT->REVIEW->SIGNED->FILED` (+ `REVIEW->DRAFT`); on SIGNED freezes a `RESERVE_ESTIMATE` snapshot + stamps `signed_by/at`; on FILED stamps `filed_at`; logs the event. Illegal transitions return an `error:` string. |
| Delete (draft only) | `SP_DELETE_WORK_PAPER(work_paper_id, actor)` | Deletes a **DRAFT** work paper and its child rows (assumptions, rate build-up, CF overrides, saved estimates). REVIEW/SIGNED/FILED are protected (returns `error: only DRAFT work papers can be deleted (status=...)`). Keeps a `DELETE` tombstone in `WORK_PAPER_EVENT` for audit. |

Status graph: `DRAFT -> REVIEW -> SIGNED -> FILED`, with `REVIEW -> DRAFT` (reopen). Any other transition is rejected.

- **Compare (v9 vs signed base):** app-side diff of two `WORK_PAPER` versions (via `parent_id`) over their `RESERVE_ESTIMATE` snapshots — no dedicated view; a real prior snapshot exists once the base version is SIGNED (sign-time freeze).

### Trace / explain panel
| Surface | Endpoint |
|---|---|
| Derivation-trace agent (explain-only) | `{S}.AGT_ACTUARIAL_WORKBENCH` (Cortex Agent over `{S}.SV_ACTUARIAL_INTELLIGENCE`) |
| Semantic layer (Cortex Analyst) | `{S}.SV_ACTUARIAL_INTELLIGENCE` |

`SV_ACTUARIAL_INTELLIGENCE` is a **multi-fact semantic view** spanning all analytical marts — reserving (`ibnr`, `reserve_method`, `rollforward`, `ae`), pooling (`pool`), trend (`trend_decomp`, `trend_selected`, `trend_projection`, `trend_summary`), pricing (`pricing`, `bidchecks`), and RAF (`risk`). Ratio/derived values (completion factor, IBNR, A/E ratio, PMPM, trend %, credibility, RAF-norm, required PMPM) are exposed as **facts**; simple aggregates as **metrics**. It carries actuary **synonyms** (IBNR, development factor, run-out, PMPM, frequency/severity, MLR, RAF, adverse/favorable…), `AI_SQL_GENERATION` + `AI_QUESTION_CATEGORIZATION` steering, and `AI_VERIFIED_QUERIES` for the workbench trace chips. Validated against Cortex Analyst for the mockup's 6 trace questions plus follow-ups (IBNR derivation, adverse development, trend decomposition, MLR/bid checks, completion-factor-by-lag, RAF by LOB, projected required PMPM). Trace/explain only — the agent does not recommend assumptions or take actions.

---

## Coverage validation (no gaps) — 2026-07-22
Every mockup surface maps to a live, populated backing object. Live evidence (row counts):

| Backend object | Rows | Backs |
|---|---|---|
| `V_CLAIM_TRIANGLE` | 2,711 | Reserve triangle |
| `V_IBNR_COMPLETION` | 144 | IBNR-by-month table + KPIs (override-aware) |
| `DT_RESERVE_BY_METHOD` / `TF_RESERVE_BY_METHOD` | 144 / callable | method switch, Recompute, tornado |
| `V_RESERVE_ROLLFORWARD` | 12 | roll-forward + Reserve-vs-GL tile |
| `V_LARGE_CLAIM_POOL` | 144 (5 large claims) | pooling toggle, large-claim norm |
| `V_ACTUAL_TO_EXPECTED` | 132 | A/E roll-forward |
| `V_TREND_DECOMP` | 286 | experience exhibit |
| `V_TREND_COMPLETED` / `V_TREND_SELECTED` / `V_TREND_SUMMARY` / `V_TREND_PROJECTION` | 144 / 4 / 20 / 4 | trend build-up, headline, projection |
| `V_PRICING_INPUT` | 4 | rate build-up seed |
| `V_BID_CHECKS` | 28 | bid consistency checks |
| `DT_PMPM_HISTORY` / `DT_MEMBER_MONTHS` / `DT_MEMBER_RISK_SCORE` | 430 / 3.34M / 97,592 | PMPM, exposure, RAF |
| 7 procedures + UDTF + `SV_ACTUARIAL_INTELLIGENCE` + `AGT_ACTUARIAL_WORKBENCH` | deployed | all write actions + trace |

**Boundaries (documented, not silent gaps) — none require a missing backend object:**
- **Seasonality** (Study toggle/row) — actuary lever via `SP_LOG_ASSUMPTION`; no seasonality model.
- **Paid-basis decomposition** (Study Basis toggle) — allowed-basis exposed; paid PMPM readable from `DT_PMPM_HISTORY`; full paid decomposition is an enhancement.
- **MA-Stars/QBP rebate & negotiated-margin bid checks** — need inputs outside payer core; `V_BID_CHECKS` is extensible.
- **Filing labels & BPT/URRT export artifact** — app-side presentation/report generation over `V_PRICING_INPUT`/`RATE_BUILDUP`/`V_BID_CHECKS`.
- **Compare (v9 vs base)** — app-side diff over `WORK_PAPER` versions + `RESERVE_ESTIMATE` snapshots (snapshot exists once the base is SIGNED).

**Verdict:** the backend is fully buttoned up for the application — every data-derivable surface and every write action has a live, deployed, plugin-managed object. Remaining items are app-side rendering, actuary-entered judgment, or explicitly-scoped extensions requiring inputs not present in the payer core.

## First-run behavior (no seed)
On a fresh deploy the analytical tabs (Reserve triangle/IBNR/roll-forward/pooling/A-E, Study trend, Price pricing-input/bid-checks) are **fully populated from real core data**. The work-paper list, ledger, saved estimates, overrides, and rate build-up are **empty** — the app creates the first work paper on launch and writes the rest as the actuary works. `V_BID_CHECKS` therefore shows `WARN — not yet entered` on rate-buildup/MLR until the Price tab is used; this is expected and honest.

## Least-privilege grants
The app role (`config.app_role`) needs `USAGE` on DB+schema, `SELECT` on all views/DTs/semantic view, `USAGE` on `TF_RESERVE_BY_METHOD` and all `SP_*` procedures, and (since all writes go through procedures) `SELECT` on the six transactional tables (`WORK_PAPER`, `WORK_PAPER_EVENT`, `ASSUMPTION_LEDGER`, `RESERVE_ESTIMATE`, `RESERVE_CF_OVERRIDE`, `RATE_BUILDUP`). Emitted by `GRANT_APP_ACCESS` (phase: app-deploy).

## Deployment (Phase 4 — app-deploy)
The client is a **Next.js Snowflake App Runtime** app, vendored in the plugin at `assets/app/` and deployed by the `app-deploy` skill via `snow app deploy`. It authenticates with the SPCS service token (owner's rights) and reads/writes the derived layer through a single `SCHEMA` constant rendered from `config.target_database.target_schema` (`lib/app_target.ts`). The app object deploys into `config.app_database.app_schema` — co-located with the derived `target_schema` by default (recommended, zero-config), or a separate schema when required (works because the data FQN is baked into `lib/app_target.ts`). The app-object DB/warehouse/EAI/compute-pool/code-workspace are all config-driven (`snowflake.yml.j2`). The app runs with owner's rights, so the app-owner role must hold read/execute on the derived layer (granted by `GRANT_APP_ACCESS`; a no-op when the owner already owns those objects).
