"use client"

import { useMemo, useState } from "react"
import { useWorkbench } from "./context"
import { useApi, SurfaceHead, CardHd, SegControl, NumField, BridgeRow } from "./primitives"
import { DEFAULT_PLAN_YEAR, priceBasis } from "@/lib/constants"
import { signed2 } from "@/lib/format"
import type { BidCheck, PricingInput, RateBuildupStep } from "@/lib/types"

interface PriceData {
  pricing: PricingInput | null
  bidChecks: BidCheck[]
  rateBuildup: RateBuildupStep[]
}

const money2 = (n: number) => "$" + n.toFixed(2)

export function PriceMode() {
  const { slice, planYear, currentWorkPaperId, bumpLedger, setRailTab, setLob } = useWorkbench()
  const [cred, setCred] = useState(62)
  const [margin, setMargin] = useState(3.5)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const url = `/api/price?lob=${encodeURIComponent(slice.lob)}&constituent=${encodeURIComponent(
    slice.constituent,
  )}&planYear=${planYear}&workPaperId=${encodeURIComponent(currentWorkPaperId ?? "")}`
  const { data, loading, error, reload } = useApi<PriceData>(url, [
    slice.lob, slice.constituent, planYear, currentWorkPaperId,
  ])

  const p = data?.pricing ?? null
  const buildup = data?.rateBuildup ?? []

  // derivable rows from the pricing seed
  const derivable = useMemo(() => {
    if (!p) return []
    return [
      { lbl: "Base-period experience", sub: `CY${DEFAULT_PLAN_YEAR - 2} completed, restated`, val: p.baseExperiencePmpm, kind: "base" as const },
      { lbl: "Credibility blend", sub: `z=${p.credibilityZ.toFixed(2)} · manual ${money2(p.manualPmpm)}`, val: p.credibilityBlendedPmpm - p.baseExperiencePmpm, kind: "add" as const },
      { lbl: "+ Trend to projection", sub: `${money2(p.projectedPmpm)} projected`, val: p.projectedPmpm - p.credibilityBlendedPmpm, kind: "add" as const },
      { lbl: "RAF normalization", sub: `RAF ${p.rafCurrent.toFixed(3)} → norm ${p.rafNormalizationFactor.toFixed(3)}`, val: p.requiredPmpmBeforeLoads - p.projectedPmpm, kind: "sub" as const },
    ]
  }, [p])

  const requiredBeforeLoads = p?.requiredPmpmBeforeLoads ?? 0
  const judgmentTotal = buildup.reduce((a, s) => a + s.value, 0)
  const required = requiredBeforeLoads + judgmentTotal
  const maxAbs = Math.max(
    requiredBeforeLoads, required,
    ...derivable.map((d) => Math.abs(d.val)),
    ...buildup.map((s) => Math.abs(s.value)), 1,
  )

  async function seedJudgmentLoads() {
    if (!currentWorkPaperId || !p) return
    setBusy(true); setErr(null)
    const rb = p.requiredPmpmBeforeLoads
    const steps = [
      { step_seq: 1, component: "Benefit / induced utilization", value: +(rb * 0.018).toFixed(2), basis: "plan design + leverage" },
      { step_seq: 2, component: "Non-benefit expense", value: +(rb * 0.089).toFixed(2), basis: "admin load 7.8% of premium" },
      { step_seq: 3, component: "Gain/loss margin", value: +(rb * (margin / 100)).toFixed(2), basis: `${margin}% margin` },
    ]
    try {
      const res = await fetch("/api/rate-buildup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workPaperId: currentWorkPaperId, lob: slice.lob, constituent: slice.constituent, planYear, steps }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Save failed")
      bumpLedger(); reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed")
    } finally {
      setBusy(false)
    }
  }

  function exportMemo() {
    if (!p) return
    const lines = [
      `RATE BUILD-UP MEMO — ${priceBasis(slice.lob, slice.constituent)} — PY${planYear}`,
      `Generated ${new Date().toISOString()}`,
      "",
      ...derivable.map((d) => `${d.lbl}: ${d.kind === "base" ? money2(d.val) : signed2(d.val)}  (${d.sub})`),
      `Required PMPM before loads: ${money2(requiredBeforeLoads)}`,
      "",
      "Judgment loads:",
      ...(buildup.length ? buildup.map((s) => `  ${s.component}: ${signed2(s.value)}  (${s.basis})`) : ["  (none entered)"]),
      "",
      `PROJECTED REQUIRED PMPM: ${money2(required)}`,
      "",
      "Bid checks:",
      ...(data?.bidChecks ?? []).map((c) => `  [${c.status}] ${c.checkName} — ${c.detail}`),
    ]
    const blob = new Blob([lines.join("\n")], { type: "text/plain" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `rate-buildup-${slice.lob.replace(/\s+/g, "_")}-${slice.constituent}-PY${planYear}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div>
      <SurfaceHead
        title="Price — bid & rate filing"
        tag={`rate build-up · PY${planYear} · ${slice.lob} · ${slice.constituent}`}
        prov="V_PRICING_INPUT · V_BID_CHECKS"
        lede={
          <>
            The pricing <b>build-up</b>: restate base experience, credibility-blend with the manual
            rate, trend to the projection period, then layer program adjustments to the required
            PMPM. The derivable steps come from the semantic layer; judgment loads are actuary-entered
            and drive the bid checks. Basis: <b>{priceBasis(slice.lob, slice.constituent)}</b>.
          </>
        }
      />

      <div className="wb-controls">
        <SegControl
          label="Filing target"
          value={slice.lob === "Commercial" ? "aca" : "ma"}
          options={[{ value: "ma", label: "MA — CMS BPT" }, { value: "aca", label: "Commercial — URRT" }]}
          onChange={(v) => setLob(v === "aca" ? "Commercial" : "Medicare Advantage")}
        />
        <NumField label="Credibility" value={cred} unit="%" onCommit={setCred} />
        <NumField label="Gain/loss margin" value={margin} unit="%" onCommit={setMargin} />
        {currentWorkPaperId ? (
          <button className="wb-run" style={{ background: "transparent", color: "var(--wb-accent)", border: "1px solid var(--wb-line2)" }} onClick={seedJudgmentLoads} disabled={busy || !p}>
            {busy ? "Saving…" : "Enter judgment loads"}
          </button>
        ) : null}
        <button className="wb-run" onClick={exportMemo} disabled={!p}>⤓ Export to BPT / memo</button>
      </div>

      {error ? <div className="wb-err">{error}</div> : null}
      {err ? <div className="wb-err">{err}</div> : null}
      {!currentWorkPaperId ? (
        <div className="wb-err" style={{ borderColor: "var(--wb-warn)", color: "var(--wb-warn)", background: "rgba(185,119,10,.06)" }}>
          No active work paper — create one to enter and save judgment loads (rate build-up).
        </div>
      ) : null}
      {loading && !data ? <div className="wb-loading">Loading pricing surface…</div> : null}

      {p ? (
        <div className="wb-card">
          <CardHd title="Rate build-up — base experience → projected required PMPM" hint={priceBasis(slice.lob, slice.constituent)} />
          <div className="wb-bridge">
            <BridgeRow lbl={derivable[0].lbl} sub={derivable[0].sub} val={money2(derivable[0].val)} widthPct={(derivable[0].val / maxAbs) * 100} kind="base" />
            {derivable.slice(1).map((d) => (
              <BridgeRow key={d.lbl} lbl={d.lbl} sub={d.sub} val={signed2(d.val)} widthPct={(Math.abs(d.val) / maxAbs) * 100} kind={d.kind} />
            ))}
            <BridgeRow lbl="Required PMPM before loads" sub="derived from semantic layer" val={money2(requiredBeforeLoads)} widthPct={(requiredBeforeLoads / maxAbs) * 100} kind="add" />
            {buildup.map((s) => (
              <BridgeRow key={s.stepSeq} lbl={s.component} sub={s.basis} val={signed2(s.value)} widthPct={(Math.abs(s.value) / maxAbs) * 100} kind={s.value < 0 ? "sub" : "add"} />
            ))}
            <BridgeRow lbl="Projected required PMPM" sub="bid basis" val={money2(required)} widthPct={(required / maxAbs) * 100} kind="res" total />
          </div>
        </div>
      ) : (!loading ? <div className="wb-empty">No pricing seed for this slice / plan year.</div> : null)}

      {data?.bidChecks.length ? (
        <div className="wb-card">
          <CardHd title="Bid consistency checks" hint="mirrors CMS BPT / URRT validations (V_BID_CHECKS)" />
          <div className="bd">
            <table className="wb-grid">
              <thead>
                <tr><th className="rh">Check</th><th className="rh">Detail</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.bidChecks.map((c) => (
                  <tr key={c.checkName}>
                    <td className="rh">{c.checkName}</td>
                    <td className="rh" style={{ color: "var(--wb-faint)", fontWeight: 400 }}>{c.detail}</td>
                    <td className={c.status === "PASS" ? "pos" : c.status === "FAIL" ? "neg" : ""}>
                      {c.status === "PASS" ? "✓ " : c.status === "FAIL" ? "✗ " : "! "}{c.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
