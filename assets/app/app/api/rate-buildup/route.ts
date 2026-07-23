import { NextRequest } from "next/server"
import { querySnowflake } from "@/lib/snowflake"
import { sqlStr } from "@/lib/actuarial"
import { SCHEMA } from "@/lib/constants"

export const dynamic = "force-dynamic"

// SP_SAVE_RATE_BUILDUP(work_paper_id, lob, constituent, plan_year, steps_json)
export async function POST(req: NextRequest) {
  try {
    const b = await req.json()
    const wp = String(b.workPaperId ?? "")
    if (!wp) return Response.json({ error: "No active work paper" }, { status: 400 })
    const steps = Array.isArray(b.steps) ? b.steps : []
    const stepsJson = JSON.stringify(
      steps.map((s: Record<string, unknown>, i: number) => ({
        step_seq: Number(s.step_seq ?? i + 1),
        component: String(s.component ?? ""),
        value: Number(s.value ?? 0),
        basis: String(s.basis ?? ""),
      })),
    )
    const rows = await querySnowflake(
      `CALL ${SCHEMA}.SP_SAVE_RATE_BUILDUP(${sqlStr(wp)}, ${sqlStr(String(b.lob ?? ""))}, ` +
      `${sqlStr(String(b.constituent ?? ""))}, ${Number(b.planYear ?? 2027)}, ${sqlStr(stepsJson)})`,
    )
    const result = rows.length ? String(Object.values(rows[0])[0] ?? "") : ""
    return Response.json({ result })
  } catch (e) {
    console.error(new Date().toISOString(), "[api/rate-buildup]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Save rate build-up failed" },
      { status: 500 },
    )
  }
}
