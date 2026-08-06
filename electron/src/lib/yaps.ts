/** Yap API — upload+STT (sync), generate viral tweet (ephemeral). */

import { apiClient } from "@/lib/api"

export type YapStatus = "processing" | "ready" | "failed"

export type Yap = {
  id: string
  status: YapStatus
  transcript: string | null
  language_code: string | null
  error: string | null
}

export type GenerateTweetResult = {
  id: string
  tweet: string
}

/** Upload audio; waits for Sarvam STT + DB store. Returns ready yap on 201. */
export async function uploadYap(blob: Blob, filename = "yap.webm"): Promise<Yap> {
  // Bare audio/webm — Sarvam rejects MediaRecorder's audio/webm;codecs=opus.
  const file = new File([blob], filename, { type: "audio/webm" })
  const form = new FormData()
  form.append("file", file)
  const { data } = await apiClient.post<Yap>("/yaps", form, {
    timeout: 60_000,
  })
  return data
}

/** Generate a viral tweet from the yap — display only, not stored. */
export async function generateYapTweet(id: string): Promise<GenerateTweetResult> {
  const { data } = await apiClient.post<GenerateTweetResult>(
    `/yaps/${id}/generate`,
  )
  return data
}
