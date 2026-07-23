import { NextRequest } from "next/server"
import { getPricingInput, getBidChecks, getRateBuildup } from "@/lib/actuarial"
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
  const planYear = Number(sp.get("planYear") ?? 2027)
  const workPaperId = sp.get("workPaperId") ?? ""
  try {
    const [pricing, bidChecks, rateBuildup] = await Promise.all([
      getPricingInput(slice, planYear),
      getBidChecks(slice, planYear),
      workPaperId ? getRateBuildup(workPaperId, slice, planYear) : Promise.resolve([]),
    ])
    return Response.json({ pricing, bidChecks, rateBuildup })
  } catch (e) {
    console.error(new Date().toISOString(), "[api/price]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load pricing data" },
      { status: 500 },
    )
  }
}
