"use client"

import { WorkbenchProvider, useWorkbench } from "./context"
import { WorkPaperRail } from "./work-paper-rail"
import { RightRail } from "./right-rail"
import { ReserveMode } from "./reserve-mode"
import { StudyMode } from "./study-mode"
import { PriceMode } from "./price-mode"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  APP_SUBTITLE, APP_TITLE, CONSTITUENT_OPTIONS, LOB_OPTIONS, SEGMENT_OPTIONS,
  SIGNING_ACTUARY, SIGNING_ACTUARY_INITIALS, VALUATION_DATE,
  type Constituent, type Lob, type Mode,
} from "@/lib/constants"
import type { WorkPaper } from "@/lib/types"

export function Workbench({
  initialWorkPapers, loadError,
}: { initialWorkPapers: WorkPaper[]; loadError: string | null }) {
  return (
    <WorkbenchProvider initialWorkPapers={initialWorkPapers}>
      <Shell loadError={loadError} />
    </WorkbenchProvider>
  )
}

const MODE_TABS: { mode: Mode; label: string; k: string }[] = [
  { mode: "reserve", label: "Reserve", k: "IBNR close" },
  { mode: "study", label: "Study", k: "trend & experience" },
  { mode: "price", label: "Price", k: "bid & rate filing" },
]

function Shell({ loadError }: { loadError: string | null }) {
  const { mode } = useWorkbench()
  return (
    <div className="wb-shell">
      <Header />
      <div className="wb-work">
        <WorkPaperRail />
        <main className="wb-center">
          {loadError ? (
            <div className="wb-err">
              Could not reach the ACTUARIAL data product: {loadError}
            </div>
          ) : null}
          {mode === "reserve" ? <ReserveMode /> : null}
          {mode === "study" ? <StudyMode /> : null}
          {mode === "price" ? <PriceMode /> : null}
        </main>
        <RightRail />
      </div>
      <Footer />
    </div>
  )
}

function Header() {
  const { mode, setMode, lob, setLob, constituent, setConstituent, segment, setSegment } =
    useWorkbench()
  return (
    <header className="wb-header">
      <div className="wb-brand">
        <span className="dot" />
        {APP_TITLE}
        <span style={{ fontWeight: 500, color: "var(--wb-faint)" }}>· {APP_SUBTITLE}</span>
      </div>
      <div className="wb-modes" role="tablist">
        {MODE_TABS.map((t) => (
          <button
            key={t.mode}
            role="tab"
            aria-selected={mode === t.mode}
            onClick={() => setMode(t.mode)}
          >
            {t.label}<span className="k">{t.k}</span>
          </button>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Slicer label="LOB" value={lob} onChange={(v) => setLob(v as Lob)} options={LOB_OPTIONS} />
        <Slicer
          label="Constituent"
          value={constituent}
          onChange={(v) => setConstituent(v as Constituent)}
          options={CONSTITUENT_OPTIONS}
        />
        <Slicer
          label="Segment"
          value={segment}
          onChange={setSegment}
          options={SEGMENT_OPTIONS[constituent]}
        />
        <span className="wb-sel">Valuation <b>{VALUATION_DATE}</b></span>
        <ThemeToggle />
        <span className="wb-who" title={`${SIGNING_ACTUARY} — signing actuary`}>
          {SIGNING_ACTUARY_INITIALS}
        </span>
      </div>
    </header>
  )
}

function Slicer({
  label, value, onChange, options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span className="wb-slabel">{label}</span>
      <select className="wb-slicer" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value || "all"} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function Footer() {
  return (
    <div className="wb-foot">
      <span className="badge wb-mono">ACTUARIAL_DATA_PRODUCT</span>
      <span>Derived product · thin client over the Snowflake SQL API · every cell traces to source</span>
      <span style={{ marginLeft: "auto" }} className="wb-mono">
        reproducible · ASOP 41 audit trail
      </span>
    </div>
  )
}
