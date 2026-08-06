import { supabase, supabaseConfigured } from "@/lib/supabase"

type AuthCallbackParams = {
  code: string | null
  accessToken: string | null
  refreshToken: string | null
  error: string | null
  errorDescription: string | null
}

type CompleteAuthResult = { ok: true } | { ok: false; message: string }

function getHashParams(url: URL) {
  const rawHash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash
  return new URLSearchParams(rawHash)
}

function readAuthCallbackParams(callbackUrl: string): AuthCallbackParams {
  const parsedUrl = new URL(callbackUrl)
  const hashParams = getHashParams(parsedUrl)
  const getParam = (key: string) =>
    parsedUrl.searchParams.get(key) ?? hashParams.get(key)

  return {
    code: getParam("code"),
    accessToken: getParam("access_token"),
    refreshToken: getParam("refresh_token"),
    error: getParam("error"),
    errorDescription: getParam("error_description"),
  }
}

/** Finish PKCE / token OAuth after the OS opens yappy://auth/callback?... */
export async function completeOAuthCallback(
  callbackUrl: string,
): Promise<CompleteAuthResult> {
  if (!supabaseConfigured) {
    return { ok: false, message: "Auth not configured" }
  }

  const params = readAuthCallbackParams(callbackUrl)
  const errorMessage = params.errorDescription ?? params.error
  if (errorMessage) {
    return { ok: false, message: errorMessage }
  }

  const hasCode = Boolean(params.code)
  const hasTokens = Boolean(params.accessToken && params.refreshToken)
  if (!hasCode && !hasTokens) {
    return {
      ok: false,
      message:
        "No code or session tokens returned. Ensure callback includes ?code=... or access/refresh tokens.",
    }
  }

  if (hasCode) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.code!)
    if (error) return { ok: false, message: error.message }
  } else {
    const { error } = await supabase.auth.setSession({
      access_token: params.accessToken!,
      refresh_token: params.refreshToken!,
    })
    if (error) return { ok: false, message: error.message }
  }

  return { ok: true }
}
