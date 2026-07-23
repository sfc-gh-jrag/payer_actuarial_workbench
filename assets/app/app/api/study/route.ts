import { NextRequest } from "next/server"
import { getTrendSummary, getTrendDecomp, getTrendSelected, getTrendProjection } from "@/lib/actuarial"
import type { Lob, Constituent } from "@/lib/constants"
import type { Slice } from "@/lib/types"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const slice: Slice = {
    lob: (sp.get("lob") ?? "Medicare Advantage") as Lob,
    constituent: (sp.get("constituent") ?? "Medical") as Constituent,
    segment: sp.get("segment") ?? "",
  }
  const matureOnly = (sp.get("matureOnly") ?? "true") !== "false"
  try {
    const [summary, decomp, selected, projection] = await Promise.all([
      getTrendSummary(slice),
      getTrendDecomp(slice, matureOnly),
      getTrendSelected(slice),
      getTrendProjection(slice),
    ])
    return Response.json({ summary, decomp, selected, projection })
  } catch (e) {
    console.error(new Date().toISOString(), "[api/study]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load study data" },
      { status: 500 },
    )
  }
}
