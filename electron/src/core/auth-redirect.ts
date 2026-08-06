/** Desktop Google OAuth redirect (harmony bridge pattern).
 *
 * Supabase falls back to site_url for custom schemes, so we redirect to an
 * HTTP bridge on the API that then opens yappy-dev:// / yappy://.
 */

export const GOOGLE_OAUTH_APP_PROTOCOL = import.meta.env.DEV
  ? "yappy-dev"
  : "yappy"

const apiBase =
  import.meta.env.VITE_API_URL?.trim() || "http://127.0.0.1:8000"

function buildBridgeRedirectUrl(fragmentBaseUrl: string, appProtocol: string) {
  try {
    const url = new URL("/oauth/google/desktop/callback", fragmentBaseUrl)
    url.searchParams.set("app_protocol", appProtocol)
    return url.toString()
  } catch {
    return `${appProtocol}://auth/callback`
  }
}

export const GOOGLE_OAUTH_REDIRECT_TO = buildBridgeRedirectUrl(
  apiBase,
  GOOGLE_OAUTH_APP_PROTOCOL,
)
