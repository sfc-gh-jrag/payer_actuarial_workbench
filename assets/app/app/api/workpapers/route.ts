import { NextRequest } from "next/server"
import { querySnowflake } from "@/lib/snowflake"
import { listWorkPapers, sqlStr } from "@/lib/actuarial"
import { SCHEMA, SIGNING_ACTUARY, VALUATION_DATE } from "@/lib/constants"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const workPapers = await listWorkPapers()
    return Response.json({ workPapers })
  } catch (e) {
    console.error(new Date().toISOString(), "[api/workpapers GET]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to list work papers" },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const action = String(body.action ?? "")
    const actor = String(body.actor ?? SIGNING_ACTUARY)
    let sql: string
    if (action === "create") {
      const name = sqlStr(String(body.name ?? "Untitled work paper"))
      const mode = sqlStr(String(body.mode ?? "reserve"))
      const lob = sqlStr(String(body.lob ?? "Medicare Advantage"))
      const constituent = sqlStr(String(body.constituent ?? "Medical"))
      const segment = sqlStr(String(body.segment ?? ""))
      const valuation = sqlStr(String(body.valuationDate ?? VALUATION_DATE))
      sql = `CALL ${SCHEMA}.SP_CREATE_WORK_PAPER(${name}, ${mode}, ${lob}, ${constituent}, ${segment}, ${valuation}::DATE, ${sqlStr(actor)})`
    } else if (action === "branch") {
      const sourceId = sqlStr(String(body.sourceId ?? ""))
      const name = sqlStr(String(body.name ?? "Branch"))
      sql = `CALL ${SCHEMA}.SP_BRANCH_WORK_PAPER(${sourceId}, ${name}, ${sqlStr(actor)})`
    } else if (action === "transition") {
      const id = sqlStr(String(body.workPaperId ?? ""))
      const toStatus = sqlStr(String(body.toStatus ?? ""))
      const note = sqlStr(String(body.note ?? ""))
      sql = `CALL ${SCHEMA}.SP_TRANSITION_WORK_PAPER(${id}, ${toStatus}, ${sqlStr(actor)}, ${note})`
    } else if (action === "delete") {
      const id = sqlStr(String(body.workPaperId ?? ""))
      sql = `CALL ${SCHEMA}.SP_DELETE_WORK_PAPER(${id}, ${sqlStr(actor)})`
    } else {
      return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
    const rows = await querySnowflake(sql)
    const result = rows.length ? Object.values(rows[0])[0] : null
    const resultStr = result == null ? "" : String(result)
    if (resultStr.toLowerCase().startsWith("error")) {
      return Response.json({ error: resultStr }, { status: 400 })
    }
    return Response.json({ result: resultStr })
  } catch (e) {
    console.error(new Date().toISOString(), "[api/workpapers POST]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Work paper action failed" },
      { status: 500 },
    )
  }
}
