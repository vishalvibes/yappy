import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"

import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type IslandMode = "collapsed" | "pill" | "expanded"
type PillKind = "prompt" | "record" | "idea" | "auth"

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
  const { user, loading, signIn, signOut, configError } = useAuth()
  const [mode, setMode] = useState<IslandMode>("collapsed")
  const [pillKind, setPillKind] = useState<PillKind>("prompt")
  const [email, setEmail] = useState("e2e-test@example.com")
  const [password, setPassword] = useState("testpass123")
  const [authError, setAuthError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [notchPad, setNotchPad] = useState(32)
  const leaveTimer = useRef<number | null>(null)

  const resize = useCallback(async (next: IslandMode) => {
    setMode(next)
    await window.ipcRenderer.resizeIsland(next)
  }, [])

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
    clearLeaveTimer()
    leaveTimer.current = window.setTimeout(() => {
      void resize("collapsed")
    }, 280)
  }

  async function submitAuth(e: React.FormEvent) {
    e.preventDefault()
    setAuthError(null)
    setPending(true)
    try {
      await signIn(email, password)
      await resize("pill")
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Sign in failed")
    } finally {
      setPending(false)
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
          "flex h-full w-full flex-col items-center overflow-hidden text-white transition-all duration-300 ease-out",
          // Collapsed: transparent shell — only the grey handle shows.
          mode === "collapsed" && "justify-start bg-transparent pt-3.5",
          mode === "pill" &&
            "justify-end rounded-t-none rounded-b-[28px] bg-black px-5 pb-4",
          mode === "expanded" &&
            "justify-end rounded-t-none rounded-b-[36px] bg-black px-6 pb-5",
        )}
        style={
          mode === "pill" || mode === "expanded"
            ? { paddingTop: notchPad + 8 }
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

        {mode === "expanded" && !user ? (
          <form
            onSubmit={submitAuth}
            className="flex w-full max-w-[300px] flex-col gap-3"
            onMouseEnter={clearLeaveTimer}
          >
            <p className="text-center text-sm font-medium text-white/90">
              Yappy
            </p>
            {configError ? (
              <p className="text-center text-xs text-red-300">{configError}</p>
            ) : null}
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="h-9 border-white/15 bg-white/10 text-white placeholder:text-white/40"
            />
            <Input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="h-9 border-white/15 bg-white/10 text-white placeholder:text-white/40"
            />
            {authError ? (
              <p className="text-xs text-red-300">{authError}</p>
            ) : null}
            <Button
              type="submit"
              disabled={pending || Boolean(configError)}
              className="h-9 bg-white text-black hover:bg-white/90"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Sign in
            </Button>
          </form>
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
