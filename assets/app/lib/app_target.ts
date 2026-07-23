/**
 * Data target for the deployed derived data product.
 *
 * PLACEHOLDER DEFAULT — the plugin app-deploy step renders app_target.ts.j2 from
 * config.json and OVERWRITES this file with the customer's target schema. These
 * placeholder values only keep TypeScript compiling / local `npm run dev` running;
 * set them (or deploy) before the app returns real data. Do not add logic here.
 */

/** Fully-qualified schema of the deployed derived data product. */
export const SCHEMA = "<YOUR_DERIVED_DATA_PRODUCT_DB>.ACTUARIAL"

/** Valuation anchor / DEMO_CLOCK for this book (censoring applied on-read). */
export const VALUATION_DATE = "2026-06-30"

/** Signing actuary attributed to writes (author / created_by / actor). */
export const SIGNING_ACTUARY = "Actuary Name"
export const SIGNING_ACTUARY_INITIALS = "AN"

