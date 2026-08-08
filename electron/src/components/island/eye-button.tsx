import { Eye } from "lucide-react"

import { cn } from "@/lib/utils"

/** Chunky 3D eye — blue twin of YapButton (same height / shadow construction). */
export function EyeButton({
  className,
  disabled,
  onClick,
}: {
  className?: string
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-label="Capture screen area"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group relative h-[46px] w-[46px] cursor-pointer select-none rounded-[12px]",
        "outline-none focus:outline-none focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      <span
        className="absolute inset-x-0 bottom-0 top-[6px] rounded-[12px] bg-[#1D4ED8]"
        aria-hidden
      />
      <span
        className={cn(
          "absolute inset-x-0 top-0 flex h-10 items-center justify-center rounded-[12px]",
          "bg-[#2563EB] text-white",
          "group-active:top-[6px] group-disabled:group-active:top-0",
        )}
      >
        <Eye className="size-4 shrink-0" strokeWidth={2.5} aria-hidden />
      </span>
    </button>
  )
}
