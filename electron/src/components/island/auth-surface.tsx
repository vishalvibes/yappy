import { useState, type RefObject } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import googleLogo from "@/assets/icons/svg/google.svg"
import yappyLogo from "@/assets/yappy-logo.png"

type AuthSurfaceProps = {
  contentRef: RefObject<HTMLDivElement | null>
  configError: string | null
  googlePending: boolean
  signInWithGoogle: () => Promise<void>
  onMouseEnter: () => void
}

export function AuthSurface({
  contentRef,
  configError,
  googlePending,
  signInWithGoogle,
  onMouseEnter,
}: AuthSurfaceProps) {
  const [authError, setAuthError] = useState<string | null>(null)

  async function submitGoogle() {
    setAuthError(null)
    try {
      await signInWithGoogle()
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Google sign-in failed")
    }
  }

  return (
    <div
      ref={contentRef}
      className="flex w-full max-w-[280px] flex-col items-center gap-4"
      onMouseEnter={onMouseEnter}
    >
      <img
        src={yappyLogo}
        alt="Yappy"
        className="mt-0.5 h-12 w-auto object-contain"
      />
      {configError ? (
        <p className="text-center text-xs text-red-300">{configError}</p>
      ) : null}
      {authError ? (
        <p className="text-center text-xs text-red-300">{authError}</p>
      ) : null}
      {googlePending ? (
        <p className="text-center text-xs text-white/50">
          Finish sign-in in your browser
        </p>
      ) : null}
      <Button
        type="button"
        disabled={googlePending || Boolean(configError)}
        className="h-10 w-full gap-2 bg-white text-black hover:bg-white/90"
        style={{
          cursor: googlePending || configError ? "not-allowed" : "pointer",
        }}
        onClick={() => void submitGoogle()}
      >
        {googlePending ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <img
            src={googleLogo}
            alt=""
            width={16}
            height={16}
            className="size-4"
          />
        )}
        {googlePending
          ? "Right, continue in your browser"
          : "Continue with Google"}
      </Button>
    </div>
  )
}
