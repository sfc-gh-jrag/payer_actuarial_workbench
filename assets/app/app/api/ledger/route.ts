import { NextRequest } from "next/server"
import { getLedger, getWorkPaperEvents } from "@/lib/actuarial"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const workPaperId = req.nextUrl.searchParams.get("workPaperId") ?? ""
  if (!workPaperId) return Response.json({ ledger: [], events: [] })
  try {
    const [ledger, events] = await Promise.all([
      getLedger(workPaperId),
      getWorkPaperEvents(workPaperId),
    ])
    return Response.json({ ledger, events })
  } catch (e) {
    console.error(new Date().toISOString(), "[api/ledger]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load ledger" },
      { status: 500 },
    )
  }
}
