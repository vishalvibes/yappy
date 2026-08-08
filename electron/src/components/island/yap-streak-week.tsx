import { Check } from "lucide-react"

import type { YapStats } from "@/lib/yaps"
import { cn } from "@/lib/utils"

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const

/** Duolingo-style Mon–Sun binary check circles. */
export function YapStreakWeek({ stats }: { stats: YapStats }) {
  const today = localDateKey()
  const label =
    stats.streak === 1 ? "1 day streak" : `${stats.streak} day streak`

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <p className="text-center text-[15px] font-medium tracking-tight text-white/90">
        {label}
      </p>
      <div className="flex items-start justify-center gap-2.5">
        {stats.week.map((day, i) => {
          const isToday = day.date === today
          return (
            <div
              key={day.date}
              className="flex flex-col items-center gap-1.5"
            >
              <span
                className={cn(
                  "text-[11px] font-medium",
                  day.posted || isToday ? "text-[#22C55E]" : "text-white/35",
                )}
              >
                {DAY_LETTERS[i]}
              </span>
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full",
                  day.posted
                    ? "bg-[#22C55E] text-white"
                    : "border border-white/20 bg-transparent",
                )}
                aria-label={
                  day.posted
                    ? `${DAY_LETTERS[i]} posted`
                    : `${DAY_LETTERS[i]} empty`
                }
              >
                {day.posted ? (
                  <Check className="size-3" strokeWidth={3} aria-hidden />
                ) : null}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function localDateKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}
