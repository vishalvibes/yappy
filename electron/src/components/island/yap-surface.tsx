import type { RefObject } from "react"
import { ArrowUp, Check, CircleCheck, Copy, Loader2 } from "lucide-react"

import { Waveform } from "@/components/island/waveform"
import { YapButton } from "@/components/island/yap-button"
import type {
  YapPhase,
  YapWorkflow,
} from "@/components/island/use-yap-workflow"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type YapSurfaceProps = {
  contentRef: RefObject<HTMLDivElement | null>
  workflow: YapWorkflow
  onDismiss: () => void
  onMouseEnter: () => void
}

function headline(phase: YapPhase, generating: boolean): string | null {
  if (generating) return "Generating viral content…"
  if (phase === "listening") return "I am listening"
  if (phase === "tweet") return "Your tweet"
  if (phase === "idle") return "Yap or drop something interesting"
  return null
}

export function YapSurface({
  contentRef,
  workflow,
  onDismiss,
  onMouseEnter,
}: YapSurfaceProps) {
  const title = headline(workflow.phase, workflow.generating)

  return (
    <div
      ref={contentRef}
      className={cn(
        "flex w-full flex-col items-center",
        workflow.phase === "listening" ? "gap-2" : "gap-4",
      )}
      onMouseEnter={onMouseEnter}
    >
      {title ? (
        <p className="text-center text-[15px] font-medium tracking-tight text-white/90">
          {title}
        </p>
      ) : null}

      {workflow.phase === "listening" ? (
        <ListeningSurface workflow={workflow} />
      ) : null}
      {workflow.phase === "idle" ? (
        <YapButton onClick={() => void workflow.startListening()} />
      ) : null}
      {workflow.phase === "remembered" ? (
        <RememberedSurface workflow={workflow} onDismiss={onDismiss} />
      ) : null}
      {workflow.phase === "tweet" && workflow.tweet ? (
        <TweetSurface workflow={workflow} onDismiss={onDismiss} />
      ) : null}
    </div>
  )
}

function ListeningSurface({ workflow }: { workflow: YapWorkflow }) {
  return (
    <div className="relative flex h-[52px] w-full items-center justify-center">
      <Waveform active stream={workflow.micStream} />
      <button
        type="button"
        aria-label="Send yap"
        onClick={() => void workflow.sendYap()}
        className="absolute right-3 flex size-7 cursor-pointer items-center justify-center rounded-full bg-white/15 text-neutral-400 hover:bg-white/25 hover:text-white"
      >
        <ArrowUp className="size-4" strokeWidth={2.75} aria-hidden />
      </button>
    </div>
  )
}

function RememberedSurface({
  workflow,
  onDismiss,
}: {
  workflow: YapWorkflow
  onDismiss: () => void
}) {
  if (workflow.generating) {
    return (
      <Loader2
        className="size-5 animate-spin text-white/70"
        aria-label="Generating"
      />
    )
  }

  return (
    <div className="flex w-full max-w-[280px] flex-col items-center gap-3">
      {workflow.failed ? (
        <UploadFailure workflow={workflow} />
      ) : (
        <SavedYap workflow={workflow} onDismiss={onDismiss} />
      )}
      {workflow.failed ? (
        <button
          type="button"
          className="text-xs text-white/40 hover:text-white/70"
          onClick={onDismiss}
        >
          Done
        </button>
      ) : null}
    </div>
  )
}

function UploadFailure({ workflow }: { workflow: YapWorkflow }) {
  return (
    <>
      <p className="text-center text-[14px] font-medium text-white/85">
        {workflow.error ?? "Hey, oops — some issue occurred."}
      </p>
      <Button
        type="button"
        disabled={workflow.saving || !workflow.canRetry}
        className="h-9 w-full bg-white text-black hover:bg-white/90 disabled:opacity-40"
        style={{
          cursor:
            workflow.saving || !workflow.canRetry ? "not-allowed" : "pointer",
        }}
        onClick={() => void workflow.retrySend()}
      >
        {workflow.saving ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          "Try again"
        )}
      </Button>
    </>
  )
}

function SavedYap({
  workflow,
  onDismiss,
}: {
  workflow: YapWorkflow
  onDismiss: () => void
}) {
  return (
    <>
      <p className="flex items-center gap-1.5 text-[15px] font-medium tracking-tight text-white/90">
        <CircleCheck
          className="size-4 text-emerald-400"
          strokeWidth={2.25}
          aria-hidden
        />
        Saved
      </p>
      {workflow.error ? (
        <p className="text-center text-[12px] text-red-300">{workflow.error}</p>
      ) : null}
      <div className="flex items-center justify-center gap-1.5">
        <div className="size-10 shrink-0" aria-hidden />
        <button
          type="button"
          disabled={!workflow.saved || workflow.saving}
          className="flex h-10 cursor-pointer items-center justify-center rounded-[12px] bg-white px-5 text-[13px] font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => void workflow.generateContent()}
        >
          Generate content
        </button>
        <DoneButton onClick={onDismiss} />
      </div>
    </>
  )
}

function TweetSurface({
  workflow,
  onDismiss,
}: {
  workflow: YapWorkflow
  onDismiss: () => void
}) {
  return (
    <div className="flex w-full max-w-[300px] flex-col items-center gap-3">
      <p className="whitespace-pre-wrap text-center text-[13px] leading-snug text-white/85">
        {workflow.tweet}
      </p>
      {workflow.error ? (
        <p className="text-center text-[12px] text-red-300">{workflow.error}</p>
      ) : null}
      <div className="flex items-center justify-center gap-1.5">
        <div className="size-10 shrink-0" aria-hidden />
        <button
          type="button"
          className="flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-[12px] bg-white px-5 text-[13px] font-medium text-black hover:bg-white/90"
          onClick={() => void workflow.copyTweet()}
        >
          {workflow.copied ? (
            <>
              <Check className="size-3.5" strokeWidth={2.75} aria-hidden />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" strokeWidth={2.25} aria-hidden />
              Copy tweet
            </>
          )}
        </button>
        <DoneButton onClick={onDismiss} />
      </div>
    </div>
  )
}

function DoneButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Done"
      className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-[12px] border border-white/15 bg-white/10 text-white/70 hover:bg-white/15 hover:text-white/90"
      onClick={onClick}
    >
      <Check className="size-4" strokeWidth={2.5} aria-hidden />
    </button>
  )
}
