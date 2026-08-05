import { useEffect } from "react"
import {
  HashRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useSearchParams,
} from "react-router"

import { AppShell } from "@/components/app-shell"
import { useAuth } from "@/components/auth-provider"
import { LoginForm } from "@/components/auth/login-form"
import { ChatPanel } from "@/components/chat/chat-panel"
import { HealthPanel } from "@/components/health/health-panel"
import { InferencePanel } from "@/components/inference/inference-panel"
import { TodosApp } from "@/components/todos/todos-app"
import { Skeleton } from "@/components/ui/skeleton"

function HomeGate() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && user) navigate("/chat", { replace: true })
  }, [loading, user, navigate])

  if (loading || user) {
    return (
      <main className="flex min-h-full flex-1 items-center justify-center p-6">
        <Skeleton className="h-64 w-full max-w-sm" />
      </main>
    )
  }

  return <LoginForm />
}

function AuthCallbackPage() {
  const navigate = useNavigate()
  const { loading, session } = useAuth()
  const [params] = useSearchParams()

  useEffect(() => {
    if (!loading) {
      navigate(session ? "/chat" : `/?auth_error=${params.get("error") ?? "1"}`, {
        replace: true,
      })
    }
  }, [loading, session, navigate, params])

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <p className="text-sm text-muted-foreground">Signing you in…</p>
    </main>
  )
}

function RequireAuth() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && !user) navigate("/", { replace: true })
  }, [loading, user, navigate])

  if (loading || !user) {
    return (
      <main className="flex min-h-full flex-1 items-center justify-center p-6">
        <Skeleton className="h-64 w-full max-w-2xl" />
      </main>
    )
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomeGate />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/chat" element={<ChatPanel />} />
          <Route path="/inference" element={<InferencePanel />} />
          <Route path="/todos" element={<TodosApp />} />
          <Route path="/health" element={<HealthPanel />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
