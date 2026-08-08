/** X-style action glyphs — shared 24×24 viewBox, ~3px inset so heights match. */

type IconProps = {
  className?: string
}

const svgProps = {
  viewBox: "0 0 24 24",
  width: 18.75,
  height: 18.75,
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
}

export function ReplyIcon({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M3.5 11.5c0 3.7 3.4 6.7 7.6 6.7h.4l3.2 2.3v-2.6c2.9-.4 5.3-2.8 5.3-5.7 0-3.5-3.4-6.3-7.6-6.3S3.5 8 3.5 11.5Z" />
    </svg>
  )
}

export function RepostIcon({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M16.5 4.5 19.5 7.5 16.5 10.5" />
      <path d="M5.5 13.5V11.5A4 4 0 0 1 9.5 7.5h10" />
      <path d="M7.5 19.5 4.5 16.5 7.5 13.5" />
      <path d="M18.5 10.5V12.5A4 4 0 0 1 14.5 16.5h-10" />
    </svg>
  )
}

export function LikeIcon({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M12 19.2 5.7 13.4A4.1 4.1 0 0 1 12 7.2a4.1 4.1 0 0 1 6.3 6.2L12 19.2Z" />
    </svg>
  )
}

export function ViewsIcon({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M6.5 16.5V11.5" />
      <path d="M12 16.5V7.5" />
      <path d="M17.5 16.5V13" />
    </svg>
  )
}

export function BookmarkIcon({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M7 5.5h10a1 1 0 0 1 1 1v12.2l-6-3.5-6 3.5V6.5a1 1 0 0 1 1-1Z" />
    </svg>
  )
}

export function CopyIcon({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <rect x="8.5" y="8.5" width="10" height="10" rx="1.5" />
      <path d="M15.5 8.5V6.5A1.5 1.5 0 0 0 14 5H6.5A1.5 1.5 0 0 0 5 6.5V14a1.5 1.5 0 0 0 1.5 1.5H8.5" />
    </svg>
  )
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M5.5 12.5 10 17l8.5-9" />
    </svg>
  )
}
