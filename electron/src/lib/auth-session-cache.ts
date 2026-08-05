// Cached Supabase session for HTTP auth headers. Ported from harmony-desktop's
// auth-session-cache: a module-singleton session cache with in-flight dedupe,
// proactive refresh shortly before expiry, and an onAuthStateChange listener to
// keep the cache warm. Avoids hitting supabase.auth.getSession() on every
// request. See src/lib/api.ts (apiClient request interceptor) for the consumer.

import type { Session } from "@supabase/supabase-js"

import { supabase, supabaseConfigured } from "@/lib/supabase"

type SessionCacheState = {
  session: Session | null
  initialized: boolean
}

type SessionFetchResult = {
  session: Session | null
  error: Error | null
}

const sessionCache: SessionCacheState = {
  session: null,
  initialized: false,
}

let inFlightSessionPromise: Promise<SessionFetchResult> | null = null
let isListenerAttached = false
const SESSION_EXPIRY_MARGIN_MS = 60 * 1000

const setCachedSession = (session: Session | null) => {
  sessionCache.session = session
  sessionCache.initialized = true
}

const toError = (error: unknown, fallbackMessage: string): Error => {
  if (error instanceof Error) return error
  if (typeof error === "string" && error.trim()) return new Error(error)
  return new Error(fallbackMessage)
}

const fetchSessionFromSupabase = async (): Promise<SessionFetchResult> => {
  if (!supabaseConfigured) {
    setCachedSession(null)
    return { session: null, error: null }
  }

  try {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession()

    if (error && !session) {
      if (!sessionCache.initialized) {
        setCachedSession(null)
      }
      return {
        session: null,
        error: toError(error, "Failed to fetch auth session"),
      }
    }

    const normalizedSession = session ?? null
    setCachedSession(normalizedSession)
    return {
      session: normalizedSession,
      error: error ? toError(error, "Failed to fetch auth session") : null,
    }
  } catch (error) {
    if (!sessionCache.initialized) {
      setCachedSession(null)
    }
    return {
      session: null,
      error: toError(error, "Failed to fetch auth session"),
    }
  }
}

export const getCachedSession = () => sessionCache.session

export const hasCachedSession = () => Boolean(sessionCache.session?.access_token)

const isSessionExpiringSoon = (session: Session | null) => {
  const expiresAt = session?.expires_at
  if (!expiresAt) return false
  return expiresAt * 1000 - Date.now() < SESSION_EXPIRY_MARGIN_MS
}

export const getSessionWithCacheResult = async ({
  forceRefresh = false,
}: {
  forceRefresh?: boolean
} = {}): Promise<SessionFetchResult> => {
  if (!forceRefresh && sessionCache.initialized) {
    return {
      session: sessionCache.session,
      error: null,
    }
  }

  if (inFlightSessionPromise) {
    return inFlightSessionPromise
  }

  inFlightSessionPromise = fetchSessionFromSupabase().finally(() => {
    inFlightSessionPromise = null
  })

  return inFlightSessionPromise
}

export const getSessionWithCache = async (options?: {
  forceRefresh?: boolean
}) => {
  const { session } = await getSessionWithCacheResult(options)
  return session
}

export const getAuthHeaderTokens = async () => {
  ensureAuthSessionCache()

  let { session } = await getSessionWithCacheResult()

  if (isSessionExpiringSoon(session)) {
    const refreshed = await getSessionWithCacheResult({ forceRefresh: true })
    session = refreshed.session
  }

  return {
    accessToken: session?.access_token ?? null,
    refreshToken: session?.refresh_token ?? null,
  }
}

export const ensureAuthSessionCache = () => {
  if (isListenerAttached) return
  if (!supabaseConfigured) {
    setCachedSession(null)
    return
  }

  isListenerAttached = true

  void getSessionWithCacheResult()

  // Attached once for the app's lifetime (module singleton). No unsubscribe
  // path — unlike harmony-desktop we have no Vite HMR dispose hook to clean up.
  supabase.auth.onAuthStateChange((_event, session) => {
    setCachedSession(session ?? null)
  })
}
