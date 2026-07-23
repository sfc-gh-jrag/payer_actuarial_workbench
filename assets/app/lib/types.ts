import type { Constituent, Lob, ReserveMethod } from "./constants"

/* ---------- shared slice ---------- */
export interface Slice {
  lob: Lob
  constituent: Constituent
  segment: string // service_category or "" for all
}

/* ---------- Reserve ---------- */
export interface TriangleCell {
  incurredMonth: string
  devLag: number
  cumulativePaid: number
}
export interface TriangleRow {
  incurredMonth: string
  cells: (number | null)[] // indexed by dev lag 0..maxLag (cumulative paid, PMPM if scaled)
  memberMonths: number
}
export interface Triangle {
  lags: number[]
  rows: TriangleRow[]
  basis: "dollars" | "pmpm"
}

export interface IbnrRow {
  incurredMonth: string
  lagFromAnchor: number
  paidToDate: number
  referenceCf: number | null
  overrideCf: number | null
  completionFactor: number
  cfSource: string // MODELED | OVERRIDE
  ultimateIncurred: number
  ibnr: number
}

export interface MethodRow {
  incurredMonth: string
  paidToDate: number
  completionFactor: number
  ultimate: number
  ibnr: number
}

export interface RollforwardRow {
  valuationMonth: string
  beginningReserve: number
  incurredInPeriod: number
  paidInPeriod: number
  endingReserve: number
  caseReserve: number
  ibnpReserve: number
  ibnrBooked: number
  laeReserve: number
  pfadMargin: number
  derivedIbnr: number
  reserveVsGlVariance: number
  marginOverBookedPct: number
}

export interface AeRow {
  incurredMonth: string
  priorValuation: string
  currentValuation: string
  expectedUltimate: number
  restatedUltimate: number
  development: number
  aeRatio: number
  developmentSignal: string
}

export interface PoolRow {
  incurredMonth: string
  totalPaid: number
  pooledExcess: number
  pooledCapped: number
  largeClaimCount: number
  memberMonths: number
  pooledExcessPmpm: number
}

/* ---------- Study ---------- */
export interface TrendSummaryRow {
  stepSeq: number
  component: string
  deltaPmpm: number
  basis: string
}
export interface TrendDecompRow {
  serviceCategory: string
  incurredMonth: string
  unitsPer1000: number
  unitCost: number
  pmpm: number
  yoyTrendPct: number
  utilEffect: number
  unitcostEffect: number
  interactionEffect: number
  isMature: boolean
}
export interface TrendSelected {
  annualizedTrend: number
  freqTrend: number
  severityTrend: number
  backtestMape: number
  nMonths: number
}
export interface TrendProjection {
  basePmpm: number
  selectedTrend: number
  projectionYears: number
  projectedPmpm: number
  freqTrend: number
  severityTrend: number
  backtestMape: number
}

/* ---------- Price ---------- */
export interface PricingInput {
  planYear: number
  baseExperiencePmpm: number
  manualPmpm: number
  credibilityZ: number
  credibilityBlendedPmpm: number
  selectedTrend: number
  projectedPmpm: number
  rafCurrent: number
  rafNormalizationFactor: number
  requiredPmpmBeforeLoads: number
}
export interface BidCheck {
  checkName: string
  status: "PASS" | "WARN" | "FAIL" | string
  detail: string
}
export interface RateBuildupStep {
  stepSeq: number
  component: string
  value: number
  basis: string
}

/* ---------- Work papers + ledger ---------- */
export type WorkPaperStatus = "DRAFT" | "REVIEW" | "SIGNED" | "FILED"
export interface WorkPaper {
  workPaperId: string
  name: string
  mode: string
  lob: string
  constituent: string
  segment: string | null
  valuationDate: string
  status: WorkPaperStatus
  parentId: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  versionNo: number
  signedBy: string | null
  signedAt: string | null
  filedAt: string | null
}
export interface LedgerEntry {
  ledgerId: string
  workPaperId: string
  lever: string
  segment: string | null
  value: number | null
  unit: string | null
  sourceBasis: string | null
  rationale: string | null
  isJudgment: boolean
  author: string
  createdAt: string
}
export interface WorkPaperEvent {
  eventId: string
  workPaperId: string
  eventType: string
  fromStatus: string | null
  toStatus: string | null
  actor: string
  note: string | null
  createdAt: string
}

/* ---------- trace agent ---------- */
export interface TraceResponse {
  text: string
  sql?: string
  citations?: string[]
}
