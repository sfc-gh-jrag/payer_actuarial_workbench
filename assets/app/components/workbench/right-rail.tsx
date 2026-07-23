"use client"

import { useState } from "react"
import { useWorkbench } from "./context"
import { useApi } from "./primitives"
import { Markdown } from "./markdown"
import { SEMANTIC_VIEW, TRACE_AGENT } from "@/lib/constants"
import { pctPoints, shortTime } from "@/lib/format"
import type { LedgerEntry, TraceResponse, WorkPaperEvent } from "@/lib/types"

export function RightRail() {
  const { railTab, setRailTab } = useWorkbench()
  return (
    <aside className="wb-rail right">
      <div className="wb-railtabs">
        <button aria-selected={railTab === "ledger"} onClick={() => setRailTab("ledger")}>
          Assumption ledger
        </button>
        <button aria-selected={railTab === "trace"} onClick={() => setRailTab("trace")}>
          Derivation trace
        </button>
      </div>
      <div className="wb-railbody">
        {railTab === "ledger" ? <LedgerPanel /> : <TracePanel />}
      </div>
    </aside>
  )
}

function LedgerPanel() {
  const { currentWorkPaperId, ledgerVersion } = useWorkbench()
  const url = currentWorkPaperId ? `/api/ledger?workPaperId=${encodeURIComponent(currentWorkPaperId)}` : null
  const { data, loading } = useApi<{ ledger: LedgerEntry[]; events: WorkPaperEvent[] }>(
    url, [currentWorkPaperId, ledgerVersion],
  )

  if (!currentWorkPaperId) {
    return <div className="wb-empty">Select or create a work paper to see its assumption ledger.</div>
  }
  if (loading && !data) return <div className="wb-empty">Loading ledger…</div>
  const entries = data?.ledger ?? []
  if (!entries.length) {
    return (
      <div className="wb-empty">
        No assumptions logged yet for this work paper. Overrides and trend/pricing judgments write
        here with author + rationale (ASOP 41).
      </div>
    )
  }
  return (
    <div>
      {entries.map((l) => (
        <div key={l.ledgerId} className={`wb-lg ${l.isJudgment ? "judg" : ""}`}>
          <div className="top">
            <span className="nm">{l.lever}{l.segment ? ` · ${l.segment}` : ""}</span>
            <span className="vv">{formatLedgerValue(l)}</span>
          </div>
          {l.rationale ? <div className="rat">{l.rationale}</div> : null}
          <div className="src">
            {l.sourceBasis ? <span>{l.sourceBasis}</span> : null}
            {l.isJudgment ? <span>judgment</span> : null}
            <span>author: {l.author}</span>
            <span>{shortTime(l.createdAt)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function formatLedgerValue(l: LedgerEntry): string {
  if (l.value == null) return "—"
  if (l.unit === "pct") return pctPoints(l.value, 2)
  if (l.unit === "cf" || (l.value > 0 && l.value < 2 && l.lever.toLowerCase().includes("compl")))
    return l.value.toFixed(4)
  return String(l.value)
}

/* ---------- trace agent ---------- */
interface Msg { role: "u" | "a"; text: string; sql?: string; citations?: string[] }

const CHIP_QUESTIONS: Record<string, string[]> = {
  reserve: [
    "How was total IBNR derived for this slice?",
    "Why did the most recent months develop the way they did?",
    "What drives the completion factor at the latest lag?",
  ],
  study: [
    "Break down the underlying allowed-PMPM trend.",
    "Which service category drives the trend?",
    "How accurate is the trend backtest?",
  ],
  price: [
    "Trace the projected required PMPM.",
    "Does this bid pass the MLR check?",
    "How does the credibility blend work?",
  ],
}

function TracePanel() {
  const { mode, slice } = useWorkbench()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)

  async function ask(question: string) {
    const q = question.trim()
    if (!q || busy) return
    setInput("")
    setMsgs((m) => [...m, { role: "u", text: q }])
    setBusy(true)
    try {
      const scoped = `${q} (context: LOB ${slice.lob}, constituent ${slice.constituent}${slice.segment ? `, service category ${slice.segment}` : ""})`
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: scoped }),
      })
      const json: TraceResponse & { error?: string } = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Agent request failed")
      setMsgs((m) => [...m, { role: "a", text: json.text, sql: json.sql, citations: json.citations }])
    } catch (e) {
      setMsgs((m) => [...m, { role: "a", text: `Trace unavailable: ${e instanceof Error ? e.message : "error"}` }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wb-agent">
      <div className="wb-msgs">
        <div className="wb-msg a">
          Ask me to <b>trace how a number was derived</b> or <b>explain a movement</b>. I read the
          semantic view and work-paper lineage — I don&apos;t recommend assumptions or take actions.
        </div>
        {msgs.map((m, i) => (
          <div key={i} className={`wb-msg ${m.role}`}>
            {m.role === "a" ? <Markdown text={m.text} /> : <div>{m.text}</div>}
            {m.citations?.length ? <div className="cite">source: {m.citations.join(" · ")}</div> : null}
          </div>
        ))}
        {busy ? <div className="wb-msg a">Tracing…</div> : null}
      </div>
      <div className="wb-chips">
        {(CHIP_QUESTIONS[mode] ?? []).map((c) => (
          <button key={c} onClick={() => ask(c)} disabled={busy}>{c}</button>
        ))}
      </div>
      <div className="wb-ask">
        <input
          value={input}
          placeholder="Ask how a number was derived…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(input) }}
          disabled={busy}
        />
        <button onClick={() => ask(input)} disabled={busy}>Ask</button>
      </div>
      <div className="wb-note">
        Grounded on <code>{TRACE_AGENT.split(".").pop()}</code> over <code>{SEMANTIC_VIEW.split(".").pop()}</code> +
        work-paper lineage. Trace/explain only — no recommendations, no action dispatch.
      </div>
    </div>
  )
}
