import { NextRequest } from "next/server"
import {
  getTriangle, getIbnr, getMethodComparison, getRollforward,
  getActualToExpected, getLargeClaimPool,
} from "@/lib/actuarial"
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
  const tail = Number(sp.get("tail") ?? 1.004)
  const pooling = Number(sp.get("pooling") ?? 250000)
  try {
    const [triangle, ibnr, methods, rollforward, ae, pool] = await Promise.all([
      getTriangle(slice),
      getIbnr(slice),
      getMethodComparison(slice, tail, pooling),
      getRollforward(slice),
      getActualToExpected(slice),
      getLargeClaimPool(slice),
    ])
    return Response.json({ triangle, ibnr, methods, rollforward, ae, pool })
  } catch (e) {
    console.error(new Date().toISOString(), "[api/reserve]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load reserve data" },
      { status: 500 },
    )
  }
}
