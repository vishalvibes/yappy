// Minimal fetch wrapper for the FastAPI backend.
// Base URL is configurable via VITE_API_URL (see .env.example).

import axios, { AxiosHeaders } from "axios"

import { getAuthHeaderTokens } from "@/lib/auth-session-cache"

export const API_BASE_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:8000"

export const apiClient = axios.create({ baseURL: API_BASE_URL })

apiClient.interceptors.request.use(async (config) => {
  const { accessToken, refreshToken } = await getAuthHeaderTokens()

  if (accessToken) {
    if (config.headers) {
      config.headers.Authorization = `Bearer ${accessToken}`
      if (refreshToken) {
        config.headers["x-refresh-token"] = refreshToken
      }
    } else {
      const headers = new AxiosHeaders()
      headers.set("Authorization", `Bearer ${accessToken}`)
      if (refreshToken) {
        headers.set("x-refresh-token", refreshToken)
      }
      config.headers = headers
    }
  }

  return config
})

/**
 * JSON API helper — same auth path as `apiClient` (session cache + refresh header).
 * Prefer this for JSON routes; use `apiClient` for multipart / custom timeouts.
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase()
  const headers = new Headers(init?.headers)
  if (!headers.has("Content-Type") && method !== "GET" && method !== "HEAD") {
    headers.set("Content-Type", "application/json")
  }

  const { accessToken, refreshToken } = await getAuthHeaderTokens()
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`)
    if (refreshToken) headers.set("x-refresh-token", refreshToken)
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API ${res.status} ${res.statusText}: ${body}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
