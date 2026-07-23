import { querySnowflake, querySnowflakeLongRunning } from "@/lib/snowflake"
import { SCHEMA, type Constituent, type Lob, type ReserveMethod } from "@/lib/constants"
import type {
  AeRow, BidCheck, IbnrRow, LedgerEntry, MethodRow, PoolRow, PricingInput,
  RateBuildupStep, RollforwardRow, Slice, Triangle, TriangleRow, TrendDecompRow,
  TrendProjection, TrendSelected, TrendSummaryRow, WorkPaper, WorkPaperEvent,
} from "@/lib/types"

/* ---------- guards / escaping ---------- */
const q = (s: string) => `'${String(s).replace(/'/g, "''")}'`
const LOBS = new Set(["Medicare Advantage", "Commercial"])
const CONSTS = new Set(["Medical", "Pharmacy"])
const METHODS = new Set(["CHAIN_LADDER", "BORNHUETTER_FERGUSON", "CAPE_COD"])
function assertSlice(s: Slice) {
  if (!LOBS.has(s.lob)) throw new Error(`Invalid LOB: ${s.lob}`)
  if (!CONSTS.has(s.constituent)) throw new Error(`Invalid constituent: ${s.constituent}`)
}
const num = (v: unknown): number => (v == null ? 0 : Number(v))
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v))
/** Normalize a Snowflake DATE/TIMESTAMP (SDK may return a JS Date) to YYYY-MM-DD. */
const iso = (v: unknown): string => {
  if (v == null) return ""
  if (v instanceof Date) {
    const y = v.getUTCFullYear()
    const m = String(v.getUTCMonth() + 1).padStart(2, "0")
    const d = String(v.getUTCDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  }
  return String(v).slice(0, 10)
}

/* ================= RESERVE ================= */

export async function getTriangle(s: Slice): Promise<Triangle> {
  assertSlice(s)
  const segFilter = s.segment ? `AND service_category = ${q(s.segment)}` : ""
  const rows = await querySnowflake(`
    SELECT incurred_month, dev_lag, SUM(cumulative_paid) AS cum
    FROM ${SCHEMA}.V_CLAIM_TRIANGLE
    WHERE line_of_business = ${q(s.lob)} AND constituent = ${q(s.constituent)} ${segFilter}
    GROUP BY 1, 2 ORDER BY 1, 2
  `)
  // member months per incurred month (for PMPM basis)
  const mm = await getMemberMonths(s.lob)

  const lagSet = new Set<number>()
  const byMonth = new Map<string, Map<number, number>>()
  for (const r of rows) {
    const m = iso(r.INCURRED_MONTH)
    const lag = num(r.DEV_LAG)
    lagSet.add(lag)
    if (!byMonth.has(m)) byMonth.set(m, new Map())
    byMonth.get(m)!.set(lag, num(r.CUM))
  }
  const lags = [...lagSet].sort((a, b) => a - b)
  const months = [...byMonth.keys()].sort()
  // show the most recent 12 incurred months (triangle window)
  const window = months.slice(-12)
  const triRows: TriangleRow[] = window.map((m) => {
    const cells = lags.map((l) => {
      const v = byMonth.get(m)!.get(l)
      return v == null ? null : v
    })
    return { incurredMonth: m, cells, memberMonths: mm.get(m) ?? 0 }
  })
  return { lags, rows: triRows, basis: "dollars" }
}

/** Member-months per incurred/eligibility month for a LOB (grouped scan). */
export async function getMemberMonths(lob: Lob): Promise<Map<string, number>> {
  if (!LOBS.has(lob)) throw new Error(`Invalid LOB: ${lob}`)
  const rows = await querySnowflakeLongRunning(`
    SELECT eligibility_month, SUM(member_month_fraction) AS mm
    FROM ${SCHEMA}.DT_MEMBER_MONTHS
    WHERE line_of_business = ${q(lob)}
    GROUP BY 1 ORDER BY 1
  `)
  const map = new Map<string, number>()
  for (const r of rows) map.set(iso(r.ELIGIBILITY_MONTH), num(r.MM))
  return map
}

export async function getIbnr(s: Slice): Promise<IbnrRow[]> {
  assertSlice(s)
  const rows = await querySnowflake(`
    SELECT incurred_month, lag_from_anchor, paid_to_date, reference_cf, override_cf,
           completion_factor, cf_source, ultimate_incurred, ibnr
    FROM ${SCHEMA}.V_IBNR_COMPLETION
    WHERE line_of_business = ${q(s.lob)} AND constituent = ${q(s.constituent)}
    ORDER BY incurred_month
  `)
  return rows.map((r) => ({
    incurredMonth: iso(r.INCURRED_MONTH),
    lagFromAnchor: num(r.LAG_FROM_ANCHOR),
    paidToDate: num(r.PAID_TO_DATE),
    referenceCf: numOrNull(r.REFERENCE_CF),
    overrideCf: numOrNull(r.OVERRIDE_CF),
    completionFactor: num(r.COMPLETION_FACTOR),
    cfSource: String(r.CF_SOURCE ?? "MODELED"),
    ultimateIncurred: num(r.ULTIMATE_INCURRED),
    ibnr: num(r.IBNR),
  }))
}

/** Total IBNR per reserving method (method-comparison strip). */
export async function getMethodComparison(
  s: Slice, tail: number, pooling: number, apriori = 450,
): Promise<{ method: ReserveMethod; totalIbnr: number }[]> {
  assertSlice(s)
  const methods: ReserveMethod[] = ["CHAIN_LADDER", "BORNHUETTER_FERGUSON", "CAPE_COD"]
  const t = Number(tail) || 1.004
  const p = Number(pooling) || 250000
  const a = Number(apriori) || 0
  const sql = methods.map((m) => `
    SELECT ${q(m)} AS method, SUM(GREATEST(ibnr, 0)) AS tot
    FROM TABLE(${SCHEMA}.TF_RESERVE_BY_METHOD(${q(m)}, ${t}::FLOAT, ${p}::FLOAT, ${a}::FLOAT))
    WHERE line_of_business = ${q(s.lob)} AND constituent = ${q(s.constituent)}
  `).join(" UNION ALL ")
  const rows = await querySnowflake(sql)
  const byMethod = new Map(rows.map((r) => [String(r.METHOD), num(r.TOT)]))
  return methods.map((m) => ({ method: m, totalIbnr: byMethod.get(m) ?? 0 }))
}

export async function getRollforward(s: Slice): Promise<RollforwardRow[]> {
  assertSlice(s)
  const rows = await querySnowflake(`
    SELECT valuation_month, beginning_reserve, incurred_in_period, paid_in_period,
           ending_reserve, case_reserve, ibnp_reserve, ibnr_booked, lae_reserve,
           pfad_margin, derived_ibnr, reserve_vs_gl_variance, margin_over_booked_pct
    FROM ${SCHEMA}.V_RESERVE_ROLLFORWARD
    WHERE line_of_business = ${q(s.lob)} AND constituent = ${q(s.constituent)}
    ORDER BY valuation_month
  `)
  return rows.map((r) => ({
    valuationMonth: iso(r.VALUATION_MONTH),
    beginningReserve: num(r.BEGINNING_RESERVE),
    incurredInPeriod: num(r.INCURRED_IN_PERIOD),
    paidInPeriod: num(r.PAID_IN_PERIOD),
    endingReserve: num(r.ENDING_RESERVE),
    caseReserve: num(r.CASE_RESERVE),
    ibnpReserve: num(r.IBNP_RESERVE),
    ibnrBooked: num(r.IBNR_BOOKED),
    laeReserve: num(r.LAE_RESERVE),
    pfadMargin: num(r.PFAD_MARGIN),
    derivedIbnr: num(r.DERIVED_IBNR),
    reserveVsGlVariance: num(r.RESERVE_VS_GL_VARIANCE),
    marginOverBookedPct: num(r.MARGIN_OVER_BOOKED_PCT),
  }))
}

export async function getActualToExpected(s: Slice): Promise<AeRow[]> {
  assertSlice(s)
  const rows = await querySnowflake(`
    SELECT incurred_month, prior_valuation, current_valuation, expected_ultimate,
           restated_ultimate, development, ae_ratio, development_signal
    FROM ${SCHEMA}.V_ACTUAL_TO_EXPECTED
    WHERE lob = ${q(s.lob)} AND constituent = ${q(s.constituent)}
    ORDER BY incurred_month
  `)
  return rows.map((r) => ({
    incurredMonth: iso(r.INCURRED_MONTH),
    priorValuation: iso(r.PRIOR_VALUATION),
    currentValuation: iso(r.CURRENT_VALUATION),
    expectedUltimate: num(r.EXPECTED_ULTIMATE),
    restatedUltimate: num(r.RESTATED_ULTIMATE),
    development: num(r.DEVELOPMENT),
    aeRatio: num(r.AE_RATIO),
    developmentSignal: String(r.DEVELOPMENT_SIGNAL ?? ""),
  }))
}

export async function getLargeClaimPool(s: Slice): Promise<PoolRow[]> {
  assertSlice(s)
  const rows = await querySnowflake(`
    SELECT incurred_month, total_paid, pooled_excess, pooled_capped,
           large_claim_count, member_months, pooled_excess_pmpm
    FROM ${SCHEMA}.V_LARGE_CLAIM_POOL
    WHERE line_of_business = ${q(s.lob)} AND constituent = ${q(s.constituent)}
    ORDER BY incurred_month
  `)
  return rows.map((r) => ({
    incurredMonth: iso(r.INCURRED_MONTH),
    totalPaid: num(r.TOTAL_PAID),
    pooledExcess: num(r.POOLED_EXCESS),
    pooledCapped: num(r.POOLED_CAPPED),
    largeClaimCount: num(r.LARGE_CLAIM_COUNT),
    memberMonths: num(r.MEMBER_MONTHS),
    pooledExcessPmpm: num(r.POOLED_EXCESS_PMPM),
  }))
}

/* ================= STUDY ================= */

export async function getTrendSummary(s: Slice): Promise<TrendSummaryRow[]> {
  assertSlice(s)
  const rows = await querySnowflake(`
    SELECT step_seq, component, delta_pmpm, basis
    FROM ${SCHEMA}.V_TREND_SUMMARY
    WHERE line_of_business = ${q(s.lob)} AND constituent = ${q(s.constituent)}
    ORDER BY step_seq
  `)
  return rows.map((r) => ({
    stepSeq: num(r.STEP_SEQ),
    component: String(r.COMPONENT ?? ""),
    deltaPmpm: num(r.DELTA_PMPM),
    basis: String(r.BASIS ?? ""),
  }))
}

export async function getTrendDecomp(s: Slice, matureOnly = true): Promise<TrendDecompRow[]> {
  assertSlice(s)
  const segFilter = s.segment ? `AND service_category = ${q(s.segment)}` : ""
  const matFilter = matureOnly ? "AND is_mature = TRUE" : ""
  // latest defensible month per service_category
  const rows = await querySnowflake(`
    WITH d AS (
      SELECT service_category, incurred_month, units_per_1000, unit_cost, pmpm,
             yoy_trend_pct, util_effect, unitcost_effect, interaction_effect, is_mature,
             ROW_NUMBER() OVER (PARTITION BY service_category ORDER BY incurred_month DESC) rn
      FROM ${SCHEMA}.V_TREND_DECOMP
      WHERE line_of_business = ${q(s.lob)} AND constituent = ${q(s.constituent)} ${segFilter} ${matFilter}
    )
    SELECT * FROM d WHERE rn = 1 ORDER BY service_category
  `)
  return rows.map((r) => ({
    serviceCategory: String(r.SERVICE_CATEGORY ?? ""),
    incurredMonth: iso(r.INCURRED_MONTH),
    unitsPer1000: num(r.UNITS_PER_1000),
    unitCost: num(r.UNIT_COST),
    pmpm: num(r.PMPM),
    yoyTrendPct: num(r.YOY_TREND_PCT),
    utilEffect: num(r.UTIL_EFFECT),
    unitcostEffect: num(r.UNITCOST_EFFECT),
    interactionEffect: num(r.INTERACTION_EFFECT),
    isMature: Boolean(r.IS_MATURE),
  }))
}

export async function getTrendSelected(s: Slice): Promise<TrendSelected | null> {
  assertSlice(s)
  const rows = await querySnowflake(`
    SELECT annualized_trend, freq_trend, severity_trend, backtest_mape, n_months
    FROM ${SCHEMA}.V_TREND_SELECTED
    WHERE line_of_business = ${q(s.lob)} AND constituent = ${q(s.constituent)} LIMIT 1
  `)
  if (!rows.length) return null
  const r = rows[0]
  return {
    annualizedTrend: num(r.ANNUALIZED_TREND),
    freqTrend: num(r.FREQ_TREND),
    severityTrend: num(r.SEVERITY_TREND),
    backtestMape: num(r.BACKTEST_MAPE),
    nMonths: num(r.N_MONTHS),
  }
}

export async function getTrendProjection(s: Slice): Promise<TrendProjection | null> {
  assertSlice(s)
  const rows = await querySnowflake(`
    SELECT base_pmpm, selected_trend, projection_years, projected_pmpm,
           freq_trend, severity_trend, backtest_mape
    FROM ${SCHEMA}.V_TREND_PROJECTION
    WHERE line_of_business = ${q(s.lob)} AND constituent = ${q(s.constituent)} LIMIT 1
  `)
  if (!rows.length) return null
  const r = rows[0]
  return {
    basePmpm: num(r.BASE_PMPM),
    selectedTrend: num(r.SELECTED_TREND),
    projectionYears: num(r.PROJECTION_YEARS),
    projectedPmpm: num(r.PROJECTED_PMPM),
    freqTrend: num(r.FREQ_TREND),
    severityTrend: num(r.SEVERITY_TREND),
    backtestMape: num(r.BACKTEST_MAPE),
  }
}

/* ================= PRICE ================= */

export async function getPricingInput(s: Slice, planYear: number): Promise<PricingInput | null> {
  assertSlice(s)
  const py = Number(planYear) || 2027
  const rows = await querySnowflake(`
    SELECT plan_year, base_experience_pmpm, manual_pmpm, credibility_z,
           credibility_blended_pmpm, selected_trend, projected_pmpm, raf_current,
           raf_normalization_factor, required_pmpm_before_loads
    FROM ${SCHEMA}.V_PRICING_INPUT
    WHERE line_of_business = ${q(s.lob)} AND constituent = ${q(s.constituent)} AND plan_year = ${py}
    LIMIT 1
  `)
  if (!rows.length) return null
  const r = rows[0]
  return {
    planYear: num(r.PLAN_YEAR),
    baseExperiencePmpm: num(r.BASE_EXPERIENCE_PMPM),
    manualPmpm: num(r.MANUAL_PMPM),
    credibilityZ: num(r.CREDIBILITY_Z),
    credibilityBlendedPmpm: num(r.CREDIBILITY_BLENDED_PMPM),
    selectedTrend: num(r.SELECTED_TREND),
    projectedPmpm: num(r.PROJECTED_PMPM),
    rafCurrent: num(r.RAF_CURRENT),
    rafNormalizationFactor: num(r.RAF_NORMALIZATION_FACTOR),
    requiredPmpmBeforeLoads: num(r.REQUIRED_PMPM_BEFORE_LOADS),
  }
}

export async function getBidChecks(s: Slice, planYear: number): Promise<BidCheck[]> {
  assertSlice(s)
  const py = Number(planYear) || 2027
  const rows = await querySnowflake(`
    SELECT check_name, status, detail
    FROM ${SCHEMA}.V_BID_CHECKS
    WHERE line_of_business = ${q(s.lob)} AND constituent = ${q(s.constituent)} AND plan_year = ${py}
    ORDER BY check_name
  `)
  return rows.map((r) => ({
    checkName: String(r.CHECK_NAME ?? ""),
    status: String(r.STATUS ?? ""),
    detail: String(r.DETAIL ?? ""),
  }))
}

export async function getRateBuildup(workPaperId: string, s: Slice, planYear: number): Promise<RateBuildupStep[]> {
  assertSlice(s)
  const py = Number(planYear) || 2027
  const rows = await querySnowflake(`
    SELECT step_seq, component, value, basis
    FROM ${SCHEMA}.RATE_BUILDUP
    WHERE work_paper_id = ${q(workPaperId)} AND lob = ${q(s.lob)}
      AND constituent = ${q(s.constituent)} AND plan_year = ${py}
    ORDER BY step_seq
  `)
  return rows.map((r) => ({
    stepSeq: num(r.STEP_SEQ),
    component: String(r.COMPONENT ?? ""),
    value: num(r.VALUE),
    basis: String(r.BASIS ?? ""),
  }))
}

/* ================= WORK PAPERS + LEDGER ================= */

export async function listWorkPapers(): Promise<WorkPaper[]> {
  const rows = await querySnowflake(`
    SELECT work_paper_id, name, mode, lob, constituent, segment, valuation_date, status,
           parent_id, created_by, created_at, updated_at, version_no, signed_by, signed_at, filed_at
    FROM ${SCHEMA}.WORK_PAPER
    ORDER BY created_at DESC
  `)
  return rows.map(mapWorkPaper)
}

function mapWorkPaper(r: Record<string, unknown>): WorkPaper {
  return {
    workPaperId: String(r.WORK_PAPER_ID),
    name: String(r.NAME ?? ""),
    mode: String(r.MODE ?? ""),
    lob: String(r.LOB ?? ""),
    constituent: String(r.CONSTITUENT ?? ""),
    segment: r.SEGMENT == null ? null : String(r.SEGMENT),
    valuationDate: iso(r.VALUATION_DATE),
    status: String(r.STATUS ?? "DRAFT") as WorkPaper["status"],
    parentId: r.PARENT_ID == null ? null : String(r.PARENT_ID),
    createdBy: String(r.CREATED_BY ?? ""),
    createdAt: String(r.CREATED_AT ?? ""),
    updatedAt: String(r.UPDATED_AT ?? ""),
    versionNo: num(r.VERSION_NO),
    signedBy: r.SIGNED_BY == null ? null : String(r.SIGNED_BY),
    signedAt: r.SIGNED_AT == null ? null : String(r.SIGNED_AT),
    filedAt: r.FILED_AT == null ? null : String(r.FILED_AT),
  }
}

export async function getLedger(workPaperId: string): Promise<LedgerEntry[]> {
  const rows = await querySnowflake(`
    SELECT ledger_id, work_paper_id, lever, segment, value, unit, source_basis,
           rationale, is_judgment, author, created_at
    FROM ${SCHEMA}.ASSUMPTION_LEDGER
    WHERE work_paper_id = ${q(workPaperId)}
    ORDER BY created_at DESC
  `)
  return rows.map((r) => ({
    ledgerId: String(r.LEDGER_ID),
    workPaperId: String(r.WORK_PAPER_ID),
    lever: String(r.LEVER ?? ""),
    segment: r.SEGMENT == null ? null : String(r.SEGMENT),
    value: numOrNull(r.VALUE),
    unit: r.UNIT == null ? null : String(r.UNIT),
    sourceBasis: r.SOURCE_BASIS == null ? null : String(r.SOURCE_BASIS),
    rationale: r.RATIONALE == null ? null : String(r.RATIONALE),
    isJudgment: Boolean(r.IS_JUDGMENT),
    author: String(r.AUTHOR ?? ""),
    createdAt: String(r.CREATED_AT ?? ""),
  }))
}

export async function getWorkPaperEvents(workPaperId: string): Promise<WorkPaperEvent[]> {
  const rows = await querySnowflake(`
    SELECT event_id, work_paper_id, event_type, from_status, to_status, actor, note, created_at
    FROM ${SCHEMA}.WORK_PAPER_EVENT
    WHERE work_paper_id = ${q(workPaperId)}
    ORDER BY created_at DESC
  `)
  return rows.map((r) => ({
    eventId: String(r.EVENT_ID),
    workPaperId: String(r.WORK_PAPER_ID),
    eventType: String(r.EVENT_TYPE ?? ""),
    fromStatus: r.FROM_STATUS == null ? null : String(r.FROM_STATUS),
    toStatus: r.TO_STATUS == null ? null : String(r.TO_STATUS),
    actor: String(r.ACTOR ?? ""),
    note: r.NOTE == null ? null : String(r.NOTE),
    createdAt: String(r.CREATED_AT ?? ""),
  }))
}

/* ---------- write procedures ---------- */
export { q as sqlStr, assertSlice, METHODS }
