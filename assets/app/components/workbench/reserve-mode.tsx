"use client"

import { useMemo, useState } from "react"
import { useWorkbench } from "./context"
import { useApi, SurfaceHead, CardHd, SegControl, NumField, Toggle, ResultItem } from "./primitives"
import { METHOD_LABEL, METHOD_OPTIONS, SIGNING_ACTUARY, type ReserveMethod } from "@/lib/constants"
import { cf as fmtCf, money, moneyM, pct, pctPoints, signedMoney, ym } from "@/lib/format"
import type { AeRow, IbnrRow, PoolRow, RollforwardRow, Triangle } from "@/lib/types"

interface ReserveData {
  triangle: Triangle
  ibnr: IbnrRow[]
  methods: { method: ReserveMethod; totalIbnr: number }[]
  rollforward: RollforwardRow[]
  ae: AeRow[]
  pool: PoolRow[]
}

const SOURCE_BASES = [
  "Actuarial judgment — immature month",
  "Provider contract / fee-schedule change",
  "Known large claim not yet in run-out",
  "Seasonality / calendar-day adjustment",
  "Prior-period actual-to-expected signal",
]

export function ReserveMode() {
  const {
    slice, method, setMethod, tail, setTail, pooling, setPooling, poolOn, setPoolOn,
    currentWorkPaperId, bumpLedger, setRailTab,
  } = useWorkbench()

  const url = `/api/reserve?lob=${encodeURIComponent(slice.lob)}&constituent=${encodeURIComponent(
    slice.constituent,
  )}&segment=${encodeURIComponent(slice.segment)}&tail=${tail}&pooling=${pooling}`
  const { data, loading, error, reload } = useApi<ReserveData>(url, [
    slice.lob, slice.constituent, slice.segment, tail, pooling,
  ])

  // override modal
  const [ovr, setOvr] = useState<{ incurredMonth: string; modelCf: number } | null>(null)

  const cfByMonth = useMemo(() => {
    const m = new Map<string, IbnrRow>()
    data?.ibnr.forEach((r) => m.set(r.incurredMonth, r))
    return m
  }, [data])

  const totals = useMemo(() => {
    const rows = data?.ibnr ?? []
    const ibnr = rows.reduce((a, r) => a + r.ibnr, 0)
    const ult = rows.reduce((a, r) => a + r.ultimateIncurred, 0)
    const paid = rows.reduce((a, r) => a + r.paidToDate, 0)
    return { ibnr, ult, paid, pctPaid: paid ? ibnr / paid : 0 }
  }, [data])

  const latestRf = data?.rollforward.at(-1) ?? null

  return (
    <div>
      <SurfaceHead
        title="Reserve — IBNR close"
        tag={`paid development triangle · ${sliceLabel(slice)}`}
        prov="V_CLAIM_TRIANGLE · V_IBNR_COMPLETION"
        lede={
          <>
            The <b>working surface</b>: inspect the development triangle, pick a method, and see IBNR
            resolve. The LOB / constituent slicers drive this whole view — switch{" "}
            <b>Medical → Pharmacy (Rx)</b> and watch completion jump toward 100% (Rx adjudicates near
            real-time). Click a completion factor to override with documented rationale.
          </>
        }
      />

      {/* controls */}
      <div className="wb-controls">
        <SegControl<ReserveMethod>
          label="Reserving method" value={method} options={METHOD_OPTIONS} onChange={setMethod}
        />
        <NumField label="Large-claim pooling point" value={pooling} dollar onCommit={setPooling} />
        <NumField label="Tail factor" value={tail} onCommit={setTail} />
        <div className="wb-ctrl">
          <label>Pooling</label>
          <Toggle label="Reserve excess separately" checked={poolOn} onChange={setPoolOn} />
        </div>
        <button className="wb-run" onClick={reload} disabled={loading}>
          {loading ? "Computing…" : "↻ Recompute reserve"}
        </button>
      </div>

      {error ? <div className="wb-err">{error}</div> : null}
      {!currentWorkPaperId ? (
        <div className="wb-err" style={{ borderColor: "var(--wb-warn)", color: "var(--wb-warn)", background: "rgba(185,119,10,.06)" }}>
          No active work paper — create one in the left rail to log overrides to the ledger.
        </div>
      ) : null}

      {loading && !data ? <div className="wb-loading">Loading reserve surface…</div> : null}

      {data ? (
        <>
          {/* triangle */}
          <div className="wb-card">
            <CardHd
              title="Development triangle"
              hint={`rows = incurred month · cols = payment lag (months) · cumulative paid $ · ${slice.constituent}`}
            />
            <div className="bd">
              <TriangleGrid triangle={data.triangle} cfByMonth={cfByMonth} onOverride={setOvr} />
            </div>
          </div>

          {/* method comparison */}
          <div className="wb-card">
            <CardHd title="IBNR by reserving method" hint="TF_RESERVE_BY_METHOD · pooled excess floored at 0" />
            <div className="wb-results">
              {data.methods.map((m) => (
                <ResultItem
                  key={m.method}
                  k={METHOD_LABEL[m.method]}
                  v={moneyM(m.totalIbnr)}
                  s={m.method === method ? "selected method" : "total IBNR"}
                  tone={m.method === method ? "pos" : undefined}
                />
              ))}
            </div>
          </div>

          {/* reserve estimate strip */}
          <div className="wb-card">
            <CardHd
              title="Reserve estimate"
              hint={`${sliceLabel(slice)} · ${METHOD_LABEL[method]} · tail ${tail} · pooling ${poolOn ? money(pooling) : "off"}`}
            />
            <div className="wb-results">
              <ResultItem k="Total IBNR" v={money(totals.ibnr)} s="incurred ≤ valuation, unpaid" />
              <ResultItem k="Ultimate incurred" v={money(totals.ult)} s="36 incurred months" />
              <ResultItem k="IBNR / paid" v={pct(totals.pctPaid)} s="reserve intensity" />
              {latestRf ? (
                <ResultItem
                  k="Reserve vs GL"
                  v={signedMoney(latestRf.reserveVsGlVariance)}
                  s={`${pctPoints(latestRf.marginOverBookedPct)} margin over booked`}
                  tone={latestRf.reserveVsGlVariance >= 0 ? "pos" : "neg"}
                />
              ) : null}
            </div>
          </div>

          {/* IBNR by month */}
          <div className="wb-card">
            <CardHd title="IBNR by incurred month" hint="most recent 12 · override-aware (V_IBNR_COMPLETION)" />
            <div className="bd">
              <IbnrTable rows={data.ibnr} onOverride={setOvr} />
            </div>
          </div>

          {/* roll-forward */}
          {latestRf ? (
            <div className="wb-card">
              <CardHd title="Reserve roll-forward + GL tie-out" hint={`latest valuation ${ym(latestRf.valuationMonth)}`} />
              <div className="bd"><RollforwardTable rf={latestRf} /></div>
            </div>
          ) : null}

          {/* A/E */}
          {data.ae.length ? (
            <div className="wb-card">
              <CardHd title="Actual-to-expected roll-forward" hint="prior estimate vs one month of run-out — favorable / adverse development" />
              <div className="bd"><AeTable rows={data.ae} /></div>
            </div>
          ) : null}
        </>
      ) : null}

      {ovr ? (
        <OverrideModal
          incurredMonth={ovr.incurredMonth}
          modelCf={ovr.modelCf}
          slice={slice}
          methodLabel={METHOD_LABEL[method]}
          disabled={!currentWorkPaperId}
          onClose={() => setOvr(null)}
          onSaved={() => { setOvr(null); bumpLedger(); setRailTab("ledger"); reload() }}
        />
      ) : null}
    </div>
  )
}

function sliceLabel(s: { lob: string; constituent: string; segment: string }) {
  return `${s.lob} · ${s.constituent}${s.segment ? ` · ${s.segment}` : ""}`
}

function TriangleGrid({
  triangle, cfByMonth, onOverride,
}: {
  triangle: Triangle
  cfByMonth: Map<string, IbnrRow>
  onOverride: (o: { incurredMonth: string; modelCf: number }) => void
}) {
  const recentThreshold = Math.max(0, triangle.rows.length - 6)
  return (
    <table className="wb-grid">
      <thead>
        <tr>
          <th className="rh">Incurred</th>
          {triangle.lags.map((l) => <th key={l}>lag {l}</th>)}
          <th>Comp factor</th>
        </tr>
      </thead>
      <tbody>
        {triangle.rows.map((row, ri) => {
          const lastNonNull = row.cells.reduce((acc, v, i) => (v != null ? i : acc), -1)
          const ibnrRow = cfByMonth.get(row.incurredMonth)
          const overridden = ibnrRow?.cfSource === "OVERRIDE"
          return (
            <tr key={row.incurredMonth}>
              <td className="rh">{ym(row.incurredMonth)}</td>
              {row.cells.map((v, ci) => {
                const imm = ri >= recentThreshold && ci === lastNonNull
                return (
                  <td key={ci} className={imm ? "imm" : ""}>
                    {v == null ? "" : moneyM(v)}
                  </td>
                )
              })}
              <td
                className={`cf-cell ${overridden ? "ovr" : ""}`}
                title="Click to override the completion factor"
                onClick={() =>
                  onOverride({ incurredMonth: row.incurredMonth, modelCf: ibnrRow?.completionFactor ?? 1 })
                }
              >
                {ibnrRow ? fmtCf(ibnrRow.completionFactor) : "—"}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function IbnrTable({
  rows, onOverride,
}: { rows: IbnrRow[]; onOverride: (o: { incurredMonth: string; modelCf: number }) => void }) {
  const recent = rows.slice(-12)
  const total = rows.reduce((a, r) => a + r.ibnr, 0)
  return (
    <table className="wb-grid">
      <thead>
        <tr>
          <th className="rh">Incurred</th>
          <th>Paid to date</th>
          <th>Comp factor</th>
          <th>Ultimate</th>
          <th>IBNR</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        {recent.map((r) => (
          <tr key={r.incurredMonth}>
            <td className="rh">{ym(r.incurredMonth)}</td>
            <td>{money(r.paidToDate)}</td>
            <td
              className="cf-cell"
              onClick={() => onOverride({ incurredMonth: r.incurredMonth, modelCf: r.completionFactor })}
            >
              {fmtCf(r.completionFactor)}
            </td>
            <td>{money(r.ultimateIncurred)}</td>
            <td>{money(r.ibnr)}</td>
            <td style={{ color: r.cfSource === "OVERRIDE" ? "var(--wb-accent)" : "var(--wb-faint)" }}>
              {r.cfSource}
            </td>
          </tr>
        ))}
        <tr className="tot">
          <td className="rh">Total (36 mo)</td>
          <td /><td /><td /><td>{money(total)}</td><td />
        </tr>
      </tbody>
    </table>
  )
}

function RollforwardTable({ rf }: { rf: RollforwardRow }) {
  const rows: [string, number][] = [
    ["Beginning reserve", rf.beginningReserve],
    ["+ Incurred in period", rf.incurredInPeriod],
    ["− Paid in period", -Math.abs(rf.paidInPeriod)],
    ["Ending reserve", rf.endingReserve],
    ["Case reserve", rf.caseReserve],
    ["IBNP reserve", rf.ibnpReserve],
    ["IBNR booked", rf.ibnrBooked],
    ["LAE reserve", rf.laeReserve],
    ["PfAD margin", rf.pfadMargin],
    ["Derived IBNR", rf.derivedIbnr],
    ["Reserve vs GL variance", rf.reserveVsGlVariance],
  ]
  return (
    <table className="wb-grid">
      <thead><tr><th className="rh">Component</th><th>Amount</th></tr></thead>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td className="rh">{k}</td>
            <td className={v < 0 ? "neg" : ""}>{money(v)}</td>
          </tr>
        ))}
        <tr className="tot">
          <td className="rh">Margin over booked</td>
          <td className={rf.marginOverBookedPct >= 0 ? "pos" : "neg"}>{pctPoints(rf.marginOverBookedPct)}</td>
        </tr>
      </tbody>
    </table>
  )
}

function AeTable({ rows }: { rows: AeRow[] }) {
  const recent = rows.slice(-6)
  return (
    <table className="wb-grid">
      <thead>
        <tr>
          <th className="rh">Incurred (prior est.)</th>
          <th>Expected ultimate</th>
          <th>Restated</th>
          <th>Δ development</th>
          <th>A/E</th>
          <th>Signal</th>
        </tr>
      </thead>
      <tbody>
        {recent.map((r) => (
          <tr key={r.incurredMonth}>
            <td className="rh">{ym(r.incurredMonth)}</td>
            <td>{money(r.expectedUltimate)}</td>
            <td>{money(r.restatedUltimate)}</td>
            <td className={r.development <= 0 ? "pos" : "neg"}>{signedMoney(r.development)}</td>
            <td className={r.aeRatio <= 1 ? "pos" : "neg"}>{pct(r.aeRatio, 1)}</td>
            <td style={{ color: "var(--wb-faint)" }}>{r.developmentSignal}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function OverrideModal({
  incurredMonth, modelCf, slice, methodLabel, disabled, onClose, onSaved,
}: {
  incurredMonth: string
  modelCf: number
  slice: { lob: string; constituent: string; segment: string }
  methodLabel: string
  disabled: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { currentWorkPaperId } = useWorkbench()
  const [value, setValue] = useState((modelCf * 1.018).toFixed(4))
  const [src, setSrc] = useState(SOURCE_BASES[0])
  const [rationale, setRationale] = useState(
    "Fee-schedule uplift not yet fully paid; blending toward prior-year completion at this lag.",
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setBusy(true); setErr(null)
    try {
      const res = await fetch("/api/reserve/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workPaperId: currentWorkPaperId,
          lob: slice.lob,
          constituent: slice.constituent,
          incurredMonth,
          overrideCf: parseFloat(value),
          rationale: `${src}. ${rationale}`,
          author: SIGNING_ACTUARY,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Override failed")
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Override failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wb-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="wb-modal">
        <h3>Override completion factor</h3>
        <p className="m">Incurred {ym(incurredMonth)} · {slice.lob} / {slice.constituent} · method {methodLabel}</p>
        <div className="wb-fg">
          <label>Model value</label>
          <input className="mono" value={modelCf.toFixed(4)} disabled />
        </div>
        <div className="wb-fg">
          <label>Your value <span className="wb-req">*</span></label>
          <input className="mono" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="wb-fg">
          <label>Source basis <span className="wb-req">*</span></label>
          <select value={src} onChange={(e) => setSrc(e.target.value)}>
            {SOURCE_BASES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="wb-fg">
          <label>Rationale <span className="wb-req">*</span></label>
          <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} />
          <div className="wb-asop">Recorded to the assumption ledger with author + timestamp (ASOP 41).</div>
        </div>
        {err ? <div className="wb-err">{err}</div> : null}
        <div className="actions">
          <button className="wb-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="wb-primary" onClick={save} disabled={busy || disabled}>
            {busy ? "Applying…" : "Apply & log"}
          </button>
        </div>
      </div>
    </div>
  )
}
