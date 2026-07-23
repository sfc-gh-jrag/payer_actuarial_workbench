import { listWorkPapers } from "@/lib/actuarial"
import { Workbench } from "@/components/workbench/workbench"
import type { WorkPaper } from "@/lib/types"

// Snowflake is unreachable during docker build.
export const dynamic = "force-dynamic"

export default async function Home() {
  let workPapers: WorkPaper[] = []
  let loadError: string | null = null
  try {
    workPapers = await listWorkPapers()
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Failed to load work papers"
  }
  return <Workbench initialWorkPapers={workPapers} loadError={loadError} />
}
