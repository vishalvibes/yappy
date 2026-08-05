import { useMutation, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "@/lib/api"
import { type Todo, todosQueryKey } from "@/hooks/queries/get/useTodosQuery"

type UpdateTodoInput = {
  id: string
  title?: string
  description?: string
  is_complete?: boolean
}

function updateTodo({ id, ...patch }: UpdateTodoInput) {
  return apiFetch<Todo>(`/todos/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

export function useUpdateTodoMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateTodo,
    onSuccess: () => qc.invalidateQueries({ queryKey: todosQueryKey }),
  })
}
