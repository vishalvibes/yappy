import { useMutation, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "@/lib/api"
import { type Todo, todosQueryKey } from "@/hooks/queries/get/useTodosQuery"

type AddTodoInput = { title: string; description?: string }

function addTodo(input: AddTodoInput) {
  return apiFetch<Todo>("/todos", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function useAddTodoMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: addTodo,
    onSuccess: () => qc.invalidateQueries({ queryKey: todosQueryKey }),
  })
}
