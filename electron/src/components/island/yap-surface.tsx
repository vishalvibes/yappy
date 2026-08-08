import { useEffect, useRef, type RefObject } from "react"
import { ArrowUp, Loader2, X } from "lucide-react"

import { CreateButton } from "@/components/island/create-button"
import { EyeButton } from "@/components/island/eye-button"
import { OkayButton } from "@/components/island/okay-button"
import { Waveform } from "@/components/island/waveform"
import { YapButton } from "@/components/island/yap-button"
import { YapStreakWeek } from "@/components/island/yap-streak-week"
import type {
  YapPhase,
  YapWorkflow,
} from "@/components/island/use-yap-workflow"
import { Button } from "@/components/ui/button"

const SUCCESS_AUTO_DISMISS_MS = 15_000

type YapSurfaceProps = {
  contentRef: RefObject<HTMLDivElement | null>
  workflow: YapWorkflow
  screenshotPreview: string | null
  capturing: boolean
  pointerInside: boolean
  onCapture: () => void
  onClearCapture: () => void
  onDismiss: () => void
  onMouseEnter: () => void
}

function headline(
  phase: YapPhase,
  generating: boolean,
  saving: boolean,
  capturing: boolean,
  hasPreview: boolean,
): string | null {
  if (generating) return "Generating viral content…"
  if (saving) return "Remembering…"
  if (capturing) return "Select an area…"
  if (phase === "listening" && hasPreview) return "Tell me about this"
  if (phase === "listening") return "I am listening"
  if (phase === "idle" && hasPreview) return "Tell me about this"
  if (phase === "idle") return "Yap or Show something interesting"
  return null
}

export function YapSurface({
  contentRef,
  workflow,
  screenshotPreview,
  capturing,
  pointerInside,
  onCapture,
  onClearCapture,
  onDismiss,
  onMouseEnter,
}: YapSurfaceProps) {
  const hasPreview = Boolean(screenshotPreview)
  const showingCapture =
    hasPreview &&
    (workflow.phase === "idle" || workflow.phase === "listening")
  const title = headline(
    workflow.phase,
    workflow.generating,
    workflow.saving,
    capturing,
    hasPreview,
  )

  return (
    <div
      ref={contentRef}
      className="flex w-full flex-col items-center gap-4"
      onMouseEnter={onMouseEnter}
    >
      {title ? (
        <p className="text-center text-[15px] font-medium tracking-tight text-white/90">
          {title}
        </p>
      ) : null}

      {showingCapture && screenshotPreview ? (
        <div className="relative w-full max-w-[320px]">
          <img
            src={screenshotPreview}
            alt="Screen capture"
            className="mx-auto max-h-[280px] w-full rounded-[12px] object-contain"
            draggable={false}
          />
          {workflow.phase === "idle" ? (
            <button
              type="button"
              aria-label="Clear capture"
              onClick={onClearCapture}
              className="absolute right-1.5 top-1.5 flex size-7 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.18)] backdrop-blur-[2px] hover:bg-black/70"
            >
              <X className="size-3.5" strokeWidth={2.75} aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}

      {workflow.phase === "listening" ? (
        <ListeningSurface workflow={workflow} />
      ) : null}
      {workflow.phase === "idle" ? (
        <div className="flex items-center gap-3">
          <YapButton onClick={() => void workflow.startListening()} />
          {!hasPreview ? (
            <EyeButton disabled={capturing} onClick={onCapture} />
          ) : null}
        </div>
      ) : null}
      {workflow.phase === "remembered" ? (
        <RememberedSurface
          workflow={workflow}
          pointerInside={pointerInside}
          onDismiss={onDismiss}
        />
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
  pointerInside,
  onDismiss,
}: {
  workflow: YapWorkflow
  pointerInside: boolean
  onDismiss: () => void
}) {
  if (workflow.generating || workflow.saving) {
    return (
      <Loader2
        className="size-5 animate-spin text-white/70"
        aria-label={workflow.generating ? "Generating" : "Remembering"}
      />
    )
  }

  return (
    <div className="flex w-full max-w-[280px] flex-col items-center gap-5">
      {workflow.failed ? (
        <UploadFailure workflow={workflow} />
      ) : (
        <SavedYap
          workflow={workflow}
          pointerInside={pointerInside}
          onDismiss={onDismiss}
        />
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
  pointerInside,
  onDismiss,
}: {
  workflow: YapWorkflow
  pointerInside: boolean
  onDismiss: () => void
}) {
  const stats = workflow.streakStats
  const armedRef = useRef(false)
  const onDismissRef = useRef(onDismiss)
  const pointerInsideRef = useRef(pointerInside)
  onDismissRef.current = onDismiss
  pointerInsideRef.current = pointerInside

  useEffect(() => {
    armedRef.current = false
    const timer = window.setTimeout(() => {
      armedRef.current = true
      if (!pointerInsideRef.current) onDismissRef.current()
    }, SUCCESS_AUTO_DISMISS_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (armedRef.current && !pointerInside) {
      onDismiss()
    }
  }, [pointerInside, onDismiss])

  return (
    <div className="flex w-full flex-col items-center gap-5">
      {stats ? <YapStreakWeek stats={stats} /> : null}
      {workflow.error ? (
        <p className="text-center text-[12px] text-red-300">{workflow.error}</p>
      ) : null}
      <div className="flex items-center justify-center gap-3">
        <OkayButton onClick={onDismiss} />
        <CreateButton
          disabled={!workflow.ready || workflow.saving || workflow.generating}
          onClick={() => {
            void (async () => {
              const ok = await workflow.generateContent()
              if (ok) onDismiss()
            })()
          }}
        />
      </div>
    </div>
  )
}
