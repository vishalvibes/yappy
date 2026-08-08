import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

/** Chunky 3D dismiss — green twin of YapButton. */
export function OkayButton({
  className,
  onClick,
}: {
  className?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-label="Okay"
      onClick={onClick}
      className={cn(
        "group relative h-[46px] w-[148px] cursor-pointer select-none rounded-[12px]",
        "outline-none focus:outline-none focus-visible:outline-none",
        className,
      )}
    >
      <span
        className="absolute inset-x-0 bottom-0 top-[6px] rounded-[12px] bg-[#15803D]"
        aria-hidden
      />
      <span
        className={cn(
          "absolute inset-x-0 top-0 flex h-10 items-center justify-center gap-1.5 rounded-[12px]",
          "bg-[#22C55E] text-white",
          "group-active:top-[6px]",
        )}
      >
        <Check className="size-4 shrink-0" strokeWidth={2.5} aria-hidden />
        <span className="text-[13px] font-bold tracking-[0.06em]">Okay</span>
      </span>
    </button>
  )
}
