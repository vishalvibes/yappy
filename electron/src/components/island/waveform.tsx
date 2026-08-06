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
  /** When true, drive bars from mic amplitude. */
  active: boolean
  /**
   * Shared mic stream from the recorder. When set, Waveform analyses this
   * stream instead of opening its own getUserMedia.
   */
  stream?: MediaStream | null
  className?: string
}

/**
 * Tiny white bar visualizer. Levels come from live mic amplitude.
 * Prefer a shared `stream` from the parent recorder so we don't open twice.
 * Bars expand from the vertical middle (not bottom-up).
 */
export function Waveform({ active, stream = null, className }: WaveformProps) {
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
    let ownedStream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let analyser: AnalyserNode | null = null
    let data: Uint8Array<ArrayBuffer> | null = null

    async function start() {
      let mic = stream
      if (!mic) {
        try {
          const allowed =
            (await window.ipcRenderer?.askMicrophoneAccess?.()) ?? true
          if (!allowed) return

          ownedStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          })
          mic = ownedStream
        } catch {
          return
        }
      }
      if (cancelled || !mic) {
        ownedStream?.getTracks().forEach((t) => t.stop())
        return
      }

      ctx = new AudioContext()
      const source = ctx.createMediaStreamSource(mic)
      analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.55
      source.connect(analyser)
      data = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>

      const tick = () => {
        if (cancelled || !analyser || !data) return
        analyser.getByteFrequencyData(data)

        const bins = data.length
        const startBin = Math.floor(bins * 0.08)
        const end = Math.floor(bins * 0.45)
        const span = Math.max(1, end - startBin)

        let peak = 0
        for (let i = 0; i < BAR_COUNT; i++) {
          const a = startBin + Math.floor((i / BAR_COUNT) * span)
          const b = startBin + Math.floor(((i + 1) / BAR_COUNT) * span)
          let sum = 0
          for (let j = a; j < b; j++) sum += data[j] ?? 0
          const avg = sum / Math.max(1, b - a) / 255
          const level = Math.min(1, Math.pow(avg * 1.65, 0.85))
          peak = Math.max(peak, level)
          const prev = levelsRef.current[i] ?? IDLE[i]!
          const next =
            level > prev
              ? prev + (level - prev) * 0.55
              : prev + (level - prev) * 0.22
          levelsRef.current[i] = next
        }

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
      // Only stop tracks we opened ourselves — parent owns `stream`.
      ownedStream?.getTracks().forEach((t) => t.stop())
    }
  }, [active, stream])

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
