import { NextRequest } from "next/server"
import { getSnowflakeBaseUrl, getRestApiAuthHeader, getServiceToken } from "@/lib/snowflake"
import { SCHEMA } from "@/lib/constants"

export const dynamic = "force-dynamic"

const [AGENT_DB, AGENT_SCHEMA] = SCHEMA.split(".")
const AGENT_NAME = "AGT_ACTUARIAL_WORKBENCH"

/**
 * Explain-only derivation trace. Sends the user's question to the Cortex Agent
 * (grounded on SV_ACTUARIAL_INTELLIGENCE + work-paper lineage) and consolidates
 * the SSE stream into { text, sql, citations }.
 */
export async function POST(req: NextRequest) {
  try {
    const { question, history } = await req.json()
    if (!question || typeof question !== "string") {
      return Response.json({ error: "Missing question" }, { status: 400 })
    }
    const baseUrl = getSnowflakeBaseUrl()
    if (!baseUrl) return Response.json({ error: "No Snowflake base URL resolved" }, { status: 500 })

    const url = `${baseUrl}/api/v2/databases/${AGENT_DB}/schemas/${AGENT_SCHEMA}/agents/${AGENT_NAME}:run`
    const messages = [
      ...(Array.isArray(history) ? history : []),
      { role: "user", content: [{ type: "text", text: question }] },
    ]
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: getRestApiAuthHeader(),
    }
    if (getServiceToken()) headers["X-Snowflake-Authorization-Token-Type"] = "OAUTH"

    const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify({ messages }) })
    if (!resp.ok) {
      const body = await resp.text()
      console.error(new Date().toISOString(), "[api/agent] non-ok", resp.status, body.slice(0, 800))
      return Response.json(
        { error: `Agent request failed (${resp.status})`, detail: body.slice(0, 500) },
        { status: 502 },
      )
    }
    const raw = await resp.text()
    console.error(new Date().toISOString(), "[api/agent] raw sse (first 2500):", raw.slice(0, 2500))
    const parsed = parseAgentSse(raw)
    console.error(new Date().toISOString(), "[api/agent] parsed textLen=", parsed.text.length, "sql?", !!parsed.sql)
    return Response.json(parsed)
  } catch (e) {
    console.error(new Date().toISOString(), "[api/agent]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Agent trace failed" },
      { status: 500 },
    )
  }
}

/** Tolerant parser: accumulates text deltas, captures generated SQL + citations. */
function parseAgentSse(raw: string): { text: string; sql?: string; citations?: string[] } {
  let deltaText = ""
  let typedText = ""
  let sql: string | undefined
  const citations = new Set<string>()

  const blocks = raw.split(/\n\n/)
  for (const block of blocks) {
    let event = ""
    const dataLines: string[] = []
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim()
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim())
    }
    const dataStr = dataLines.join("")
    if (!dataStr || dataStr === "[DONE]") continue
    let obj: unknown
    try { obj = JSON.parse(dataStr) } catch { continue }

    // Event-aware text-delta capture: streams like `response.text.delta`
    // carry the fragment directly as { text: "..." } (no type field).
    if (/text\.delta$/i.test(event)) {
      const d = pickText(obj)
      if (d) deltaText += d
    }
    walk(obj)
  }

  /** Pull a `text` string out of a delta payload shape. */
  function pickText(node: unknown): string {
    if (node == null || typeof node !== "object") return ""
    const o = node as Record<string, unknown>
    if (typeof o.text === "string") return o.text
    if (o.delta && typeof o.delta === "object") {
      const d = o.delta as Record<string, unknown>
      if (typeof d.text === "string") return d.text
      if (Array.isArray(d.content)) return d.content.map(pickText).join("")
    }
    if (Array.isArray(o.content)) return o.content.map(pickText).join("")
    return ""
  }

  function walk(node: unknown) {
    if (node == null) return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (typeof node !== "object") return
    const o = node as Record<string, unknown>

    // content item: { type: "text", text: "..." }
    if (o.type === "text" && typeof o.text === "string") typedText += o.text

    // Cortex Analyst tool result: SQL statement
    if (typeof o.sql === "string" && o.sql.trim()) sql = o.sql.trim()
    if (typeof o.statement === "string" && /select|with/i.test(o.statement)) sql = o.statement.trim()

    // citations / search results
    if (typeof o.source_id === "string") citations.add(o.source_id)
    if (typeof o.doc_title === "string") citations.add(o.doc_title)
    if (typeof o.title === "string" && typeof o.doc_id === "string") citations.add(o.title)

    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v)
  }

  // Prefer the aggregated typed-content text; fall back to concatenated deltas.
  const text = (typedText.trim() || deltaText.trim() || "No response text returned by the agent.")
  return {
    text,
    sql,
    citations: citations.size ? [...citations] : undefined,
  }
}
