import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"

import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import googleLogo from "@/assets/icons/svg/google.svg"
import yappyLogo from "@/assets/yappy-logo.png"

type IslandMode = "collapsed" | "pill" | "expanded"
type PillKind = "prompt" | "record" | "idea" | "auth"

const AUTH_WIDTH = 340
const AUTH_BOTTOM_PAD = 16
const AUTH_GAP_BELOW_NOTCH = 12

function Waveform({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex h-3 items-end justify-center gap-0.5", className)}
      aria-hidden
    >
      {[3, 6, 4, 8, 5, 7, 3].map((h, i) => (
        <span
          key={i}
          className="w-0.5 rounded-full bg-white/90"
          style={{ height: h }}
        />
      ))}
    </div>
  )
}

export function DynamicIsland() {
  const {
    user,
    loading,
    signInWithGoogle,
    signOut,
    configError,
    googlePending,
  } = useAuth()
  const [mode, setMode] = useState<IslandMode>("collapsed")
  const [pillKind, setPillKind] = useState<PillKind>("prompt")
  const [authError, setAuthError] = useState<string | null>(null)
  const [notchPad, setNotchPad] = useState(32)
  const [googleSecondsLeft, setGoogleSecondsLeft] = useState(30)
  const leaveTimer = useRef<number | null>(null)
  const wasGooglePending = useRef(false)
  const authContentRef = useRef<HTMLDivElement>(null)

  const isAuthExpanded = mode === "expanded" && !user

  const resize = useCallback(
    async (next: IslandMode) => {
      setMode(next)
      // Auth panel: start compact; ResizeObserver fits to content (CSS h-fit can't shrink BrowserWindow).
      if (next === "expanded" && !user) {
        await window.ipcRenderer.resizeIslandTo({
          width: AUTH_WIDTH,
          height: notchPad + 130,
        })
        return
      }
      await window.ipcRenderer.resizeIsland(next)
    },
    [user, notchPad],
  )

  /** Electron window can't use CSS h-fit — measure content and resize native bounds. */
  const fitAuthHeight = useCallback(() => {
    const el = authContentRef.current
    if (!el) return
    const contentH = Math.ceil(el.getBoundingClientRect().height)
    const height = notchPad + AUTH_GAP_BELOW_NOTCH + contentH + AUTH_BOTTOM_PAD
    void window.ipcRenderer.resizeIslandTo({ width: AUTH_WIDTH, height })
  }, [notchPad])

  useEffect(() => {
    void window.ipcRenderer.getMenuBarHeight().then(setNotchPad)
    void resize("collapsed")
    return () => {
      if (leaveTimer.current) window.clearTimeout(leaveTimer.current)
    }
  }, [resize])

  // Pick a rotating pill copy when hovering (demo states from the mock).
  useEffect(() => {
    if (loading) return
    if (!user) {
      setPillKind("auth")
      return
    }
    const kinds: PillKind[] = ["prompt", "record", "idea"]
    setPillKind(kinds[Math.floor(Date.now() / 10_000) % kinds.length]!)
  }, [user, loading, mode])

  useLayoutEffect(() => {
    if (!isAuthExpanded) return
    const el = authContentRef.current
    if (!el) return
    fitAuthHeight()
    const ro = new ResizeObserver(() => fitAuthHeight())
    ro.observe(el)
    return () => ro.disconnect()
  }, [isAuthExpanded, fitAuthHeight, googlePending, authError, configError])

  // Countdown while Google OAuth is pending; button re-enables at 0 (auth-provider timeout).
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
    clearLeaveTimer()
    if (mode === "collapsed") {
      void resize(user ? "pill" : "expanded")
    }
  }

  function onLeave() {
    // Stay expanded while the system browser finishes Google OAuth.
    if (googlePending) return
    clearLeaveTimer()
    leaveTimer.current = window.setTimeout(() => {
      void resize("collapsed")
    }, 280)
  }

  // After Google OAuth completes, tuck to pill.
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
          // Collapsed: transparent shell — only the grey handle shows.
          mode === "collapsed" && "justify-start bg-transparent pt-3.5",
          mode === "pill" &&
            "justify-end rounded-t-none rounded-b-[28px] bg-black px-5 pb-4",
          // Auth: hug content under notch (window height fitted via ResizeObserver).
          isAuthExpanded &&
            "justify-start rounded-t-none rounded-b-[28px] bg-black px-5",
          mode === "expanded" &&
            user &&
            "justify-end rounded-t-none rounded-b-[36px] bg-black px-6 pb-5",
        )}
        style={
          mode === "pill" || mode === "expanded"
            ? {
                paddingTop: notchPad + (isAuthExpanded ? AUTH_GAP_BELOW_NOTCH : 8),
                ...(isAuthExpanded ? { paddingBottom: AUTH_BOTTOM_PAD } : null),
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

        {mode === "pill" && pillKind === "prompt" ? (
          <div className="flex flex-col items-center gap-1.5 text-center">
            <p className="text-[15px] font-medium tracking-tight">
              How&apos;s your day going?
            </p>
            <Waveform />
          </div>
        ) : null}

        {mode === "pill" && pillKind === "record" ? (
          <div className="flex flex-col items-center gap-1.5 text-center">
            <p className="text-[15px] font-medium tracking-tight">
              Tap to record an event or insight
            </p>
            <Waveform />
          </div>
        ) : null}

        {mode === "pill" && pillKind === "idea" ? (
          <div className="flex w-full items-center justify-between gap-3 px-1">
            <p className="text-left text-[14px] font-medium leading-snug tracking-tight">
              I&apos;ve come up with some cool LinkedIn post ideas
            </p>
            <button
              type="button"
              className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-black"
              onClick={() => void resize("expanded")}
            >
              show
            </button>
          </div>
        ) : null}

        {mode === "pill" && pillKind === "auth" ? (
          <button
            type="button"
            className="text-[15px] font-medium tracking-tight"
            onClick={() => void resize("expanded")}
          >
            Sign in to Yappy
          </button>
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
              style={{ cursor: googlePending || configError ? "not-allowed" : "pointer" }}
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
                <img src={googleLogo} alt="" width={16} height={16} className="size-4" />
              )}
              {googlePending
                ? `Waiting for Google… ${googleSecondsLeft}s`
                : "Continue with Google"}
            </Button>
          </div>
        ) : null}

        {mode === "expanded" && user ? (
          <div
            className="flex h-full w-full flex-col items-center justify-center gap-4"
            onMouseEnter={clearLeaveTimer}
          >
            <p className="text-lg font-medium tracking-tight text-white/90">
              Drop it here.
            </p>
            <p className="max-w-[240px] text-center text-xs text-white/45">
              Signed in as {user.email}. Hover away to tuck under the notch.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-white/20 bg-transparent text-white hover:bg-white/10"
                onClick={() => void resize("pill")}
              >
                Collapse
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-white/20 bg-transparent text-white hover:bg-white/10"
                onClick={() => void signOut()}
              >
                Sign out
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
