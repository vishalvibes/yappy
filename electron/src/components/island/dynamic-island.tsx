import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowUp, Check, CircleCheck, Loader2 } from "lucide-react"

import { useAuth } from "@/components/auth-provider"
import { Waveform } from "@/components/island/waveform"
import { YapButton } from "@/components/island/yap-button"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  generateYapTweet,
  uploadYap,
  type Yap,
} from "@/lib/yaps"
import googleLogo from "@/assets/icons/svg/google.svg"
import yappyLogo from "@/assets/yappy-logo.png"

type IslandMode = "collapsed" | "pill" | "expanded"

/** Signed-in yap surface phases after idle. */
type YapPhase = "idle" | "listening" | "remembered" | "tweet"

const AUTH_WIDTH = 340
const AUTH_BOTTOM_PAD = 16
const AUTH_GAP_BELOW_NOTCH = 12

const YAP_WIDTH = 360
const YAP_BOTTOM_PAD = 24
const YAP_GAP_BELOW_NOTCH = 10
/** Collapsed hover band — matches notch width, not the full pill window. */
const NOTCH_HIT_WIDTH = 184

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

export function DynamicIsland() {
  const {
    user,
    signInWithGoogle,
    configError,
    googlePending,
  } = useAuth()
  const [mode, setMode] = useState<IslandMode>("collapsed")
  const [yapPhase, setYapPhase] = useState<YapPhase>("idle")
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const [yap, setYap] = useState<Yap | null>(null)
  const [tweet, setTweet] = useState<string | null>(null)
  const [yapError, setYapError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [canRetry, setCanRetry] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [notchPad, setNotchPad] = useState(32)
  const leaveTimer = useRef<number | null>(null)
  const pointerInside = useRef(false)
  const wasGooglePending = useRef(false)
  const authContentRef = useRef<HTMLDivElement>(null)
  const yapContentRef = useRef<HTMLDivElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  /** Bumped on stop/send so a late getUserMedia result is discarded. */
  const listenSessionRef = useRef(0)
  /** Keep last recording so a failed upload can retry without re-yapping. */
  const pendingBlobRef = useRef<Blob | null>(null)

  const isAuthExpanded = mode === "expanded" && !user
  const isYapSurface = Boolean(user) && mode === "pill"
  const isYapListening = isYapSurface && yapPhase === "listening"
  const isYapPinned =
    yapPhase === "listening" ||
    yapPhase === "remembered" ||
    yapPhase === "tweet"

  const resize = useCallback(
    async (next: IslandMode) => {
      setMode(next)
      if (next === "expanded" && !user) {
        await window.ipcRenderer.resizeIslandTo({
          width: AUTH_WIDTH,
          height: notchPad + 130,
        })
        return
      }
      if (next === "pill" && user) {
        await window.ipcRenderer.resizeIslandTo({
          width: YAP_WIDTH,
          height: notchPad + 120,
        })
        return
      }
      await window.ipcRenderer.resizeIsland(next)
    },
    [user, notchPad],
  )

  const fitAuthHeight = useCallback(() => {
    const el = authContentRef.current
    if (!el) return
    const contentH = Math.ceil(el.getBoundingClientRect().height)
    const height = notchPad + AUTH_GAP_BELOW_NOTCH + contentH + AUTH_BOTTOM_PAD
    void window.ipcRenderer.resizeIslandTo({ width: AUTH_WIDTH, height })
  }, [notchPad])

  const fitYapHeight = useCallback(() => {
    const el = yapContentRef.current
    if (!el) return
    const contentH = Math.ceil(el.getBoundingClientRect().height)
    const height = notchPad + YAP_GAP_BELOW_NOTCH + contentH + YAP_BOTTOM_PAD
    void window.ipcRenderer.resizeIslandTo({ width: YAP_WIDTH, height })
  }, [notchPad])

  function stopMic() {
    mediaRecorderRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setMicStream(null)
  }

  useEffect(() => {
    void window.ipcRenderer.getMenuBarHeight().then(setNotchPad)
    void resize("collapsed")
    return () => {
      if (leaveTimer.current) window.clearTimeout(leaveTimer.current)
      stopMic()
    }
  }, [resize])

  useLayoutEffect(() => {
    if (!isAuthExpanded) return
    const el = authContentRef.current
    if (!el) return
    fitAuthHeight()
    const ro = new ResizeObserver(() => fitAuthHeight())
    ro.observe(el)
    return () => ro.disconnect()
  }, [isAuthExpanded, fitAuthHeight, googlePending, authError, configError])

  useLayoutEffect(() => {
    if (!isYapSurface) return
    const el = yapContentRef.current
    if (!el) return
    fitYapHeight()
    const ro = new ResizeObserver(() => fitYapHeight())
    ro.observe(el)
    return () => ro.disconnect()
  }, [
    isYapSurface,
    yapPhase,
    yap,
    tweet,
    yapError,
    saving,
    generating,
    fitYapHeight,
  ])

  useEffect(() => {
    if (googlePending) wasGooglePending.current = true
    if (wasGooglePending.current && user && !googlePending) {
      wasGooglePending.current = false
      void resize("pill")
    }
  }, [user, googlePending, resize])

  function clearLeaveTimer() {
    if (leaveTimer.current) {
      window.clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
  }

  function onEnter() {
    // Cancel pending collapse when the pointer returns to an open island.
    pointerInside.current = true
    clearLeaveTimer()
  }

  /**
   * Two open modes:
   * - Hover-open: collapses shortly after leave (idle Yap / auth).
   * - Pinned-open: listening / remembered / tweet — stay until dismiss.
   */
  function onLeave() {
    pointerInside.current = false
    if (googlePending || isYapPinned) return
    clearLeaveTimer()
    leaveTimer.current = window.setTimeout(() => {
      void resize("collapsed")
    }, 280)
  }

  /** Collapsed window may stay pill-wide (no ghost). Only the center notch band expands. */
  useEffect(() => {
    if (mode !== "collapsed") {
      void window.ipcRenderer.setIgnoreMouseEvents(false)
      return
    }

    void window.ipcRenderer.setIgnoreMouseEvents(true, { forward: true })

    let opened = false

    function expandFromNotch() {
      if (opened) return
      opened = true
      pointerInside.current = true
      clearLeaveTimer()
      void window.ipcRenderer.setIgnoreMouseEvents(false)
      void resize(user ? "pill" : "expanded")
    }

    function onMove(e: MouseEvent) {
      if (opened) return
      const w = window.innerWidth
      const hit = Math.min(NOTCH_HIT_WIDTH, w)
      const left = (w - hit) / 2
      const inNotch = e.clientX >= left && e.clientX <= left + hit
      if (inNotch) {
        expandFromNotch()
      } else {
        void window.ipcRenderer.setIgnoreMouseEvents(true, { forward: true })
      }
    }

    window.addEventListener("mousemove", onMove)
    return () => {
      window.removeEventListener("mousemove", onMove)
      void window.ipcRenderer.setIgnoreMouseEvents(false)
    }
  }, [mode, user, resize])

  function maybeCollapseAfterUnpin() {
    if (!pointerInside.current) {
      clearLeaveTimer()
      leaveTimer.current = window.setTimeout(() => {
        void resize("collapsed")
      }, 180)
    }
  }

  async function startListening() {
    clearLeaveTimer()
    setYapError(null)
    setTweet(null)
    setYap(null)
    const session = ++listenSessionRef.current
    // Instant UI swap — open mic after the listening surface is already up.
    setYapPhase("listening")
    if (mode === "collapsed") void resize("pill")

    try {
      const allowed =
        (await window.ipcRenderer?.askMicrophoneAccess?.()) ?? true
      if (session !== listenSessionRef.current) return
      if (!allowed) {
        stopMic()
        setYapPhase("idle")
        setYapError("Microphone access denied")
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
      if (session !== listenSessionRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      streamRef.current = stream
      setMicStream(stream)

      const mime = pickRecorderMime()
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.start(250)
      mediaRecorderRef.current = recorder
    } catch {
      if (session !== listenSessionRef.current) return
      stopMic()
      setYapPhase("idle")
      setYapError("Could not open microphone")
    }
  }

  function stopRecorder(): Promise<Blob | null> {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === "inactive") {
      stopMic()
      return Promise.resolve(null)
    }
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob =
          chunksRef.current.length > 0
            ? new Blob(chunksRef.current, { type: "audio/webm" })
            : null
        chunksRef.current = []
        stopMic()
        resolve(blob)
      }
      recorder.stop()
    })
  }

  async function uploadBlob(blob: Blob) {
    setSaving(true)
    setYapError(null)
    setYap(null)
    try {
      const created = await uploadYap(blob)
      setYap(created)
      pendingBlobRef.current = null
      setCanRetry(false)
    } catch {
      setYapError("Hey, oops — some issue occurred. Try again?")
      setCanRetry(true)
      setYap({
        id: "",
        status: "failed",
        transcript: null,
        language_code: null,
        error: "upload failed",
      })
    } finally {
      setSaving(false)
    }
  }

  async function sendYap() {
    clearLeaveTimer()
    listenSessionRef.current += 1
    const blob = await stopRecorder()
    // Instant success surface — green check + Saved while we wait for 200.
    setYapPhase("remembered")
    setYapError(null)
    setTweet(null)
    setCanRetry(false)

    if (!blob || blob.size === 0) {
      pendingBlobRef.current = null
      setCanRetry(false)
      setYapError("Hey, oops — nothing recorded. Try yapping again.")
      setYap({
        id: "",
        status: "failed",
        transcript: null,
        language_code: null,
        error: "empty",
      })
      return
    }

    pendingBlobRef.current = blob
    await uploadBlob(blob)
  }

  async function retrySend() {
    const blob = pendingBlobRef.current
    if (!blob) {
      setCanRetry(false)
      setYapError("Hey, oops — recording is gone. Yap again.")
      return
    }
    await uploadBlob(blob)
  }

  async function onGenerateContent() {
    if (!yap?.id || yap.status !== "ready" || saving) return
    setGenerating(true)
    setYapError(null)
    try {
      const result = await generateYapTweet(yap.id)
      setTweet(result.tweet)
      setYapPhase("tweet")
    } catch {
      setYapError("Hey, oops — couldn’t generate. Try again?")
    } finally {
      setGenerating(false)
    }
  }

  function dismissYap() {
    setYapPhase("idle")
    setYap(null)
    setTweet(null)
    setYapError(null)
    setSaving(false)
    setCanRetry(false)
    setGenerating(false)
    pendingBlobRef.current = null
    maybeCollapseAfterUnpin()
  }

  async function submitGoogle() {
    setAuthError(null)
    try {
      await signInWithGoogle()
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Google sign-in failed")
    }
  }

  const savedOk = yapPhase === "remembered" && yap?.status === "ready" && !yapError
  const savedFailed =
    yapPhase === "remembered" && (yap?.status === "failed" || Boolean(yapError))
  const headline =
    yapPhase === "listening"
      ? "I am listening"
      : yapPhase === "tweet"
        ? "Your tweet"
        : yapPhase === "remembered"
          ? null
          : "Yap or drop something interesting"

  return (
    <div
      className="flex h-screen w-screen items-stretch justify-center bg-transparent"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div
        className={cn(
          "flex h-full w-full flex-col items-center overflow-hidden text-white",
          mode === "collapsed" && "justify-start bg-transparent pt-3",
          isYapSurface &&
            "justify-start rounded-t-none rounded-b-[28px] bg-black px-5",
          isAuthExpanded &&
            "justify-start rounded-t-none rounded-b-[28px] bg-black px-5",
          mode === "pill" &&
            !user &&
            "justify-end rounded-t-none rounded-b-[28px] bg-black px-5 pb-4",
        )}
        style={
          mode === "pill" || mode === "expanded"
            ? {
                paddingTop:
                  notchPad +
                  (isAuthExpanded || isYapSurface
                    ? isYapSurface
                      ? YAP_GAP_BELOW_NOTCH
                      : AUTH_GAP_BELOW_NOTCH
                    : 8),
                ...((isAuthExpanded || isYapSurface)
                  ? {
                      paddingBottom: isYapSurface
                        ? YAP_BOTTOM_PAD
                        : AUTH_BOTTOM_PAD,
                    }
                  : null),
              }
            : undefined
        }
      >
        {mode === "collapsed" ? (
          <div
            className="h-[5px] w-14 rounded-full bg-neutral-500/35 shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.2),0_0_0_0.5px_rgba(0,0,0,0.12)]"
            aria-hidden
          />
        ) : null}

        {mode === "pill" && !user ? (
          <button
            type="button"
            className="text-[15px] font-medium tracking-tight"
            onClick={() => void resize("expanded")}
          >
            Sign in to Yappy
          </button>
        ) : null}

        {isYapSurface ? (
          <div
            ref={yapContentRef}
            className={cn(
              "flex w-full flex-col items-center",
              isYapListening ? "gap-2" : "gap-4",
            )}
            onMouseEnter={clearLeaveTimer}
          >
            {headline ? (
              <p className="text-center text-[15px] font-medium tracking-tight text-white/90">
                {headline}
              </p>
            ) : null}

            {yapPhase === "listening" ? (
              <div className="relative flex h-[52px] w-full items-center justify-center">
                <Waveform active stream={micStream} />
                <button
                  type="button"
                  aria-label="Send yap"
                  onClick={() => void sendYap()}
                  className="absolute right-3 flex size-7 cursor-pointer items-center justify-center rounded-full bg-white/15 text-neutral-400 hover:bg-white/25 hover:text-white"
                >
                  <ArrowUp className="size-4" strokeWidth={2.75} aria-hidden />
                </button>
              </div>
            ) : null}

            {yapPhase === "idle" ? (
              <YapButton onClick={() => void startListening()} />
            ) : null}

            {yapPhase === "remembered" ? (
              <div className="flex w-full max-w-[280px] flex-col items-center gap-3">
                {savedFailed ? (
                  <>
                    <p className="text-center text-[14px] font-medium text-white/85">
                      {yapError ?? "Hey, oops — some issue occurred."}
                    </p>
                    <Button
                      type="button"
                      disabled={saving || !canRetry}
                      className="h-9 w-full bg-white text-black hover:bg-white/90 disabled:opacity-40"
                      style={{
                        cursor:
                          saving || !canRetry ? "not-allowed" : "pointer",
                      }}
                      onClick={() => void retrySend()}
                    >
                      {saving ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        "Try again"
                      )}
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="flex items-center gap-1.5 text-[15px] font-medium tracking-tight text-white/90">
                      <CircleCheck
                        className="size-4 text-emerald-400"
                        strokeWidth={2.25}
                        aria-hidden
                      />
                      Saved
                    </p>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        disabled={!savedOk || generating || saving}
                        className="flex h-10 w-[148px] cursor-pointer items-center justify-center rounded-[12px] bg-white text-[13px] font-bold tracking-tight text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => void onGenerateContent()}
                      >
                        {generating ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          "Generate Content"
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label="Done"
                        className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-[12px] bg-white text-black hover:bg-white/90"
                        onClick={dismissYap}
                      >
                        <Check className="size-4" strokeWidth={2.75} aria-hidden />
                      </button>
                    </div>
                  </>
                )}
                {savedFailed ? (
                  <button
                    type="button"
                    className="text-xs text-white/40 hover:text-white/70"
                    onClick={dismissYap}
                  >
                    Done
                  </button>
                ) : null}
              </div>
            ) : null}

            {yapPhase === "tweet" && tweet ? (
              <div className="flex w-full max-w-[300px] flex-col items-center gap-3">
                <p className="whitespace-pre-wrap text-center text-[13px] leading-snug text-white/85">
                  {tweet}
                </p>
                <button
                  type="button"
                  className="text-xs text-white/40 hover:text-white/70"
                  onClick={dismissYap}
                >
                  Done
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {isAuthExpanded ? (
          <div
            ref={authContentRef}
            className="flex w-full max-w-[280px] flex-col items-center gap-4"
            onMouseEnter={clearLeaveTimer}
          >
            <img
              src={yappyLogo}
              alt="Yappy"
              className="mt-0.5 h-12 w-auto object-contain"
            />
            {configError ? (
              <p className="text-center text-xs text-red-300">{configError}</p>
            ) : null}
            {authError ? (
              <p className="text-center text-xs text-red-300">{authError}</p>
            ) : null}
            {googlePending ? (
              <p className="text-center text-xs text-white/50">
                Finish sign-in in your browser
              </p>
            ) : null}
            <Button
              type="button"
              disabled={googlePending || Boolean(configError)}
              className="h-10 w-full gap-2 bg-white text-black hover:bg-white/90"
              style={{
                cursor: googlePending || configError ? "not-allowed" : "pointer",
              }}
              onClick={() => void submitGoogle()}
            >
              {googlePending ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <img
                  src={googleLogo}
                  alt=""
                  width={16}
                  height={16}
                  className="size-4"
                />
              )}
              {googlePending
                ? "Right, continue in your browser"
                : "Continue with Google"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
