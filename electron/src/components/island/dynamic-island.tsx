import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowUp, Loader2 } from "lucide-react"

import { useAuth } from "@/components/auth-provider"
import { Waveform } from "@/components/island/waveform"
import { YapButton } from "@/components/island/yap-button"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import googleLogo from "@/assets/icons/svg/google.svg"
import yappyLogo from "@/assets/yappy-logo.png"

type IslandMode = "collapsed" | "pill" | "expanded"

const AUTH_WIDTH = 340
const AUTH_BOTTOM_PAD = 16
const AUTH_GAP_BELOW_NOTCH = 12

const YAP_WIDTH = 360
const YAP_BOTTOM_PAD = 24
const YAP_GAP_BELOW_NOTCH = 10

export function DynamicIsland() {
  const {
    user,
    signInWithGoogle,
    configError,
    googlePending,
  } = useAuth()
  const [mode, setMode] = useState<IslandMode>("collapsed")
  /** Pinned open while mic UI is up — mouse leave must not collapse. */
  const [listening, setListening] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [notchPad, setNotchPad] = useState(32)
  const [googleSecondsLeft, setGoogleSecondsLeft] = useState(30)
  const leaveTimer = useRef<number | null>(null)
  const pointerInside = useRef(false)
  const wasGooglePending = useRef(false)
  const authContentRef = useRef<HTMLDivElement>(null)
  const yapContentRef = useRef<HTMLDivElement>(null)

  const isAuthExpanded = mode === "expanded" && !user
  const isYapSurface = Boolean(user) && mode === "pill"
  const isYapListening = isYapSurface && listening

  const resize = useCallback(
    async (next: IslandMode) => {
      setMode(next)
      // Auth panel: start compact; ResizeObserver fits to content.
      if (next === "expanded" && !user) {
        await window.ipcRenderer.resizeIslandTo({
          width: AUTH_WIDTH,
          height: notchPad + 130,
        })
        return
      }
      // Signed-in Yap idle: content-fitted (pill presets are too short for the chunky button).
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

  useEffect(() => {
    void window.ipcRenderer.getMenuBarHeight().then(setNotchPad)
    void resize("collapsed")
    return () => {
      if (leaveTimer.current) window.clearTimeout(leaveTimer.current)
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
  }, [isYapSurface, isYapListening, fitYapHeight])

  useEffect(() => {
    if (!googlePending) {
      setGoogleSecondsLeft(30)
      return
    }
    setGoogleSecondsLeft(30)
    const id = window.setInterval(() => {
      setGoogleSecondsLeft((s) => Math.max(0, s - 1))
    }, 1000)
    return () => window.clearInterval(id)
  }, [googlePending])

  function clearLeaveTimer() {
    if (leaveTimer.current) {
      window.clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
  }

  function onEnter() {
    pointerInside.current = true
    clearLeaveTimer()
    if (mode === "collapsed") {
      void resize(user ? "pill" : "expanded")
    }
  }

  /**
   * Two open modes:
   * - Hover-open: collapses shortly after leave (idle Yap / auth).
   * - Pinned-open: listening (or Google pending) — stay expanded until stop/done.
   */
  function onLeave() {
    pointerInside.current = false
    if (googlePending || listening) return
    clearLeaveTimer()
    leaveTimer.current = window.setTimeout(() => {
      void resize("collapsed")
    }, 280)
  }

  function startListening() {
    clearLeaveTimer()
    setListening(true)
    if (mode === "collapsed") void resize("pill")
  }

  function stopListening() {
    setListening(false)
    // If the cursor already left while pinned, collapse now.
    if (!pointerInside.current) {
      clearLeaveTimer()
      leaveTimer.current = window.setTimeout(() => {
        void resize("collapsed")
      }, 180)
    }
  }

  useEffect(() => {
    if (googlePending) wasGooglePending.current = true
    if (wasGooglePending.current && user && !googlePending) {
      wasGooglePending.current = false
      void resize("pill")
    }
  }, [user, googlePending, resize])

  async function submitGoogle() {
    setAuthError(null)
    try {
      await signInWithGoogle()
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Google sign-in failed")
    }
  }

  return (
    <div
      className="flex h-screen w-screen items-stretch justify-center bg-transparent"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div
        className={cn(
          "flex h-full w-full flex-col items-center overflow-hidden text-white",
          mode === "collapsed" && "justify-start bg-transparent pt-3.5",
          isYapSurface &&
            "justify-start rounded-t-none rounded-b-[28px] bg-black px-5",
          isAuthExpanded &&
            "justify-start rounded-t-none rounded-b-[28px] bg-black px-5",
          // Unauthenticated pill: compact “Sign in” affordance
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
              isYapListening ? "gap-1.5" : "gap-3",
            )}
            onMouseEnter={clearLeaveTimer}
          >
            <p className="text-center text-[15px] font-medium tracking-tight text-white/90">
              {isYapListening
                ? "I am listening"
                : "Yap or drop something interesting"}
            </p>
            {isYapListening ? (
              <div className="relative flex h-[52px] w-full items-center justify-center">
                <Waveform active={isYapListening} />
                <button
                  type="button"
                  aria-label="Stop listening"
                  onClick={stopListening}
                  className="absolute right-3 flex size-7 cursor-pointer items-center justify-center rounded-full bg-white/15 text-neutral-400 hover:bg-white/25 hover:text-white"
                >
                  <ArrowUp className="size-4" strokeWidth={2.75} aria-hidden />
                </button>
              </div>
            ) : (
              <YapButton onClick={startListening} />
            )}
          </div>
        ) : null}

        {isAuthExpanded ? (
          <div
            ref={authContentRef}
            className="flex w-full max-w-[280px] flex-col items-center gap-3"
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
                Finish sign-in in your browser…
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
                <span className="relative inline-flex size-4 items-center justify-center">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="absolute text-[8px] font-semibold leading-none tabular-nums">
                    {googleSecondsLeft}
                  </span>
                </span>
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
                ? `Waiting for Google… ${googleSecondsLeft}s`
                : "Continue with Google"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
