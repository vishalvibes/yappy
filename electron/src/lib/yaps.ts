/** Yap API — upload+STT (sync), generate / rewrite viral tweet variants. */

import { apiClient } from "@/lib/api"

/** Sync STT — create always returns ready|failed (no async processing). */
export type YapStatus = "ready" | "failed"

export type YapDay = {
  date: string
  posted: boolean
}

export type YapStats = {
  streak: number
  week: YapDay[]
}

export type Yap = {
  id: string | null
  stored: boolean
  status: YapStatus
  /** User viewpoint only. */
  transcript: string | null
  /** Screen vision + other-speaker audio. */
  reference: string | null
  language_code: string | null
  error: string | null
  /** From screenshot vision: social_post → reply; other → create content. */
  screen_kind?: "social_post" | "other" | null
  stats?: YapStats | null
}

export type GenerateTweetsInput = {
  yap_id?: string | null
  transcript?: string | null
  reference?: string | null
  screen_kind?: "social_post" | "other" | null
}

export type GenerateTweetsResult = {
  id: string | null
  tweets: string[]
  screen_kind?: "social_post" | "other" | null
  /** Which generation path ran. */
  mode?: "reply" | "create"
}

export type RewriteTweetsResult = {
  tweets: string[]
  feedback: string
}

export type UploadYapOptions = {
  filename?: string
  /** data:image/...;base64,... — described server-side via OpenAI vision */
  imageDataUrl?: string | null
}

function dataUrlToFile(dataUrl: string, filename: string): File | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl)
  if (!match) return null
  const mime = match[1] || "image/png"
  const binary = atob(match[2]!)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png"
  return new File([bytes], filename.replace(/\.\w+$/, `.${ext}`), { type: mime })
}

/**
 * Stats for the success surface. Ephemeral yaps never hit the DB, so bump
 * today to posted and extend streak when the server run ended yesterday.
 */
export function displayYapStats(yap: Yap): YapStats {
  const stats = yap.stats
  if (!stats?.week?.length) {
    return { streak: 1, week: localWeekWithTodayPosted() }
  }
  if (yap.stored) return stats

  const today = localDateKey()
  const yesterday = shiftDateKey(today, -1)
  const todayPostedOnServer = stats.week.some(
    (d) => d.date === today && d.posted,
  )
  const week = stats.week.map((day) =>
    day.date === today ? { ...day, posted: true } : day,
  )

  if (todayPostedOnServer) {
    return { streak: stats.streak, week }
  }

  const yesterdayPosted = stats.week.some(
    (d) => d.date === yesterday && d.posted,
  )
  // Server streak ends on the latest posted day ≤ today. With today absent,
  // a positive streak that includes yesterday becomes streak+1; otherwise 1.
  const streak =
    yesterdayPosted && stats.streak > 0 ? stats.streak + 1 : 1

  return { streak, week }
}

function localDateKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function shiftDateKey(key: string, deltaDays: number): string {
  const [y, m, d] = key.split("-").map(Number)
  const dt = new Date(y!, m! - 1, d!)
  dt.setDate(dt.getDate() + deltaDays)
  return localDateKey(dt)
}

function localWeekWithTodayPosted(): YapStats["week"] {
  const today = new Date()
  const day = today.getDay() // 0 Sun
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(today)
  monday.setDate(today.getDate() + mondayOffset)
  const todayKey = localDateKey(today)
  const week: YapDay[] = []
  for (let i = 0; i < 7; i++) {
    const dt = new Date(monday)
    dt.setDate(monday.getDate() + i)
    const key = localDateKey(dt)
    week.push({ date: key, posted: key === todayKey })
  }
  return week
}

/** Upload audio (+ optional screenshot); waits for STT / vision + optional DB store. */
export async function uploadYap(
  blob: Blob,
  options: UploadYapOptions = {},
): Promise<Yap> {
  const filename = options.filename ?? "yap.webm"
  // Bare audio/webm — Sarvam rejects MediaRecorder's audio/webm;codecs=opus.
  const file = new File([blob], filename, { type: "audio/webm" })
  const form = new FormData()
  form.append("file", file)
  form.append("tz", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")

  if (options.imageDataUrl) {
    const image = dataUrlToFile(options.imageDataUrl, "capture.png")
    if (image) form.append("image", image)
  }

  const { data } = await apiClient.post<Yap>("/yaps", form, {
    timeout: 120_000,
  })
  return data
}

/** Generate viral tweet variants from session memory — display only, not stored. */
export async function generateYapTweets(
  input: GenerateTweetsInput,
): Promise<GenerateTweetsResult> {
  const { data } = await apiClient.post<GenerateTweetsResult>(
    "/yaps/generate",
    {
      yap_id: input.yap_id ?? null,
      transcript: input.transcript ?? null,
      reference: input.reference ?? null,
      screen_kind: input.screen_kind ?? null,
    },
  )
  return data
}

/** Voice feedback + current drafts → rewritten variants (ephemeral). */
export async function rewriteTweets(
  blob: Blob,
  tweets: string[],
): Promise<RewriteTweetsResult> {
  const file = new File([blob], "feedback.webm", { type: "audio/webm" })
  const form = new FormData()
  form.append("file", file)
  form.append("tweets", JSON.stringify(tweets))

  const { data } = await apiClient.post<RewriteTweetsResult>(
    "/yaps/rewrite-tweets",
    form,
    { timeout: 120_000 },
  )
  return data
}
