import { useLayoutEffect, useRef } from "react"

type ContentFitOptions = {
  active: boolean
  width: number
  notchPad: number
  gapBelowNotch: number
  bottomPad: number
}

/** Keep the native island window fitted to a rendered content surface. */
export function useContentFit({
  active,
  width,
  notchPad,
  gapBelowNotch,
  bottomPad,
}: ContentFitOptions) {
  const contentRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!active || !contentRef.current) return

    const content = contentRef.current
    const fit = () => {
      const contentHeight = Math.ceil(content.getBoundingClientRect().height)
      void window.ipcRenderer.resizeIslandTo({
        width,
        height: notchPad + gapBelowNotch + contentHeight + bottomPad,
      })
    }

    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(content)
    return () => observer.disconnect()
  }, [active, bottomPad, gapBelowNotch, notchPad, width])

  return contentRef
}
