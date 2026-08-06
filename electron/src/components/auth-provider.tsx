import type { Session, User } from "@supabase/supabase-js"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

import { completeOAuthCallback } from "@/core/auth-callback"
import { GOOGLE_OAUTH_REDIRECT_TO } from "@/core/auth-redirect"
import { supabase, supabaseConfigured, supabaseConfigError } from "@/lib/supabase"

const GOOGLE_LOADING_TIMEOUT_MS = 30_000

type AuthContextValue = {
  session: Session | null
  user: User | null
  loading: boolean
  googlePending: boolean
  configError: string | null
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [googlePending, setGooglePending] = useState(false)
  const googleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearGoogleTimeout = useCallback(() => {
    if (googleTimeoutRef.current) {
      clearTimeout(googleTimeoutRef.current)
      googleTimeoutRef.current = null
    }
  }, [])

  const handleAuthCallback = useCallback(
    async (url: string) => {
      clearGoogleTimeout()
      const result = await completeOAuthCallback(url)
      window.ipcRenderer?.consumeDeepLink?.(url)
      setGooglePending(false)
      if (!result.ok) {
        throw new Error(result.message)
      }
    },
    [clearGoogleTimeout],
  )

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoading(false)
      if (next) {
        clearGoogleTimeout()
        setGooglePending(false)
      }
    })

    return () => {
      sub.subscription.unsubscribe()
      clearGoogleTimeout()
    }
  }, [clearGoogleTimeout])

  // Deep link from main (yappy:// / yappy-dev://auth/callback?code=...)
  useEffect(() => {
    if (!supabaseConfigured || !window.ipcRenderer?.on) return

    const unsub = window.ipcRenderer.on(
      "auth:deep-link",
      (_event: unknown, url: unknown) => {
        if (typeof url !== "string") return
        void handleAuthCallback(url).catch((err) => {
          console.error("OAuth callback failed:", err)
          setGooglePending(false)
        })
      },
    )

    void window.ipcRenderer
      .getPendingDeepLink()
      .then((pendingUrl) => {
        if (pendingUrl) {
          return handleAuthCallback(pendingUrl)
        }
      })
      .catch((err) => {
        console.error("Pending OAuth callback failed:", err)
        setGooglePending(false)
      })

    return () => {
      unsub()
    }
  }, [handleAuthCallback])

  async function signInWithGoogle() {
    if (!supabaseConfigured) throw new Error(supabaseConfigError ?? "Auth not configured")
    clearGoogleTimeout()
    setGooglePending(true)

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: GOOGLE_OAUTH_REDIRECT_TO,
        skipBrowserRedirect: true,
      },
    })

    if (error || !data.url) {
      setGooglePending(false)
      throw error ?? new Error("Failed to start Google sign-in")
    }

    try {
      await window.ipcRenderer.openExternal(data.url)
      googleTimeoutRef.current = setTimeout(() => {
        setGooglePending(false)
      }, GOOGLE_LOADING_TIMEOUT_MS)
    } catch {
      setGooglePending(false)
      throw new Error("Failed to open Google sign-in in browser")
    }
  }

  async function signOut() {
    if (!supabaseConfigured) return
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        googlePending,
        configError: supabaseConfigError,
        signInWithGoogle,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>")
  return ctx
}
