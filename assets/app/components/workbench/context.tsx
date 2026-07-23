"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import type { ReactNode } from "react"
import {
  DEFAULT_PLAN_YEAR, DEFAULT_POOLING_POINT, DEFAULT_TAIL,
  type Constituent, type Lob, type Mode, type ReserveMethod,
} from "@/lib/constants"
import type { Slice, WorkPaper } from "@/lib/types"

type RailTab = "ledger" | "trace"

interface WorkbenchState {
  mode: Mode
  setMode: (m: Mode) => void
  lob: Lob
  constituent: Constituent
  segment: string
  setLob: (v: Lob) => void
  setConstituent: (v: Constituent) => void
  setSegment: (v: string) => void
  slice: Slice
  method: ReserveMethod
  setMethod: (m: ReserveMethod) => void
  tail: number
  setTail: (n: number) => void
  pooling: number
  setPooling: (n: number) => void
  poolOn: boolean
  setPoolOn: (b: boolean) => void
  planYear: number
  workPapers: WorkPaper[]
  currentWorkPaperId: string | null
  currentWorkPaper: WorkPaper | null
  setCurrentWorkPaperId: (id: string) => void
  refreshWorkPapers: () => Promise<WorkPaper[]>
  ledgerVersion: number
  bumpLedger: () => void
  railTab: RailTab
  setRailTab: (t: RailTab) => void
}

const Ctx = createContext<WorkbenchState | null>(null)

export function useWorkbench(): WorkbenchState {
  const v = useContext(Ctx)
  if (!v) throw new Error("useWorkbench must be used within WorkbenchProvider")
  return v
}

export function WorkbenchProvider({
  initialWorkPapers,
  children,
}: {
  initialWorkPapers: WorkPaper[]
  children: ReactNode
}) {
  const [mode, setMode] = useState<Mode>("reserve")
  const [lob, setLob] = useState<Lob>("Medicare Advantage")
  const [constituent, setConstituentRaw] = useState<Constituent>("Medical")
  const [segment, setSegment] = useState<string>("")
  const [method, setMethod] = useState<ReserveMethod>("CHAIN_LADDER")
  const [tail, setTail] = useState<number>(DEFAULT_TAIL)
  const [pooling, setPooling] = useState<number>(DEFAULT_POOLING_POINT)
  const [poolOn, setPoolOn] = useState<boolean>(true)
  const [workPapers, setWorkPapers] = useState<WorkPaper[]>(initialWorkPapers)
  const [currentWorkPaperId, setCurrentWorkPaperId] = useState<string | null>(
    initialWorkPapers[0]?.workPaperId ?? null,
  )
  const [ledgerVersion, setLedgerVersion] = useState(0)
  const [railTab, setRailTab] = useState<RailTab>("ledger")

  // changing constituent resets segment (service categories differ)
  const setConstituent = useCallback((v: Constituent) => {
    setConstituentRaw(v)
    setSegment("")
  }, [])

  const refreshWorkPapers = useCallback(async () => {
    const res = await fetch("/api/workpapers", { cache: "no-store" })
    const json = await res.json()
    const wps: WorkPaper[] = json.workPapers ?? []
    setWorkPapers(wps)
    setCurrentWorkPaperId((cur) => cur ?? wps[0]?.workPaperId ?? null)
    return wps
  }, [])

  const bumpLedger = useCallback(() => setLedgerVersion((v) => v + 1), [])

  const currentWorkPaper = useMemo(
    () => workPapers.find((w) => w.workPaperId === currentWorkPaperId) ?? null,
    [workPapers, currentWorkPaperId],
  )
  const slice: Slice = useMemo(() => ({ lob, constituent, segment }), [lob, constituent, segment])

  const value: WorkbenchState = {
    mode, setMode,
    lob, constituent, segment, setLob, setConstituent, setSegment, slice,
    method, setMethod, tail, setTail, pooling, setPooling, poolOn, setPoolOn,
    planYear: DEFAULT_PLAN_YEAR,
    workPapers, currentWorkPaperId, currentWorkPaper, setCurrentWorkPaperId,
    refreshWorkPapers, ledgerVersion, bumpLedger, railTab, setRailTab,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
