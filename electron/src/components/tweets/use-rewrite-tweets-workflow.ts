import { useCallback, useEffect, useRef, useState } from "react"

import { useRewriteTweetsMutation } from "@/hooks/mutations/post/useRewriteTweetsMutation"
import { useVoiceRecorder } from "@/hooks/use-voice-recorder"
import { getApiErrorMessage } from "@/lib/api-error"

export type RewritePhase = "idle" | "listening" | "rewriting"

/**
 * Tweets-window rewrite session — record feedback → POST /yaps/rewrite-tweets.
 * Separate from the island yap → generate workflow.
 */
export function useRewriteTweetsWorkflow(tweets: string[]) {
  const [phase, setPhase] = useState<RewritePhase>("idle")
  const [error, setError] = useState<string | null>(null)

  const rewriteMutation = useRewriteTweetsMutation()

  const finishingRef = useRef(false)
  const tweetsRef = useRef(tweets)
  const sendFeedbackRef = useRef<() => Promise<string[] | null>>(
    async () => null,
  )
  const cancelRef = useRef<() => void>(() => {})

  useEffect(() => {
    tweetsRef.current = tweets
  }, [tweets])

  const recorder = useVoiceRecorder({
    onAutoStop: () => {
      void sendFeedbackRef.current()
    },
  })

  const cancel = useCallback(() => {
    recorder.bumpSession()
    finishingRef.current = false
    recorder.stopMic()
    setPhase("idle")
    setError(null)
    rewriteMutation.reset()
  }, [recorder, rewriteMutation])

  const sendFeedback = useCallback(async (): Promise<string[] | null> => {
    if (finishingRef.current) return null
    finishingRef.current = true
    const session = ++recorder.sessionRef.current
    try {
      const blob = await recorder.stopRecorder()

      if (session !== recorder.sessionRef.current) return null

      const drafts = tweetsRef.current.filter((t) => t.trim().length > 0)
      if (!blob?.size) {
        setPhase("idle")
        setError("Hey, oops — nothing recorded. Try again.")
        return null
      }
      if (!drafts.length) {
        setPhase("idle")
        setError("Hey, oops — no tweets to rewrite.")
        return null
      }

      setPhase("rewriting")
      setError(null)
      rewriteMutation.reset()

      try {
        const result = await rewriteMutation.mutateAsync({
          blob,
          tweets: drafts,
        })
        if (session !== recorder.sessionRef.current) return null
        setPhase("idle")
        return result.tweets
      } catch (err) {
        if (session !== recorder.sessionRef.current) return null
        setPhase("idle")
        setError(
          getApiErrorMessage(err, "Hey, oops — couldn’t rewrite. Try again?"),
        )
        return null
      }
    } finally {
      if (session === recorder.sessionRef.current) finishingRef.current = false
    }
  }, [recorder, rewriteMutation])

  useEffect(() => {
    sendFeedbackRef.current = sendFeedback
  }, [sendFeedback])

  useEffect(() => {
    cancelRef.current = cancel
  }, [cancel])

  // Escape cancels rewrite listening (same global shortcut as island yap).
  useEffect(() => {
    if (phase !== "listening") {
      void window.ipcRenderer.setEscapeEndsRecording(false)
      return
    }
    void window.ipcRenderer.setEscapeEndsRecording(true)
    const off = window.ipcRenderer.on("yap:escape-end", () => {
      cancelRef.current()
    })
    return () => {
      off()
      void window.ipcRenderer.setEscapeEndsRecording(false)
    }
  }, [phase])

  const startListening = useCallback(async () => {
    if (!tweetsRef.current.length) {
      setError("Hey, oops — no tweets to rewrite yet.")
      return
    }

    finishingRef.current = false
    setError(null)
    rewriteMutation.reset()
    setPhase("listening")

    const result = await recorder.startRecording()
    if (!result.ok) {
      if (result.error === "stale") return
      setPhase("idle")
      setError(result.error)
    }
  }, [recorder, rewriteMutation])

  return {
    phase,
    micStream: recorder.micStream,
    error,
    rewriting: phase === "rewriting" || rewriteMutation.isPending,
    startListening,
    sendFeedback,
    cancel,
  }
}

export type RewriteTweetsWorkflow = ReturnType<typeof useRewriteTweetsWorkflow>
