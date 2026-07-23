"use client"

import { useState } from "react"
import { useWorkbench } from "./context"
import { SIGNING_ACTUARY } from "@/lib/constants"
import { shortTime, statusClass, statusLabel } from "@/lib/format"
import type { WorkPaper, WorkPaperStatus } from "@/lib/types"

const NEXT_STATUS: Record<string, { to: WorkPaperStatus; label: string }[]> = {
  DRAFT: [{ to: "REVIEW", label: "Submit for review" }],
  REVIEW: [{ to: "SIGNED", label: "Sign" }, { to: "DRAFT", label: "Reopen" }],
  SIGNED: [{ to: "FILED", label: "File / book" }],
  FILED: [],
}

export function WorkPaperRail() {
  const {
    mode, slice, workPapers, currentWorkPaperId, currentWorkPaper,
    setCurrentWorkPaperId, refreshWorkPapers, bumpLedger,
  } = useWorkbench()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // roots first, each followed by its branches
  const roots = workPapers.filter((w) => !w.parentId)
  const childrenOf = (id: string) => workPapers.filter((w) => w.parentId === id)
  const orphanBranches = workPapers.filter(
    (w) => w.parentId && !workPapers.some((p) => p.workPaperId === w.parentId),
  )

  async function post(body: Record<string, unknown>) {
    setBusy(true); setErr(null)
    try {
      const res = await fetch("/api/workpapers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: SIGNING_ACTUARY, ...body }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Action failed")
      const wps = await refreshWorkPapers()
      // select the new/updated paper if the proc returned an id
      if (typeof json.result === "string" && /^[0-9a-fA-F-]{6,}/.test(json.result)) {
        setCurrentWorkPaperId(json.result)
      }
      bumpLedger()
      return wps
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed")
    } finally {
      setBusy(false)
    }
  }

  const create = () =>
    post({
      action: "create",
      name: `${slice.lob} ${slice.constituent} — ${mode} close`,
      mode, lob: slice.lob, constituent: slice.constituent, segment: slice.segment,
    })
  const branch = () => {
    if (!currentWorkPaperId) return
    post({ action: "branch", sourceId: currentWorkPaperId, name: `Branch of ${currentWorkPaper?.name ?? "work paper"}` })
  }
  const transition = (to: string) => {
    if (!currentWorkPaperId) return
    post({ action: "transition", workPaperId: currentWorkPaperId, toStatus: to, note: `${to} via workbench` })
  }
  const del = async () => {
    if (!currentWorkPaperId || currentWorkPaper?.status !== "DRAFT") return
    const ok = window.confirm(
      `Delete draft "${currentWorkPaper.name}"?\n\nThis permanently removes its assumptions, overrides and saved estimates. A delete event is kept for audit. This cannot be undone.`,
    )
    if (!ok) return
    const deletedId = currentWorkPaperId
    const wps = await post({ action: "delete", workPaperId: deletedId })
    if (wps) {
      // the deleted paper is gone — move selection to another paper (or none)
      const next = wps.find((w) => w.workPaperId !== deletedId)
      setCurrentWorkPaperId(next?.workPaperId ?? "")
    }
  }

  const transitions = currentWorkPaper ? NEXT_STATUS[currentWorkPaper.status] ?? [] : []

  return (
    <aside className="wb-rail left">
      <h4>Work Papers</h4>
      <div className="sub">System of record — every run is versioned, diffable, branchable.</div>

      {workPapers.length === 0 ? (
        <div className="wb-empty">
          No work papers yet. Create the first one to start writing to the ledger.
        </div>
      ) : (
        <div style={{ paddingBottom: 8 }}>
          {roots.map((r) => (
            <div key={r.workPaperId}>
              <Node wp={r} selected={r.workPaperId === currentWorkPaperId} onSelect={setCurrentWorkPaperId} />
              {childrenOf(r.workPaperId).map((c) => (
                <Node key={c.workPaperId} wp={c} branch selected={c.workPaperId === currentWorkPaperId} onSelect={setCurrentWorkPaperId} />
              ))}
            </div>
          ))}
          {orphanBranches.map((c) => (
            <Node key={c.workPaperId} wp={c} branch selected={c.workPaperId === currentWorkPaperId} onSelect={setCurrentWorkPaperId} />
          ))}
        </div>
      )}

      {err ? <div className="wb-err" style={{ margin: "6px 12px" }}>{err}</div> : null}

      <button className="wb-railbtn" onClick={create} disabled={busy}>＋ New work paper (this slice)</button>
      <button className="wb-railbtn" onClick={branch} disabled={busy || !currentWorkPaperId}>⇄ Branch this work paper</button>
      {currentWorkPaper?.status === "DRAFT" ? (
        <button className="wb-railbtn danger" onClick={del} disabled={busy}>🗑 Delete draft</button>
      ) : null}
      {transitions.map((t) => (
        <button key={t.to} className="wb-railbtn" onClick={() => transition(t.to)} disabled={busy}>
          → {t.label}
        </button>
      ))}

      <h4 style={{ marginTop: 8 }}>Cycle Position</h4>
      <div className="sub" style={{ lineHeight: 1.7 }}>
        <div>● Monthly reserve close <b>← here</b></div>
        <div style={{ color: "var(--wb-faint)" }}>○ Quarterly certification (Q2)</div>
        <div style={{ color: "var(--wb-faint)" }}>○ CY2028 MA bid — due Jun 2</div>
        <div style={{ color: "var(--wb-faint)" }}>○ Commercial rate filing (SERFF)</div>
      </div>
    </aside>
  )
}

function Node({
  wp, selected, branch, onSelect,
}: { wp: WorkPaper; selected: boolean; branch?: boolean; onSelect: (id: string) => void }) {
  return (
    <div
      className={`wb-node ${branch ? "branch" : ""}`}
      aria-selected={selected}
      onClick={() => onSelect(wp.workPaperId)}
    >
      <div className="rg"><i /></div>
      <div style={{ minWidth: 0 }}>
        <div className="t">
          {branch ? "↳ " : ""}{wp.name}{" "}
          <span className={`wb-status ${statusClass(wp.status)}`}>{statusLabel(wp.status)}</span>
        </div>
        <div className="d">
          v{wp.versionNo} · {wp.createdBy} · {shortTime(wp.updatedAt || wp.createdAt)}
        </div>
      </div>
    </div>
  )
}
