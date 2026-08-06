import { QueryClientProvider } from "@tanstack/react-query"

import { AuthProvider } from "@/components/auth-provider"
import { queryClient } from "@/core/query-client"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  )
}
