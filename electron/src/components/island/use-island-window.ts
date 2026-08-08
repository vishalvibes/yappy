import { useCallback, useEffect, useRef, useState } from "react"

import {
  AUTH_WIDTH,
  NOTCH_HIT_WIDTH,
  type IslandMode,
  YAP_WIDTH,
} from "@/components/island/island-types"

type IslandWindowOptions = {
  userPresent: boolean
  googlePending: boolean
  yapPinned: boolean
}

/** Native-window sizing, hover expansion, and collapse behavior. */
export function useIslandWindow({
  userPresent,
  googlePending,
  yapPinned,
}: IslandWindowOptions) {
  const [mode, setMode] = useState<IslandMode>("collapsed")
  const [notchPad, setNotchPad] = useState(32)
  const [pointerInside, setPointerInside] = useState(false)
  const leaveTimer = useRef<number | null>(null)
  const pointerInsideRef = useRef(false)
  const wasGooglePending = useRef(false)

  const clearLeaveTimer = useCallback(() => {
    if (leaveTimer.current) {
      window.clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
  }, [])

  const resize = useCallback(
    async (next: IslandMode) => {
      setMode(next)
      if (next === "expanded" && !userPresent) {
        await window.ipcRenderer.resizeIslandTo({
          width: AUTH_WIDTH,
          height: notchPad + 130,
        })
        return
      }
      if (next === "pill" && userPresent) {
        await window.ipcRenderer.resizeIslandTo({
          width: YAP_WIDTH,
          height: notchPad + 120,
        })
        return
      }
      await window.ipcRenderer.resizeIsland(next)
    },
    [notchPad, userPresent],
  )

  useEffect(() => {
    void window.ipcRenderer.getMenuBarHeight().then(setNotchPad)
    void window.ipcRenderer.resizeIsland("collapsed")
    return clearLeaveTimer
  }, [clearLeaveTimer])

  useEffect(() => {
    if (googlePending) wasGooglePending.current = true
    if (wasGooglePending.current && userPresent && !googlePending) {
      wasGooglePending.current = false
      void resize("pill")
    }
  }, [googlePending, resize, userPresent])

  const onEnter = useCallback(() => {
    pointerInsideRef.current = true
    setPointerInside(true)
    clearLeaveTimer()
  }, [clearLeaveTimer])

  const onLeave = useCallback(() => {
    pointerInsideRef.current = false
    setPointerInside(false)
    if (googlePending || yapPinned) return
    clearLeaveTimer()
    leaveTimer.current = window.setTimeout(() => {
      void resize("collapsed")
    }, 280)
  }, [clearLeaveTimer, googlePending, resize, yapPinned])

  const collapseAfterUnpin = useCallback(() => {
    if (pointerInsideRef.current) return
    clearLeaveTimer()
    leaveTimer.current = window.setTimeout(() => {
      void resize("collapsed")
    }, 180)
  }, [clearLeaveTimer, resize])

  useEffect(() => {
    if (mode !== "collapsed") {
      void window.ipcRenderer.setIgnoreMouseEvents(false)
      return
    }

    void window.ipcRenderer.setIgnoreMouseEvents(true, { forward: true })
    let opened = false

    function onMove(event: MouseEvent) {
      if (opened) return
      const hitWidth = Math.min(NOTCH_HIT_WIDTH, window.innerWidth)
      const left = (window.innerWidth - hitWidth) / 2
      if (event.clientX < left || event.clientX > left + hitWidth) return

      opened = true
      pointerInsideRef.current = true
      setPointerInside(true)
      clearLeaveTimer()
      void window.ipcRenderer.setIgnoreMouseEvents(false)
      void resize(userPresent ? "pill" : "expanded")
    }

    window.addEventListener("mousemove", onMove)
    return () => {
      window.removeEventListener("mousemove", onMove)
      void window.ipcRenderer.setIgnoreMouseEvents(false)
    }
  }, [clearLeaveTimer, mode, resize, userPresent])

  return {
    mode,
    notchPad,
    pointerInside,
    resize,
    clearLeaveTimer,
    onEnter,
    onLeave,
    collapseAfterUnpin,
  }
}
