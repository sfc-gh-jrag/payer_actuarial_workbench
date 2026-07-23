"use client"

import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"

/** Fetch JSON when `deps` change; returns data/loading/error and a manual reload. */
export function useApi<T>(url: string | null, deps: unknown[]): {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!url) return
    const ctrl = new AbortController()
    abortRef.current?.abort()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    fetch(url, { cache: "no-store", signal: ctrl.signal })
      .then(async (r) => {
        const json = await r.json()
        if (!r.ok) throw new Error(json.error ?? `Request failed (${r.status})`)
        return json as T
      })
      .then((json) => { setData(json); setLoading(false) })
      .catch((e) => {
        if (e.name === "AbortError") return
        setError(e instanceof Error ? e.message : "Request failed")
        setLoading(false)
      })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, nonce, ...deps])

  return { data, loading, error, reload: () => setNonce((n) => n + 1) }
}

export function SurfaceHead({
  title, tag, prov, lede,
}: { title: string; tag: string; prov: string; lede: ReactNode }) {
  return (
    <div>
      <div className="wb-surface-head">
        <h2>{title}</h2>
        <span className="wb-tag">{tag}</span>
        <span className="wb-prov">
          binds to <code>SV_ACTUARIAL_INTELLIGENCE</code> · <code>{prov}</code>
        </span>
      </div>
      <p className="wb-lede">{lede}</p>
    </div>
  )
}

export function CardHd({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="hd">
      <h3>{title}</h3>
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  )
}

export function SegControl<T extends string>({
  label, value, options, onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="wb-ctrl">
      <label>{label}</label>
      <div className="wb-seg">
        {options.map((o) => (
          <button
            key={o.value}
            aria-selected={o.value === value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function NumField({
  label, value, unit, dollar, step, onCommit,
}: {
  label: string
  value: number
  unit?: string
  dollar?: boolean
  step?: string
  onCommit: (n: number) => void
}) {
  const [text, setText] = useState(dollar ? value.toLocaleString() : String(value))
  useEffect(() => { setText(dollar ? value.toLocaleString() : String(value)) }, [value, dollar])
  return (
    <div className="wb-ctrl">
      <label>{label}</label>
      <div className="wb-field">
        {dollar ? <span className="u">$</span> : null}
        <input
          value={text}
          inputMode="decimal"
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const n = parseFloat(text.replace(/[^0-9.]/g, ""))
            if (!isNaN(n)) onCommit(n)
          }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
        />
        {unit && !dollar ? <span className="u">{unit}</span> : null}
      </div>
    </div>
  )
}

export function Toggle({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label className="wb-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

export function ResultItem({
  k, v, s, tone,
}: { k: string; v: string; s?: string; tone?: "pos" | "neg" }) {
  return (
    <div className="r">
      <span className="k">{k}</span>
      <span className={`v ${tone ?? ""}`}>{v}</span>
      {s ? <span className="s">{s}</span> : null}
    </div>
  )
}

export function BridgeRow({
  lbl, sub, val, widthPct, kind, total,
}: {
  lbl: string
  sub: string
  val: string
  widthPct: number
  kind: "base" | "add" | "sub" | "res"
  total?: boolean
}) {
  return (
    <div className={`wb-brow ${total ? "total" : ""}`}>
      <div className="lbl">{lbl}<small>{sub}</small></div>
      <div className="barwrap">
        <div className={`bar ${kind}`} style={{ left: 0, width: `${Math.max(2, Math.min(100, widthPct))}%` }} />
      </div>
      <div className="val">{val}</div>
    </div>
  )
}
