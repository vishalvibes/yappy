import { Feather } from "lucide-react"

import { cn } from "@/lib/utils"

/** Chunky 3D create twin of EyeButton — opens content generation. */
export function CreateButton({
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
      aria-label="Generate post"
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
        className="absolute inset-x-0 bottom-0 top-[6px] rounded-[12px] bg-[#334155]"
        aria-hidden
      />
      <span
        className={cn(
          "absolute inset-x-0 top-0 flex h-10 items-center justify-center rounded-[12px]",
          "bg-[#475569] text-white",
          "group-active:top-[6px] group-disabled:group-active:top-0",
        )}
      >
        <Feather className="size-4 shrink-0" strokeWidth={2.5} aria-hidden />
      </span>
    </button>
  )
}
