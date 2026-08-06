import { useEffect, useRef } from "react"

import { cn } from "@/lib/utils"

const BAR_COUNT = 6
/** Idle resting heights (fraction of max) — slight variety when silent. */
const IDLE = [0.28, 0.42, 0.55, 0.48, 0.35, 0.3]
/** Full bar travel; grows equally above + below the midline. */
const MAX_PX = 32
const MIN_PX = 5
/** Track tall enough for bidirectional expansion. */
const TRACK_PX = MAX_PX

type WaveformProps = {
  /** When true, tap mic levels to drive bars. Audio is never recorded/saved. */
  active: boolean
  className?: string
}

/**
 * Tiny white bar visualizer. Levels come from live mic amplitude only —
 * stream is analysed then discarded (no MediaRecorder / upload).
 * Bars expand from the vertical middle (not bottom-up).
 */
export function Waveform({ active, className }: WaveformProps) {
  const barsRef = useRef<(HTMLSpanElement | null)[]>([])
  const levelsRef = useRef<number[]>([...IDLE])

  useEffect(() => {
    if (!active) {
      levelsRef.current = [...IDLE]
      for (let i = 0; i < BAR_COUNT; i++) {
        const el = barsRef.current[i]
        if (el) el.style.height = `${Math.round(IDLE[i]! * MAX_PX)}px`
      }
      return
    }

    let cancelled = false
    let raf = 0
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let analyser: AnalyserNode | null = null
    let data: Uint8Array<ArrayBuffer> | null = null

    async function start() {
      try {
        const allowed =
          (await window.ipcRenderer?.askMicrophoneAccess?.()) ?? true
        if (!allowed) return

        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        })
      } catch {
        // Permission denied / no device — keep idle heights.
        return
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      ctx = new AudioContext()
      const source = ctx.createMediaStreamSource(stream)
      analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.55
      source.connect(analyser)
      data = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>

      const tick = () => {
        if (cancelled || !analyser || !data) return
        analyser.getByteFrequencyData(data)

        // Sample a few mid-low bins so speech maps cleanly to 6 bars.
        const bins = data.length
        const start = Math.floor(bins * 0.08)
        const end = Math.floor(bins * 0.45)
        const span = Math.max(1, end - start)

        let peak = 0
        for (let i = 0; i < BAR_COUNT; i++) {
          const a = start + Math.floor((i / BAR_COUNT) * span)
          const b = start + Math.floor(((i + 1) / BAR_COUNT) * span)
          let sum = 0
          for (let j = a; j < b; j++) sum += data[j] ?? 0
          const avg = sum / Math.max(1, b - a) / 255
          // Boost quiet speech; clamp.
          const level = Math.min(1, Math.pow(avg * 1.65, 0.85))
          peak = Math.max(peak, level)
          const prev = levelsRef.current[i] ?? IDLE[i]!
          // Fast attack, slower release.
          const next =
            level > prev
              ? prev + (level - prev) * 0.55
              : prev + (level - prev) * 0.22
          levelsRef.current[i] = next
        }

        // Soft breathe when nearly silent so the UI doesn't freeze.
        const breathe =
          peak < 0.06 ? 0.04 + 0.03 * Math.sin(performance.now() / 320) : 0

        for (let i = 0; i < BAR_COUNT; i++) {
          const el = barsRef.current[i]
          if (!el) continue
          const base = levelsRef.current[i] ?? IDLE[i]!
          const h = Math.round(
            Math.max(MIN_PX, Math.min(MAX_PX, (base + breathe) * MAX_PX)),
          )
          el.style.height = `${h}px`
        }

        raf = requestAnimationFrame(tick)
      }

      raf = requestAnimationFrame(tick)
    }

    void start()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      analyser?.disconnect()
      void ctx?.close()
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [active])

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-[3px]",
        className,
      )}
      style={{ height: TRACK_PX }}
      aria-hidden
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            barsRef.current[i] = el
          }}
          className="w-[3px] rounded-full bg-white"
          style={{ height: Math.round(IDLE[i]! * MAX_PX) }}
        />
      ))}
    </div>
  )
}
