import { useState } from "react"
import { Loader2, Play } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useInferenceMutation } from "@/hooks/mutations/post/useInferenceMutation"

// The simplest LLM surface: one prompt, one buffered completion from
// POST /inference. Use this to sanity-check the Azure wiring before touching
// the streaming path.
export function InferencePanel() {
  const [prompt, setPrompt] = useState("")
  const [system, setSystem] = useState("You are a concise, helpful assistant.")
  const run = useInferenceMutation()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = prompt.trim()
    if (!text) return
    run.mutate({ prompt: text, system: system.trim() || undefined })
  }

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Inference</h1>
        <p className="text-sm text-muted-foreground">
          One-shot completion from <code>POST /inference</code>.
        </p>
      </header>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="system">System prompt</Label>
          <Input
            id="system"
            value={system}
            onChange={(e) => setSystem(e.target.value)}
            placeholder="Optional"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="prompt">Prompt</Label>
          <Textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder="Ask anything…"
          />
        </div>

        <Button
          type="submit"
          className="self-start"
          disabled={run.isPending || !prompt.trim()}
        >
          {run.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
          Run
        </Button>
      </form>

      {run.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {run.error instanceof Error ? run.error.message : "Inference failed"}
        </p>
      ) : null}

      {run.data ? (
        <div className="flex flex-col gap-2 rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">
            model: <code>{run.data.model}</code>
          </p>
          <p className="text-sm whitespace-pre-wrap">{run.data.output}</p>
        </div>
      ) : null}
    </section>
  )
}
