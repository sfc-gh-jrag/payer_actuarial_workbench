import { NextRequest } from "next/server"
import { querySnowflake } from "@/lib/snowflake"
import { sqlStr } from "@/lib/actuarial"
import { SCHEMA, SIGNING_ACTUARY } from "@/lib/constants"

export const dynamic = "force-dynamic"

// SP_APPLY_CF_OVERRIDE(work_paper_id, lob, constituent, incurred_month, override_cf, rationale, author)
export async function POST(req: NextRequest) {
  try {
    const b = await req.json()
    const wp = sqlStr(String(b.workPaperId ?? ""))
    const lob = sqlStr(String(b.lob ?? ""))
    const constituent = sqlStr(String(b.constituent ?? ""))
    const incurred = sqlStr(String(b.incurredMonth ?? ""))
    const cf = Number(b.overrideCf)
    const rationale = sqlStr(String(b.rationale ?? ""))
    const author = sqlStr(String(b.author ?? SIGNING_ACTUARY))
    if (!b.workPaperId) return Response.json({ error: "No active work paper" }, { status: 400 })
    if (!Number.isFinite(cf)) return Response.json({ error: "Invalid override value" }, { status: 400 })
    const rows = await querySnowflake(
      `CALL ${SCHEMA}.SP_APPLY_CF_OVERRIDE(${wp}, ${lob}, ${constituent}, ${incurred}::DATE, ${cf}::FLOAT, ${rationale}, ${author})`,
    )
    const result = rows.length ? String(Object.values(rows[0])[0] ?? "") : ""
    return Response.json({ result })
  } catch (e) {
    console.error(new Date().toISOString(), "[api/reserve/override]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Override failed" },
      { status: 500 },
    )
  }
}
