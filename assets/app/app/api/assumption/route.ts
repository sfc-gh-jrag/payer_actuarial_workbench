import { NextRequest } from "next/server"
import { querySnowflake } from "@/lib/snowflake"
import { sqlStr } from "@/lib/actuarial"
import { SCHEMA, SIGNING_ACTUARY } from "@/lib/constants"

export const dynamic = "force-dynamic"

// SP_LOG_ASSUMPTION(work_paper_id, lever, segment, value, unit, source_basis, rationale, is_judgment, author)
export async function POST(req: NextRequest) {
  try {
    const b = await req.json()
    const wp = String(b.workPaperId ?? "")
    if (!wp) return Response.json({ error: "No active work paper" }, { status: 400 })
    const value = Number(b.value)
    if (!Number.isFinite(value)) return Response.json({ error: "Invalid value" }, { status: 400 })
    const rows = await querySnowflake(
      `CALL ${SCHEMA}.SP_LOG_ASSUMPTION(${sqlStr(wp)}, ${sqlStr(String(b.lever ?? "Trend"))}, ` +
      `${sqlStr(String(b.segment ?? ""))}, ${value}::FLOAT, ${sqlStr(String(b.unit ?? "pct"))}, ` +
      `${sqlStr(String(b.sourceBasis ?? "Actuarial judgment"))}, ${sqlStr(String(b.rationale ?? ""))}, ` +
      `${b.isJudgment === false ? "FALSE" : "TRUE"}, ${sqlStr(String(b.author ?? SIGNING_ACTUARY))})`,
    )
    const result = rows.length ? String(Object.values(rows[0])[0] ?? "") : ""
    return Response.json({ result })
  } catch (e) {
    console.error(new Date().toISOString(), "[api/assumption]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Log assumption failed" },
      { status: 500 },
    )
  }
}
