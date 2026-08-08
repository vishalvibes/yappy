import { useMutation } from "@tanstack/react-query"

import { rewriteTweets, type RewriteTweetsResult } from "@/lib/yaps"

export type RewriteTweetsParams = {
  blob: Blob
  tweets: string[]
}

const rewriteTweetsRequest = async ({
  blob,
  tweets,
}: RewriteTweetsParams): Promise<RewriteTweetsResult> => {
  return rewriteTweets(blob, tweets)
}

/** POST /yaps/rewrite-tweets — voice feedback → rewritten drafts. */
export function useRewriteTweetsMutation() {
  return useMutation({
    mutationKey: ["rewrite-tweets"],
    mutationFn: rewriteTweetsRequest,
    onError: (error) => {
      console.error("Error rewriting tweets:", error)
    },
  })
}
