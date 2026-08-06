import { useCallback } from "react"

import { AuthSurface } from "@/components/island/auth-surface"
import {
  AUTH_BOTTOM_PAD,
  AUTH_GAP_BELOW_NOTCH,
  AUTH_WIDTH,
  YAP_BOTTOM_PAD,
  YAP_GAP_BELOW_NOTCH,
  YAP_WIDTH,
} from "@/components/island/island-types"
import { useContentFit } from "@/components/island/use-content-fit"
import { useIslandWindow } from "@/components/island/use-island-window"
import { useYapWorkflow } from "@/components/island/use-yap-workflow"
import { YapSurface } from "@/components/island/yap-surface"
import { useAuth } from "@/components/auth-provider"
import { cn } from "@/lib/utils"

export function DynamicIsland() {
  const { user, signInWithGoogle, configError, googlePending } = useAuth()
  const userPresent = Boolean(user)

  const yap = useYapWorkflow()
  const island = useIslandWindow({
    userPresent,
    googlePending,
    yapPinned: yap.pinned,
  })
  const dismissYap = useCallback(() => {
    yap.dismiss()
    island.collapseAfterUnpin()
  }, [island.collapseAfterUnpin, yap.dismiss])

  const isAuthExpanded = island.mode === "expanded" && !userPresent
  const isYapSurface = userPresent && island.mode === "pill"

  const authContentRef = useContentFit({
    active: isAuthExpanded,
    width: AUTH_WIDTH,
    notchPad: island.notchPad,
    gapBelowNotch: AUTH_GAP_BELOW_NOTCH,
    bottomPad: AUTH_BOTTOM_PAD,
  })
  const yapContentRef = useContentFit({
    active: isYapSurface,
    width: YAP_WIDTH,
    notchPad: island.notchPad,
    gapBelowNotch: YAP_GAP_BELOW_NOTCH,
    bottomPad: YAP_BOTTOM_PAD,
  })

  return (
    <div
      className="flex h-screen w-screen items-stretch justify-center bg-transparent"
      onMouseEnter={island.onEnter}
      onMouseLeave={island.onLeave}
    >
      <div
        className={cn(
          "flex h-full w-full flex-col items-center overflow-hidden text-white",
          island.mode === "collapsed" && "justify-start bg-transparent pt-3",
          isYapSurface &&
            "justify-start rounded-t-none rounded-b-[28px] bg-black px-5",
          isAuthExpanded &&
            "justify-start rounded-t-none rounded-b-[28px] bg-black px-5",
          island.mode === "pill" &&
            !userPresent &&
            "justify-end rounded-t-none rounded-b-[28px] bg-black px-5 pb-4",
        )}
        style={
          island.mode === "pill" || island.mode === "expanded"
            ? {
                paddingTop:
                  island.notchPad +
                  (isYapSurface
                    ? YAP_GAP_BELOW_NOTCH
                    : isAuthExpanded
                      ? AUTH_GAP_BELOW_NOTCH
                      : 8),
                ...(isAuthExpanded || isYapSurface
                  ? {
                      paddingBottom: isYapSurface
                        ? YAP_BOTTOM_PAD
                        : AUTH_BOTTOM_PAD,
                    }
                  : null),
              }
            : undefined
        }
      >
        {island.mode === "collapsed" ? <CollapsedHandle /> : null}

        {island.mode === "pill" && !userPresent ? (
          <button
            type="button"
            className="text-[15px] font-medium tracking-tight"
            onClick={() => void island.resize("expanded")}
          >
            Sign in to Yappy
          </button>
        ) : null}

        {isYapSurface ? (
          <YapSurface
            contentRef={yapContentRef}
            workflow={yap}
            onDismiss={dismissYap}
            onMouseEnter={island.clearLeaveTimer}
          />
        ) : null}

        {isAuthExpanded ? (
          <AuthSurface
            contentRef={authContentRef}
            configError={configError}
            googlePending={googlePending}
            signInWithGoogle={signInWithGoogle}
            onMouseEnter={island.clearLeaveTimer}
          />
        ) : null}
      </div>
    </div>
  )
}

function CollapsedHandle() {
  return (
    <div
      className="h-[5px] w-14 rounded-full bg-neutral-500/35 shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.2),0_0_0_0.5px_rgba(0,0,0,0.12)]"
      aria-hidden
    />
  )
}
