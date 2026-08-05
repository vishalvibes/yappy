import { useQuery } from "@tanstack/react-query"

import { apiFetch } from "@/lib/api"

export type ComponentHealth = {
  name: string
  status: "up" | "down" | "disabled"
  detail: string
  latency_ms: number | null
}

export type HealthMatrix = {
  status: "healthy" | "degraded"
  service: string
  environment: string
  components: ComponentHealth[]
}

export const healthMatrixQueryKey = ["health", "matrix"] as const

function fetchHealthMatrix() {
  return apiFetch<HealthMatrix>("/health/matrix")
}

// Polls every 15s so the matrix reflects a dependency going down while the page
// is open. /health/matrix never 500s — failures come back as "down" rows.
export function useHealthMatrixQuery() {
  return useQuery({
    queryKey: healthMatrixQueryKey,
    queryFn: fetchHealthMatrix,
    refetchInterval: 15_000,
  })
}
