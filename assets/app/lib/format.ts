/** Formatting helpers — client-safe (no server imports). */

export const money = (n: number | null | undefined): string =>
  n == null ? "—" : "$" + Math.round(n).toLocaleString()

export const moneyM = (n: number | null | undefined): string => {
  if (n == null) return "—"
  const abs = Math.abs(n)
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return "$" + n.toFixed(0)
}

export const pmpm = (n: number | null | undefined): string =>
  n == null ? "—" : "$" + n.toFixed(2)

export const signedMoney = (n: number | null | undefined): string => {
  if (n == null) return "—"
  return (n < 0 ? "-" : "+") + moneyM(Math.abs(n))
}

export const signed2 = (n: number | null | undefined): string => {
  if (n == null) return "—"
  return (n < 0 ? "-" : "+") + "$" + Math.abs(n).toFixed(2)
}

/** Value already a ratio (0..1). */
export const pct = (n: number | null | undefined, digits = 2): string =>
  n == null ? "—" : (n * 100).toFixed(digits) + "%"

/** Value already expressed in percentage points (e.g. 7.4). */
export const pctPoints = (n: number | null | undefined, digits = 1): string =>
  n == null ? "—" : n.toFixed(digits) + "%"

export const cf = (n: number | null | undefined): string =>
  n == null ? "—" : n.toFixed(4)

/** "2026-06-01" or ISO -> "2026-06". */
export const ym = (d: string | null | undefined): string => {
  if (!d) return "—"
  return d.slice(0, 7)
}

/** ISO timestamp -> "07-18 14:03". */
export const shortTime = (d: string | null | undefined): string => {
  if (!d) return ""
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return d
  const mm = String(dt.getMonth() + 1).padStart(2, "0")
  const dd = String(dt.getDate()).padStart(2, "0")
  const hh = String(dt.getHours()).padStart(2, "0")
  const mi = String(dt.getMinutes()).padStart(2, "0")
  return `${mm}-${dd} ${hh}:${mi}`
}

export const statusClass = (s: string): string => {
  switch (s?.toUpperCase()) {
    case "DRAFT": return "s-draft"
    case "REVIEW": return "s-review"
    case "SIGNED": return "s-signed"
    case "FILED": return "s-filed"
    default: return "s-draft"
  }
}

export const statusLabel = (s: string): string => {
  switch (s?.toUpperCase()) {
    case "FILED": return "booked"
    default: return (s || "").toLowerCase()
  }
}
