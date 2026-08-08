import { useMutation } from "@tanstack/react-query"

import {
  generateYapTweets,
  type GenerateTweetsInput,
  type GenerateTweetsResult,
} from "@/lib/yaps"

const generateYapTweetsRequest = async (
  input: GenerateTweetsInput,
): Promise<GenerateTweetsResult> => {
  return generateYapTweets(input)
}

/** POST /yaps/generate — ephemeral tweet variants from session memory. */
export function useGenerateYapTweetsMutation() {
  return useMutation({
    mutationKey: ["generate-yap-tweets"],
    mutationFn: generateYapTweetsRequest,
    onError: (error) => {
      console.error("Error generating yap tweets:", error)
    },
  })
}
