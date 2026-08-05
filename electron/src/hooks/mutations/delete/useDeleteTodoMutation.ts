import { useMutation, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "@/lib/api"
import { todosQueryKey } from "@/hooks/queries/get/useTodosQuery"

function deleteTodo(id: string) {
  return apiFetch<void>(`/todos/${id}`, { method: "DELETE" })
}

export function useDeleteTodoMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteTodo,
    onSuccess: () => qc.invalidateQueries({ queryKey: todosQueryKey }),
  })
}
