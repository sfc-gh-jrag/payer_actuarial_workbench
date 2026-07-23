"use client"

import { useState } from "react"
import { useWorkbench } from "./context"
import { useApi, SurfaceHead, CardHd, SegControl, Toggle, BridgeRow, ResultItem } from "./primitives"
import { SIGNING_ACTUARY } from "@/lib/constants"
import { signed2, pctPoints } from "@/lib/format"
import type { TrendDecompRow, TrendProjection, TrendSelected, TrendSummaryRow } from "@/lib/types"

interface StudyData {
  summary: TrendSummaryRow[]
  decomp: TrendDecompRow[]
  selected: TrendSelected | null
  projection: TrendProjection | null
}

export function StudyMode() {
  const { slice, currentWorkPaperId, bumpLedger, setRailTab } = useWorkbench()
  const [matureOnly, setMatureOnly] = useState(true)
  const [basis, setBasis] = useState<"a" | "p">("a")
  const [showOverride, setShowOverride] = useState(false)

  const url = `/api/study?lob=${encodeURIComponent(slice.lob)}&constituent=${encodeURIComponent(
    slice.constituent,
  )}&segment=${encodeURIComponent(slice.segment)}&matureOnly=${matureOnly}`
  const { data, loading, error, reload } = useApi<StudyData>(url, [
    slice.lob, slice.constituent, slice.segment, matureOnly,
  ])

  const summary = data?.summary ?? []
  const base = summary.find((s) => s.stepSeq === 1)?.deltaPmpm ?? 0
  const deltas = summary.filter((s) => s.stepSeq > 1)
  const cy = base + deltas.reduce((a, s) => a + s.deltaPmpm, 0)
  const maxAbs = Math.max(base, cy, ...deltas.map((d) => Math.abs(d.deltaPmpm)), 1)

  return (
    <div>
      <SurfaceHead
        title="Study — trend & experience"
        tag={`allowed-PMPM decomposition · ${slice.lob} · ${slice.constituent}`}
        prov="V_TREND_SUMMARY · V_TREND_DECOMP"
        lede={
          <>
            Decompose observed PMPM movement into <b>utilization × unit cost × mix</b>, normalize out
            large claims, and read the underlying trend that feeds pricing. Components sum to the
            observed YoY change; the agent traces every component to source.
          </>
        }
      />

      <div className="wb-controls">
        <div className="wb-ctrl">
          <label>Normalization</label>
          <div style={{ display: "flex", gap: 14 }}>
            <Toggle label="Mature months only" checked={matureOnly} onChange={setMatureOnly} />
          </div>
        </div>
        <SegControl<"a" | "p">
          label="Basis" value={basis}
          options={[{ value: "a", label: "Allowed" }, { value: "p", label: "Paid" }]}
          onChange={setBasis}
        />
        {currentWorkPaperId ? (
          <button className="wb-run" style={{ background: "transparent", color: "var(--wb-accent)", border: "1px solid var(--wb-line2)" }} onClick={() => setShowOverride(true)}>
            Override selected trend
          </button>
        ) : null}
        <button className="wb-run" onClick={reload} disabled={loading}>
          {loading ? "Rebuilding…" : "↻ Rebuild study"}
        </button>
      </div>

      {basis === "p" ? (
        <div className="wb-err" style={{ borderColor: "var(--wb-warn)", color: "var(--wb-warn)", background: "rgba(185,119,10,.06)" }}>
          Paid-basis decomposition is a documented enhancement — the frequency×severity decomposition
          below is allowed-basis (see data contract §Study).
        </div>
      ) : null}
      {error ? <div className="wb-err">{error}</div> : null}
      {loading && !data ? <div className="wb-loading">Loading study surface…</div> : null}

      {data ? (
        <>
          {data.selected || data.projection ? (
            <div className="wb-card">
              <CardHd title="Trend headline" hint="modeled fit + backtest" />
              <div className="wb-results">
                {data.selected ? (
                  <>
                    <ResultItem k="Annualized trend" v={pctPoints(data.selected.annualizedTrend * 100)} s={`${data.selected.nMonths} mature months`} />
                    <ResultItem k="Frequency trend" v={pctPoints(data.selected.freqTrend * 100)} s="units / 1,000" />
                    <ResultItem k="Severity trend" v={pctPoints(data.selected.severityTrend * 100)} s="unit cost" />
                    <ResultItem k="Backtest MAPE" v={pctPoints(data.selected.backtestMape * 100)} s="lower is better" />
                  </>
                ) : null}
                {data.projection ? (
                  <ResultItem k="Projected PMPM" v={`$${data.projection.projectedPmpm.toFixed(2)}`} s={`${data.projection.projectionYears}y @ ${pctPoints(data.projection.selectedTrend * 100)}`} tone="pos" />
                ) : null}
              </div>
            </div>
          ) : null}

          {summary.length ? (
            <div className="wb-card">
              <CardHd title="Trend build-up — PY → CY allowed PMPM" hint="components sum to the observed YoY change" />
              <div className="wb-bridge">
                <BridgeRow lbl="PY allowed PMPM" sub="base period" val={`$${base.toFixed(2)}`} widthPct={(base / maxAbs) * 100} kind="base" />
                {deltas.map((d) => (
                  <BridgeRow
                    key={d.stepSeq}
                    lbl={d.component}
                    sub={d.basis}
                    val={signed2(d.deltaPmpm)}
                    widthPct={(Math.abs(d.deltaPmpm) / maxAbs) * 100}
                    kind={d.deltaPmpm < 0 ? "sub" : "add"}
                  />
                ))}
                <BridgeRow lbl="CY underlying PMPM" sub="normalized" val={`$${cy.toFixed(2)}`} widthPct={(cy / maxAbs) * 100} kind="res" total />
              </div>
            </div>
          ) : null}

          {data.decomp.length ? (
            <div className="wb-card">
              <CardHd title="Experience exhibit — by service category" hint={slice.constituent} />
              <div className="bd">
                <table className="wb-grid">
                  <thead>
                    <tr>
                      <th className="rh">Service category</th>
                      <th>Units / 1,000</th>
                      <th>Unit cost</th>
                      <th>Allowed PMPM</th>
                      <th>YoY trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.decomp.map((r) => (
                      <tr key={r.serviceCategory}>
                        <td className="rh">{r.serviceCategory}</td>
                        <td>{r.unitsPer1000.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                        <td>${r.unitCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                        <td>${r.pmpm.toFixed(2)}</td>
                        <td className={r.yoyTrendPct > 0.08 ? "neg" : ""}>{pctPoints(r.yoyTrendPct * 100)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {showOverride && data?.selected ? (
        <TrendOverrideModal
          modeled={data.selected.annualizedTrend * 100}
          onClose={() => setShowOverride(false)}
          onSaved={() => { setShowOverride(false); bumpLedger(); setRailTab("ledger") }}
        />
      ) : null}
    </div>
  )
}

function TrendOverrideModal({
  modeled, onClose, onSaved,
}: { modeled: number; onClose: () => void; onSaved: () => void }) {
  const { currentWorkPaperId, slice } = useWorkbench()
  const [value, setValue] = useState(modeled.toFixed(2))
  const [rationale, setRationale] = useState("Selecting above the modeled fit for known specialty pipeline pressure.")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setBusy(true); setErr(null)
    try {
      const res = await fetch("/api/assumption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workPaperId: currentWorkPaperId,
          lever: "Trend",
          segment: `${slice.lob} / ${slice.constituent}`,
          value: parseFloat(value),
          unit: "pct",
          sourceBasis: "Actuarial judgment — selected trend",
          rationale,
          isJudgment: true,
          author: SIGNING_ACTUARY,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Log failed")
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Log failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wb-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="wb-modal">
        <h3>Override selected trend</h3>
        <p className="m">{slice.lob} / {slice.constituent} — annualized allowed-PMPM trend</p>
        <div className="wb-fg">
          <label>Modeled value</label>
          <input className="mono" value={`${modeled.toFixed(2)}%`} disabled />
        </div>
        <div className="wb-fg">
          <label>Your value (%) <span className="wb-req">*</span></label>
          <input className="mono" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="wb-fg">
          <label>Rationale <span className="wb-req">*</span></label>
          <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} />
          <div className="wb-asop">Logged to ASSUMPTION_LEDGER via SP_LOG_ASSUMPTION (ASOP 41).</div>
        </div>
        {err ? <div className="wb-err">{err}</div> : null}
        <div className="actions">
          <button className="wb-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="wb-primary" onClick={save} disabled={busy || !currentWorkPaperId}>
            {busy ? "Logging…" : "Apply & log"}
          </button>
        </div>
      </div>
    </div>
  )
}
