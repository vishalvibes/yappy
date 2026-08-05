import { useState } from "react"
import { Check, Loader2, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useTodosQuery } from "@/hooks/queries/get/useTodosQuery"
import { useAddTodoMutation } from "@/hooks/mutations/post/useAddTodoMutation"
import { useUpdateTodoMutation } from "@/hooks/mutations/patch/useUpdateTodoMutation"
import { useDeleteTodoMutation } from "@/hooks/mutations/delete/useDeleteTodoMutation"
import { cn } from "@/lib/utils"

// Reference CRUD surface: React Query hooks over the auth-gated /todos routes,
// backed by the `todos` table. The shell already handles auth + sign-out.
export function TodosApp() {
  const { data: todos, isLoading } = useTodosQuery(true)
  const add = useAddTodoMutation()
  const update = useUpdateTodoMutation()
  const remove = useDeleteTodoMutation()
  const [title, setTitle] = useState("")

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const t = title.trim()
    if (!t) return
    add.mutate({ title: t })
    setTitle("")
  }

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Todos</h1>
        <p className="text-sm text-muted-foreground">
          CRUD against <code>/todos</code>, scoped to the signed-in user.
        </p>
      </header>

      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a todo…"
        />
        <Button type="submit" disabled={add.isPending || !title.trim()}>
          {add.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          Add
        </Button>
      </form>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : !todos?.length ? (
        <p className="text-sm text-muted-foreground">
          No todos yet. Add your first one above.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {todos.map((todo) => (
            <li
              key={todo.id}
              className="flex items-center gap-3 rounded-lg border p-3"
            >
              <button
                type="button"
                aria-label={
                  todo.is_complete ? "Mark incomplete" : "Mark complete"
                }
                onClick={() =>
                  update.mutate({ id: todo.id, is_complete: !todo.is_complete })
                }
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors",
                  todo.is_complete && "bg-primary text-primary-foreground",
                )}
              >
                {todo.is_complete ? <Check className="size-4" /> : null}
              </button>

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-sm font-medium",
                    todo.is_complete && "text-muted-foreground line-through",
                  )}
                >
                  {todo.title}
                </p>
                {todo.description ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {todo.description}
                  </p>
                ) : null}
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Delete"
                onClick={() => remove.mutate(todo.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
