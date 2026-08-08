import axios from "axios"

/** Prefer FastAPI `detail` (string or validation list) over Axios status text. */
export function getApiErrorMessage(
  error: unknown,
  fallback = "Hey, oops — some issue occurred. Try again?",
): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === "string" && detail.trim()) return detail.trim()
    if (Array.isArray(detail)) {
      const parts = detail
        .map((item) => {
          if (typeof item === "string") return item
          if (item && typeof item === "object" && "msg" in item) {
            return String((item as { msg: unknown }).msg)
          }
          return null
        })
        .filter(Boolean)
      if (parts.length) return parts.join("; ")
    }
    if (error.message) return error.message
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}
