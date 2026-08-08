import { Mic } from "lucide-react"

import { cn } from "@/lib/utils"

/** Chunky 3D Yap — dark purple, same construction as the TAP TO SPEAK example. */
export function YapButton({
  className,
  onClick,
}: {
  className?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-label="Yap"
      onClick={onClick}
      className={cn(
        "group relative h-[46px] w-[148px] cursor-pointer select-none rounded-[12px]",
        "outline-none focus:outline-none focus-visible:outline-none",
        className,
      )}
    >
      {/* Bottom lip / depth — stays put; face slides over it on press */}
      <span
        className="absolute inset-x-0 bottom-0 top-[6px] rounded-[12px] bg-[#5B21B6]"
        aria-hidden
      />
      {/* Face: same height always; press = move down so lip shrinks */}
      <span
        className={cn(
          "absolute inset-x-0 top-0 flex h-10 items-center justify-center gap-1.5 rounded-[12px]",
          "bg-[#7C3AED] text-white",
          "group-active:top-[6px]",
        )}
      >
        <Mic className="size-4 shrink-0" strokeWidth={2.5} aria-hidden />
        <span className="text-[13px] font-bold tracking-[0.06em]">YAP</span>
      </span>
    </button>
  )
}
