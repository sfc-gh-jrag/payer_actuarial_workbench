/** App title — displayed in the nav header and browser tab */
export const APP_TITLE = "Actuarial Workbench"

/** Sub-label shown next to the brand mark */
export const APP_SUBTITLE = "Health Payer"

/** Path to the logo in /public (used in the header and as favicon) */
export const LOGO_SRC = "/icon.svg"

/**
 * Data-target values (schema, valuation anchor, signing actuary) come from
 * ./app_target, which the plugin app-deploy step renders from config.json
 * (app_target.ts.j2). The committed default keeps local `npm run dev` working.
 */
import { SCHEMA, VALUATION_DATE, SIGNING_ACTUARY, SIGNING_ACTUARY_INITIALS } from "./app_target"
export { SCHEMA, VALUATION_DATE, SIGNING_ACTUARY, SIGNING_ACTUARY_INITIALS }

/** Cortex Agent that powers the explain-only derivation trace. */
export const TRACE_AGENT = `${SCHEMA}.AGT_ACTUARIAL_WORKBENCH`
export const SEMANTIC_VIEW = `${SCHEMA}.SV_ACTUARIAL_INTELLIGENCE`

/* ---------- workbench-global slicers ---------- */

export type Lob = "Medicare Advantage" | "Commercial"
export type Constituent = "Medical" | "Pharmacy"
export type Mode = "reserve" | "study" | "price"
export type ReserveMethod = "CHAIN_LADDER" | "BORNHUETTER_FERGUSON" | "CAPE_COD"

export const LOB_OPTIONS: { value: Lob; label: string }[] = [
  { value: "Medicare Advantage", label: "Medicare Advantage" },
  { value: "Commercial", label: "Commercial (ACA)" },
]

export const CONSTITUENT_OPTIONS: { value: Constituent; label: string }[] = [
  { value: "Medical", label: "Medical" },
  { value: "Pharmacy", label: "Pharmacy (Rx)" },
]

/** Segment maps to service_category and depends on constituent. "" = all. */
export const SEGMENT_OPTIONS: Record<Constituent, { value: string; label: string }[]> = {
  Medical: [
    { value: "", label: "All medical categories" },
    { value: "Inpatient", label: "Inpatient" },
    { value: "Outpatient", label: "Outpatient" },
    { value: "Professional", label: "Professional" },
    { value: "Other", label: "Other" },
  ],
  Pharmacy: [
    { value: "", label: "All Rx categories" },
    { value: "Specialty Rx", label: "Specialty Rx" },
    { value: "Brand Rx", label: "Brand Rx" },
    { value: "Generic Rx", label: "Generic Rx" },
  ],
}

export const METHOD_OPTIONS: { value: ReserveMethod; label: string }[] = [
  { value: "CHAIN_LADDER", label: "Chain-Ladder" },
  { value: "BORNHUETTER_FERGUSON", label: "Bornhuetter-Ferguson" },
  { value: "CAPE_COD", label: "Cape Cod" },
]

export const METHOD_LABEL: Record<ReserveMethod, string> = {
  CHAIN_LADDER: "Chain-Ladder",
  BORNHUETTER_FERGUSON: "Bornhuetter-Ferguson",
  CAPE_COD: "Cape Cod",
}

/** Default reserving parameters (mirror config.default_reserving). */
export const DEFAULT_POOLING_POINT = 250000
export const DEFAULT_TAIL = 1.004
export const DEFAULT_PLAN_YEAR = 2028

/** Pricing basis label — MA uses Part C/D nomenclature. */
export function priceBasis(lob: Lob, constituent: Constituent): string {
  if (lob === "Medicare Advantage") {
    return constituent === "Medical" ? "MA Part C — Medical" : "MA Part D — Pharmacy"
  }
  return `${lob} — ${constituent}`
}
