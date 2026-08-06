import { useCallback, useEffect, useRef, useState } from "react"

import { generateYapTweet, uploadYap, type Yap } from "@/lib/yaps"

export type YapPhase = "idle" | "listening" | "remembered" | "tweet"

const MAX_RECORDING_MS = 29_000

function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return ""
  for (const type of [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ]) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ""
}

/** Recording, upload, generation, retry, and clipboard state for one Yap. */
export function useYapWorkflow() {
  const [phase, setPhase] = useState<YapPhase>("idle")
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const [yap, setYap] = useState<Yap | null>(null)
  const [tweet, setTweet] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [canRetry, setCanRetry] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const pendingBlobRef = useRef<Blob | null>(null)
  const copiedTimerRef = useRef<number | null>(null)
  const recordingTimerRef = useRef<number | null>(null)
  const sessionRef = useRef(0)
  const finishingRef = useRef(false)

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current) {
      window.clearTimeout(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
  }, [])

  const stopMic = useCallback(() => {
    clearRecordingTimer()
    mediaRecorderRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setMicStream(null)
  }, [clearRecordingTimer])

  const stopRecorder = useCallback((): Promise<Blob | null> => {
    clearRecordingTimer()
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === "inactive") {
      stopMic()
      return Promise.resolve(null)
    }

    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = chunksRef.current.length
          ? new Blob(chunksRef.current, { type: "audio/webm" })
          : null
        chunksRef.current = []
        stopMic()
        resolve(blob)
      }
      recorder.stop()
    })
  }, [clearRecordingTimer, stopMic])

  const uploadBlob = useCallback(async (blob: Blob, session: number) => {
    setSaving(true)
    setError(null)
    setYap(null)
    try {
      const created = await uploadYap(blob)
      if (session !== sessionRef.current) return
      setYap(created)
      pendingBlobRef.current = null
      setCanRetry(false)
    } catch {
      if (session !== sessionRef.current) return
      setError("Hey, oops — some issue occurred. Try again?")
      setCanRetry(true)
      setYap({
        id: "",
        status: "failed",
        transcript: null,
        language_code: null,
        error: "upload failed",
      })
    } finally {
      if (session === sessionRef.current) setSaving(false)
    }
  }, [])

  const sendYap = useCallback(async () => {
    if (finishingRef.current) return
    finishingRef.current = true
    // Invalidate a permission/getUserMedia request if Send was clicked before
    // the recorder finished opening.
    const session = ++sessionRef.current
    const blob = await stopRecorder()

    if (session !== sessionRef.current) return

    setPhase("remembered")
    setError(null)
    setTweet(null)
    setCanRetry(false)

    if (!blob?.size) {
      pendingBlobRef.current = null
      setError("Hey, oops — nothing recorded. Try yapping again.")
      setYap({
        id: "",
        status: "failed",
        transcript: null,
        language_code: null,
        error: "empty",
      })
      finishingRef.current = false
      return
    }

    pendingBlobRef.current = blob
    await uploadBlob(blob, session)
    if (session === sessionRef.current) finishingRef.current = false
  }, [stopRecorder, uploadBlob])

  const startListening = useCallback(async () => {
    const session = ++sessionRef.current
    finishingRef.current = false
    setError(null)
    setTweet(null)
    setYap(null)
    setCopied(false)
    setPhase("listening")

    try {
      const allowed =
        (await window.ipcRenderer?.askMicrophoneAccess?.()) ?? true
      if (session !== sessionRef.current) return
      if (!allowed) {
        stopMic()
        setPhase("idle")
        setError("Microphone access denied")
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })
      if (session !== sessionRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      streamRef.current = stream
      setMicStream(stream)
      const mime = pickRecorderMime()
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data)
      }
      recorder.start(250)
      mediaRecorderRef.current = recorder
      recordingTimerRef.current = window.setTimeout(() => {
        void sendYap()
      }, MAX_RECORDING_MS)
    } catch {
      if (session !== sessionRef.current) return
      stopMic()
      setPhase("idle")
      setError("Could not open microphone")
    }
  }, [sendYap, stopMic])

  const retrySend = useCallback(async () => {
    const blob = pendingBlobRef.current
    if (!blob) {
      setCanRetry(false)
      setError("Hey, oops — recording is gone. Yap again.")
      return
    }
    await uploadBlob(blob, sessionRef.current)
  }, [uploadBlob])

  const generateContent = useCallback(async () => {
    if (!yap?.id || yap.status !== "ready" || saving || generating) return
    setGenerating(true)
    setError(null)
    try {
      const result = await generateYapTweet(yap.id)
      setCopied(false)
      setTweet(result.tweet)
      setPhase("tweet")
    } catch {
      setError("Hey, oops — couldn’t generate. Try again?")
    } finally {
      setGenerating(false)
    }
  }, [generating, saving, yap])

  const copyTweet = useCallback(async () => {
    if (!tweet) return
    try {
      await navigator.clipboard.writeText(tweet)
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current)
      setError(null)
      setCopied(true)
      copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
      setError("Hey, oops — couldn’t copy. Try again?")
    }
  }, [tweet])

  const dismiss = useCallback(() => {
    sessionRef.current += 1
    finishingRef.current = false
    stopMic()
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current)
    setPhase("idle")
    setYap(null)
    setTweet(null)
    setError(null)
    setCopied(false)
    setSaving(false)
    setCanRetry(false)
    setGenerating(false)
    pendingBlobRef.current = null
  }, [stopMic])

  useEffect(() => {
    return () => {
      sessionRef.current += 1
      clearRecordingTimer()
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current)
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [clearRecordingTimer])

  return {
    phase,
    micStream,
    tweet,
    error,
    saving,
    canRetry,
    generating,
    copied,
    pinned: phase === "listening" || phase === "remembered" || phase === "tweet",
    saved: phase === "remembered" && yap?.status === "ready",
    failed: phase === "remembered" && yap?.status === "failed",
    startListening,
    sendYap,
    retrySend,
    generateContent,
    copyTweet,
    dismiss,
  }
}

export type YapWorkflow = ReturnType<typeof useYapWorkflow>
