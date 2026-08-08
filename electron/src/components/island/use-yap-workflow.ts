import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useGenerateYapTweetsMutation } from "@/hooks/mutations/post/useGenerateYapTweetsMutation"
import { useUploadYapMutation } from "@/hooks/mutations/post/useUploadYapMutation"
import { useVoiceRecorder } from "@/hooks/use-voice-recorder"
import { getApiErrorMessage } from "@/lib/api-error"
import { displayYapStats, type Yap, type YapStats } from "@/lib/yaps"

export type YapPhase = "idle" | "listening" | "remembered"

const FAILED_EMPTY: Yap = {
  id: null,
  stored: false,
  status: "failed",
  transcript: null,
  reference: null,
  language_code: null,
  error: "empty",
}

const FAILED_UPLOAD: Yap = {
  id: null,
  stored: false,
  status: "failed",
  transcript: null,
  reference: null,
  language_code: null,
  error: "upload failed",
}

/**
 * Island yap session — mirrors harmony `useNotetakerRecorderOwner`:
 * local recorder/phase state + TanStack mutations for server writes.
 */
export function useYapWorkflow() {
  const [phase, setPhase] = useState<YapPhase>("idle")
  const [error, setError] = useState<string | null>(null)
  const [emptyFail, setEmptyFail] = useState(false)
  const [hasPendingBlob, setHasPendingBlob] = useState(false)

  const uploadYapMutation = useUploadYapMutation()
  const generateYapTweetsMutation = useGenerateYapTweetsMutation()

  const pendingBlobRef = useRef<Blob | null>(null)
  const imageAttachmentRef = useRef<string | null>(null)
  const finishingRef = useRef(false)
  const sendYapRef = useRef<() => Promise<void>>(async () => {})

  const recorder = useVoiceRecorder({
    onAutoStop: () => {
      void sendYapRef.current()
    },
  })

  const yap = useMemo((): Yap | null => {
    if (emptyFail) return FAILED_EMPTY
    if (uploadYapMutation.isError) return FAILED_UPLOAD
    return uploadYapMutation.data ?? null
  }, [emptyFail, uploadYapMutation.data, uploadYapMutation.isError])

  const saving = uploadYapMutation.isPending
  const generating = generateYapTweetsMutation.isPending
  const canRetry = hasPendingBlob && uploadYapMutation.isError

  const runUpload = useCallback(
    async (blob: Blob, session: number) => {
      setError(null)
      try {
        await uploadYapMutation.mutateAsync({
          blob,
          imageDataUrl: imageAttachmentRef.current,
        })
        if (session !== recorder.sessionRef.current) return
        pendingBlobRef.current = null
        setHasPendingBlob(false)
      } catch (err) {
        if (session !== recorder.sessionRef.current) return
        setError(getApiErrorMessage(err))
      }
    },
    [recorder.sessionRef, uploadYapMutation],
  )

  const setImageAttachment = useCallback((dataUrl: string | null) => {
    imageAttachmentRef.current = dataUrl
  }, [])

  const sendYap = useCallback(async () => {
    if (finishingRef.current) return
    finishingRef.current = true
    // Invalidate a permission/getUserMedia request if Send was clicked before
    // the recorder finished opening.
    const session = ++recorder.sessionRef.current
    try {
      const blob = await recorder.stopRecorder()

      if (session !== recorder.sessionRef.current) return

      setPhase("remembered")
      setError(null)
      setEmptyFail(false)
      uploadYapMutation.reset()
      generateYapTweetsMutation.reset()

      if (!blob?.size) {
        pendingBlobRef.current = null
        setHasPendingBlob(false)
        setEmptyFail(true)
        setError("Hey, oops — nothing recorded. Try yapping again.")
        return
      }

      pendingBlobRef.current = blob
      setHasPendingBlob(true)
      await runUpload(blob, session)
    } finally {
      if (session === recorder.sessionRef.current) finishingRef.current = false
    }
  }, [
    generateYapTweetsMutation,
    recorder,
    runUpload,
    uploadYapMutation,
  ])

  useEffect(() => {
    sendYapRef.current = sendYap
  }, [sendYap])

  const startListening = useCallback(async () => {
    finishingRef.current = false
    setError(null)
    setEmptyFail(false)
    uploadYapMutation.reset()
    generateYapTweetsMutation.reset()
    setPhase("listening")

    const result = await recorder.startRecording()
    if (!result.ok) {
      if (result.error === "stale") return
      setPhase("idle")
      setError(result.error)
    }
  }, [generateYapTweetsMutation, recorder, uploadYapMutation])

  const retrySend = useCallback(async () => {
    const blob = pendingBlobRef.current
    if (!blob) {
      setHasPendingBlob(false)
      setError("Hey, oops — recording is gone. Yap again.")
      return
    }
    uploadYapMutation.reset()
    await runUpload(blob, recorder.sessionRef.current)
  }, [recorder.sessionRef, runUpload, uploadYapMutation])

  const generateContent = useCallback(async (): Promise<boolean> => {
    const ready = uploadYapMutation.data
    if (
      !ready ||
      ready.status !== "ready" ||
      uploadYapMutation.isPending ||
      generateYapTweetsMutation.isPending
    ) {
      return false
    }
    setError(null)
    try {
      const result = await generateYapTweetsMutation.mutateAsync({
        yap_id: ready.id,
        transcript: ready.transcript,
        reference: ready.reference,
        screen_kind: ready.screen_kind,
      })
      const opened = await window.ipcRenderer.openTweetsWindow(result.tweets)
      if (!opened.ok) {
        setError("Hey, oops — couldn’t open tweets. Try again?")
        return false
      }
      return true
    } catch (err) {
      console.error("Failed to generate yap content:", err)
      setError(
        getApiErrorMessage(err, "Hey, oops — couldn’t generate. Try again?"),
      )
      return false
    }
  }, [generateYapTweetsMutation, uploadYapMutation])

  const dismiss = useCallback(() => {
    recorder.bumpSession()
    finishingRef.current = false
    recorder.stopMic()
    imageAttachmentRef.current = null
    pendingBlobRef.current = null
    setHasPendingBlob(false)
    setEmptyFail(false)
    setPhase("idle")
    setError(null)
    uploadYapMutation.reset()
    generateYapTweetsMutation.reset()
  }, [generateYapTweetsMutation, recorder, uploadYapMutation])

  // Enable global Escape while listening — island handler cancels to idle.
  useEffect(() => {
    void window.ipcRenderer.setEscapeEndsRecording(phase === "listening")
    return () => {
      void window.ipcRenderer.setEscapeEndsRecording(false)
    }
  }, [phase])

  const streakStats: YapStats | null = useMemo(() => {
    if (phase !== "remembered" || !yap || yap.status !== "ready") return null
    return displayYapStats(yap)
  }, [phase, yap])

  return {
    phase,
    micStream: recorder.micStream,
    error,
    saving,
    canRetry,
    generating,
    pinned: phase === "listening" || phase === "remembered",
    // Ready for generate — includes ephemeral (stored:false) instruction-only yaps.
    ready: phase === "remembered" && yap?.status === "ready",
    // Actually persisted to memory.
    saved: phase === "remembered" && yap?.status === "ready" && yap.stored,
    failed: phase === "remembered" && yap?.status === "failed",
    streakStats,
    setImageAttachment,
    startListening,
    sendYap,
    retrySend,
    generateContent,
    dismiss,
  }
}

export type YapWorkflow = ReturnType<typeof useYapWorkflow>
