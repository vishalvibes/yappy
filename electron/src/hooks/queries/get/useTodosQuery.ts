import { useQuery } from "@tanstack/react-query"

import { apiFetch } from "@/lib/api"

export type Todo = {
  id: string
  user_id: string
  title: string
  description: string | null
  is_complete: boolean
  created_at: string
  updated_at: string
}

export const todosQueryKey = ["todos"] as const

function fetchTodos() {
  return apiFetch<Todo[]>("/todos")
}

// Only enabled once the user is signed in — /todos 401s without a token.
export function useTodosQuery(enabled: boolean) {
  return useQuery({
    queryKey: todosQueryKey,
    queryFn: fetchTodos,
    enabled,
  })
}
