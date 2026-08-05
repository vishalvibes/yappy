import { useMutation } from "@tanstack/react-query"

import { apiFetch } from "@/lib/api"

export type InferenceRequest = {
  prompt: string
  system?: string
  temperature?: number
}

export type InferenceResponse = {
  output: string
  model: string
}

function runInference(body: InferenceRequest) {
  return apiFetch<InferenceResponse>("/inference", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

// One prompt in, one completion out. Nothing is cached — each run is a fresh
// call — so this is a mutation rather than a query.
export function useInferenceMutation() {
  return useMutation({ mutationFn: runInference })
}
