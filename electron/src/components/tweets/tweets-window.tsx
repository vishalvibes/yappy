import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { ArrowUp, Loader2, X } from "lucide-react"

import { useAuth } from "@/components/auth-provider"
import { Waveform } from "@/components/island/waveform"
import { useRewriteTweetsWorkflow } from "@/components/tweets/use-rewrite-tweets-workflow"
import {
  BookmarkIcon,
  CheckIcon,
  CopyIcon,
  LikeIcon,
  ReplyIcon,
  RepostIcon,
  ViewsIcon,
} from "@/components/tweets/x-action-icons"
import { cn } from "@/lib/utils"
import yappyLogo from "@/assets/yappy-logo.png"

type Profile = {
  name: string
  handle: string
  avatarUrl: string | null
  initial: string
}

function profileFromUser(
  user: ReturnType<typeof useAuth>["user"],
): Profile {
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
  const name =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    user?.email?.split("@")[0] ||
    "You"
  const handleRaw =
    (typeof meta.preferred_username === "string" && meta.preferred_username) ||
    (typeof meta.user_name === "string" && meta.user_name) ||
    user?.email?.split("@")[0] ||
    "you"
  const handle = handleRaw.replace(/^@/, "").toLowerCase().replace(/\s+/g, "")
  const avatarUrl =
    (typeof meta.avatar_url === "string" && meta.avatar_url) ||
    (typeof meta.picture === "string" && meta.picture) ||
    null
  return {
    name,
    handle,
    avatarUrl,
    initial: name.trim().charAt(0).toUpperCase() || "Y",
  }
}

/** Document window for tweet variations — X-style two-up feed. */
export function TweetsWindow() {
  const { user } = useAuth()
  const profile = useMemo(() => profileFromUser(user), [user])
  const [tweets, setTweets] = useState<string[]>([])
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const rewrite = useRewriteTweetsWorkflow(tweets)

  useEffect(() => {
    let cancelled = false
    void window.ipcRenderer.getTweets().then((list) => {
      if (!cancelled && Array.isArray(list) && list.length) setTweets(list)
    })
    const off = window.ipcRenderer.on("tweets:set", (_event, payload) => {
      if (Array.isArray(payload)) {
        setTweets(payload.filter((t): t is string => typeof t === "string"))
        setCopiedIndex(null)
      }
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  const copyTweet = useCallback(
    async (index: number) => {
      const text = tweets[index]
      if (!text) return
      try {
        await navigator.clipboard.writeText(text)
        setCopiedIndex(index)
        window.setTimeout(() => setCopiedIndex(null), 1500)
      } catch {
        // ignore — user can select/copy manually
      }
    },
    [tweets],
  )

  const applyRewritten = useCallback(async () => {
    const next = await rewrite.sendFeedback()
    if (!next?.length) return
    setTweets(next)
    setCopiedIndex(null)
    void window.ipcRenderer.updateTweets(next)
  }, [rewrite])

  return (
    <div className="flex h-screen w-screen flex-col bg-black text-zinc-100">
      <header className="drag-region flex shrink-0 items-center border-b border-zinc-800 px-5 pb-3 pt-11">
        <div className="no-drag flex w-full items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src={yappyLogo}
              alt="Yappy"
              className="h-9 w-auto select-none"
              draggable={false}
            />
          </div>
          <SuggestChangesControl
            phase={rewrite.phase}
            micStream={rewrite.micStream}
            rewriting={rewrite.rewriting}
            disabled={!tweets.length}
            onSuggest={() => void rewrite.startListening()}
            onSend={() => void applyRewritten()}
            onCancel={rewrite.cancel}
          />
        </div>
      </header>

      {rewrite.error ? (
        <p className="shrink-0 border-b border-zinc-800 px-5 py-2 text-[12px] text-red-300">
          {rewrite.error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {tweets.length === 0 ? (
          <p className="px-1 text-sm leading-6 text-zinc-500">
            Generate content from the notch to fill this feed.
          </p>
        ) : (
          <div
            className={cn(
              "mx-auto flex max-w-[920px] items-start gap-3",
              rewrite.rewriting && "pointer-events-none opacity-50",
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {tweets
                .map((tweet, index) => ({ tweet, index }))
                .filter(({ index }) => index % 2 === 0)
                .map(({ tweet, index }) => (
                  <TweetCard
                    key={`${index}-${tweet.slice(0, 24)}`}
                    tweet={tweet}
                    index={index}
                    profile={profile}
                    copied={copiedIndex === index}
                    onCopy={() => void copyTweet(index)}
                  />
                ))}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {tweets
                .map((tweet, index) => ({ tweet, index }))
                .filter(({ index }) => index % 2 === 1)
                .map(({ tweet, index }) => (
                  <TweetCard
                    key={`${index}-${tweet.slice(0, 24)}`}
                    tweet={tweet}
                    index={index}
                    profile={profile}
                    copied={copiedIndex === index}
                    onCopy={() => void copyTweet(index)}
                  />
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SuggestChangesControl({
  phase,
  micStream,
  rewriting,
  disabled,
  onSuggest,
  onSend,
  onCancel,
}: {
  phase: "idle" | "listening" | "rewriting"
  micStream: MediaStream | null
  rewriting: boolean
  disabled: boolean
  onSuggest: () => void
  onSend: () => void
  onCancel: () => void
}) {
  if (phase === "rewriting" || rewriting) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-zinc-400">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Rewriting…
      </div>
    )
  }

  if (phase === "listening") {
    return (
      <div className="flex h-9 items-center gap-2">
        <button
          type="button"
          aria-label="Cancel recording"
          onClick={onCancel}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
        >
          <X className="size-3.5" strokeWidth={2.5} aria-hidden />
        </button>
        <Waveform active stream={micStream} />
        <button
          type="button"
          aria-label="Send feedback"
          onClick={onSend}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white text-black hover:bg-zinc-200"
        >
          <ArrowUp className="size-3.5" strokeWidth={2.75} aria-hidden />
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSuggest}
      className="cursor-pointer rounded-full border border-zinc-700 bg-zinc-950 px-3.5 py-1.5 text-[13px] font-medium text-zinc-200 hover:border-zinc-600 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
    >
      Suggest changes
    </button>
  )
}

function TweetCard({
  tweet,
  index,
  profile,
  copied,
  onCopy,
}: {
  tweet: string
  index: number
  profile: Profile
  copied: boolean
  onCopy: () => void
}) {
  return (
    <article className="h-fit w-full rounded-lg border border-zinc-800 bg-black px-3.5 pb-2.5 pt-3">
      <div className="flex gap-2.5">
        <Avatar profile={profile} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 leading-5">
              <span className="truncate text-[14px] font-bold text-zinc-100">
                {profile.name}
              </span>
              <span className="truncate text-[14px] text-zinc-500">
                @{profile.handle}
              </span>
              <span className="text-zinc-600" aria-hidden>
                ·
              </span>
              <span className="shrink-0 text-[14px] text-zinc-500">now</span>
            </div>
            <button
              type="button"
              aria-label={
                copied ? `Copied tweet ${index + 1}` : `Copy tweet ${index + 1}`
              }
              className={cn(
                "no-drag -mr-1 -mt-0.5 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-[#71767b] hover:bg-sky-500/10 hover:text-sky-400",
                copied &&
                  "text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-400",
              )}
              onClick={onCopy}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>

          <p className="mt-0.5 whitespace-pre-wrap text-left text-[14px] leading-[1.35] text-zinc-100">
            {tweet}
          </p>

          <div className="mt-1 -ml-2 flex max-w-[340px] items-center justify-between text-[#71767b]">
            <ActionIcon label="Reply">
              <ReplyIcon />
            </ActionIcon>
            <ActionIcon label="Repost">
              <RepostIcon />
            </ActionIcon>
            <ActionIcon label="Like">
              <LikeIcon />
            </ActionIcon>
            <ActionIcon label="Views">
              <ViewsIcon />
            </ActionIcon>
            <ActionIcon label="Bookmark">
              <BookmarkIcon />
            </ActionIcon>
          </div>
        </div>
      </div>
    </article>
  )
}

function Avatar({ profile }: { profile: Profile }) {
  if (profile.avatarUrl) {
    return (
      <img
        src={profile.avatarUrl}
        alt=""
        className="size-10 shrink-0 rounded-full object-cover"
        referrerPolicy="no-referrer"
      />
    )
  }
  return (
    <div
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[14px] font-semibold text-zinc-200"
      aria-hidden
    >
      {profile.initial}
    </div>
  )
}

function ActionIcon({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <span
      className="inline-flex size-[34px] items-center justify-center rounded-full"
      title={label}
      aria-hidden
    >
      {children}
    </span>
  )
}
