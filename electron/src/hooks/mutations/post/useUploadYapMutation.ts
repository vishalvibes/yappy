import { useMutation } from "@tanstack/react-query"

import { uploadYap, type UploadYapOptions, type Yap } from "@/lib/yaps"

export type UploadYapParams = {
  blob: Blob
  imageDataUrl?: UploadYapOptions["imageDataUrl"]
}

const uploadYapRequest = async ({
  blob,
  imageDataUrl,
}: UploadYapParams): Promise<Yap> => {
  return uploadYap(blob, { imageDataUrl })
}

/** POST /yaps — audio (+ optional screenshot) → ready yap. */
export function useUploadYapMutation() {
  return useMutation({
    mutationKey: ["upload-yap"],
    mutationFn: uploadYapRequest,
    onError: (error) => {
      console.error("Error uploading yap:", error)
    },
  })
}
