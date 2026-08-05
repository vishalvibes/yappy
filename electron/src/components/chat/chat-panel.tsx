import { useEffect, useRef, useState } from "react"
import { Loader2, SendHorizonal, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { streamChat, type ChatMessage } from "@/lib/chat-stream"
import { cn } from "@/lib/utils"

const SYSTEM_PROMPT = "You are a concise, helpful assistant."

// Streaming chat over POST /chat/stream. The assistant turn is appended empty
// and filled in as deltas arrive, so the UI renders token-by-token.
export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Drop any in-flight stream if the panel unmounts.
  useEffect(() => () => abortRef.current?.abort(), [])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || streaming) return

    const next: ChatMessage[] = [...messages, { role: "user", content: text }]
    setMessages([...next, { role: "assistant", content: "" }])
    setInput("")
    setError(null)
    setStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamChat(
        [{ role: "system", content: SYSTEM_PROMPT }, ...next],
        (delta) =>
          setMessages((prev) => {
            const copy = [...prev]
            const last = copy[copy.length - 1]
            copy[copy.length - 1] = { ...last, content: last.content + delta }
            return copy
          }),
        controller.signal,
      )
    } catch (err) {
      if ((err as Error).name === "AbortError") return
      setError(err instanceof Error ? err.message : "Stream failed")
      // Drop the empty assistant turn so the transcript stays clean.
      setMessages((prev) =>
        prev[prev.length - 1]?.content === "" ? prev.slice(0, -1) : prev,
      )
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  return (
    <section className="flex flex-1 flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Chat</h1>
        <p className="text-sm text-muted-foreground">
          Multi-turn chat streamed from <code>POST /chat/stream</code> as SSE.
        </p>
      </header>

      <div className="flex min-h-80 flex-1 flex-col gap-4 overflow-y-auto rounded-lg border p-4">
        {messages.length === 0 ? (
          <p className="m-auto text-sm text-muted-foreground">
            Say something to start the conversation.
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                m.role === "user"
                  ? "self-end bg-primary text-primary-foreground"
                  : "self-start bg-muted",
              )}
            >
              {m.content}
              {streaming &&
              i === messages.length - 1 &&
              m.role === "assistant" ? (
                <span className="animate-stream-caret">▍</span>
              ) : null}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <form onSubmit={send} className="flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              void send(e)
            }
          }}
          placeholder="Message… (Enter to send, Shift+Enter for a newline)"
          rows={2}
          className="resize-none"
        />
        {streaming ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => abortRef.current?.abort()}
          >
            <Square className="size-4" />
            Stop
          </Button>
        ) : (
          <Button type="submit" disabled={!input.trim()}>
            <SendHorizonal className="size-4" />
            Send
          </Button>
        )}
      </form>

      {streaming ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          streaming…
        </p>
      ) : null}
    </section>
  )
}
