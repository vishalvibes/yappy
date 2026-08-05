import { Loader2, RefreshCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useHealthMatrixQuery,
  type ComponentHealth,
} from "@/hooks/queries/get/useHealthMatrixQuery"
import { API_BASE_URL } from "@/lib/api"

// Frontend half of the health matrix: renders one row per backend dependency
// from GET /health/matrix, plus a browser-side row for this app itself.
export function HealthPanel() {
  const { data, isLoading, isError, error, isFetching, refetch } =
    useHealthMatrixQuery()

  const appRow: ComponentHealth = {
    name: "electron",
    status: "up",
    detail: `Yappy desktop talking to ${API_BASE_URL}`,
    latency_ms: null,
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Health</h1>
          <p className="text-sm text-muted-foreground">
            Desktop app and backend dependencies from{" "}
            <code>GET /health/matrix</code>, refreshed every 15s.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Refresh
        </Button>
      </header>

      {data ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <StatusBadge status={data.status === "healthy" ? "up" : "down"}>
            {data.status}
          </StatusBadge>
          <span className="text-muted-foreground">
            {data.service} · {data.environment}
          </span>
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-destructive/40 p-4">
          <StatusBadge status="down">backend unreachable</StatusBadge>
          <p className="mt-2 text-sm text-destructive">
            {error instanceof Error ? error.message : "Request failed"}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {[appRow, ...(data?.components ?? [])].map((c) => (
            <li
              key={c.name}
              className="flex items-center gap-4 rounded-lg border p-4"
            >
              <StatusBadge status={c.status}>{c.status}</StatusBadge>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{c.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {c.detail}
                </p>
              </div>
              {c.latency_ms !== null ? (
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {c.latency_ms} ms
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function StatusBadge({
  status,
  children,
}: {
  status: ComponentHealth["status"]
  children: React.ReactNode
}) {
  return (
    <Badge
      variant={
        status === "up"
          ? "default"
          : status === "down"
            ? "destructive"
            : "secondary"
      }
      className="shrink-0"
    >
      {children}
    </Badge>
  )
}
