import { useCallback, useEffect, useRef, useState } from "react"

const DEFAULT_MAX_RECORDING_MS = 29_000

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

export type UseVoiceRecorderOptions = {
  maxMs?: number
  /** Called when the max-duration timer fires (auto-stop). */
  onAutoStop?: () => void
}

/**
 * Shared MediaRecorder session — mic permission, chunks, max-duration timer.
 * Callers own phase machines; this owns only the recorder lifecycle.
 */
export function useVoiceRecorder(options: UseVoiceRecorderOptions = {}) {
  const maxMs = options.maxMs ?? DEFAULT_MAX_RECORDING_MS
  const onAutoStopRef = useRef(options.onAutoStop)
  useEffect(() => {
    onAutoStopRef.current = options.onAutoStop
  }, [options.onAutoStop])

  const [micStream, setMicStream] = useState<MediaStream | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const recordingTimerRef = useRef<number | null>(null)
  const sessionRef = useRef(0)

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

  const bumpSession = useCallback(() => {
    sessionRef.current += 1
  }, [])

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

  const startRecording = useCallback(async (): Promise<
    | { ok: true; session: number }
    | { ok: false; session: number; error: string }
  > => {
    const session = ++sessionRef.current

    try {
      const allowed =
        (await window.ipcRenderer?.askMicrophoneAccess?.()) ?? true
      if (session !== sessionRef.current) {
        return { ok: false, session, error: "stale" }
      }
      if (!allowed) {
        stopMic()
        return { ok: false, session, error: "Microphone access denied" }
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
        return { ok: false, session, error: "stale" }
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
        onAutoStopRef.current?.()
      }, maxMs)
      return { ok: true, session }
    } catch (err) {
      if (session !== sessionRef.current) {
        return { ok: false, session, error: "stale" }
      }
      console.error("Failed to start recording:", err)
      stopMic()
      return { ok: false, session, error: "Could not open microphone" }
    }
  }, [maxMs, stopMic])

  useEffect(() => {
    return () => {
      sessionRef.current += 1
      clearRecordingTimer()
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [clearRecordingTimer])

  return {
    micStream,
    sessionRef,
    bumpSession,
    startRecording,
    stopRecorder,
    stopMic,
  }
}
