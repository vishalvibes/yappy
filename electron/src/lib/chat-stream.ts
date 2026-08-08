// SSE client for POST /chat/stream.
//
// The backend emits the house event contract, one JSON object per `data:` line:
//
//   {"type":"response.created"}
//   {"type":"llm.response.init"}
//   {"type":"llm.response","content":"<delta>"}   (repeated)
//   {"type":"llm.response.done"}
//   {"type":"response.completed"}                 (terminator)
//   {"error":"..."}                               (failure mid-stream)
//
// apiFetch buffers the whole body, so streaming uses raw fetch + the same
// Authorization header.

import { API_BASE_URL } from "@/lib/api"
import { getAuthHeaderTokens } from "@/lib/auth-session-cache"

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string }

type StreamFrame = {
  type?: string
  content?: string
  error?: string
}

/** Stream a chat completion, invoking `onDelta` for each token chunk. */
export async function streamChat(
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { accessToken, refreshToken } = await getAuthHeaderTokens()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
    if (refreshToken) headers["x-refresh-token"] = refreshToken
  }

  const res = await fetch(`${API_BASE_URL}/chat/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ messages }),
    signal,
  })

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "")
    throw new Error(`API ${res.status} ${res.statusText}: ${body}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Frames are separated by a blank line; keep the trailing partial frame.
    const frames = buffer.split("\n\n")
    buffer = frames.pop() ?? ""

    for (const frame of frames) {
      const payload = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("")
      if (!payload) continue

      let parsed: StreamFrame
      try {
        parsed = JSON.parse(payload)
      } catch {
        continue // ignore keep-alives / malformed frames
      }

      if (parsed.error) throw new Error(parsed.error)
      if (parsed.type === "llm.response" && parsed.content) {
        onDelta(parsed.content)
      }
      if (parsed.type === "response.completed") return
    }
  }
}
