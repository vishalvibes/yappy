import { DynamicIsland } from "@/components/island/dynamic-island"
import { TweetsWindow } from "@/components/tweets/tweets-window"

function isTweetsRoute() {
  return window.location.hash.startsWith("#/tweets")
}

export default function App() {
  if (isTweetsRoute()) return <TweetsWindow />
  return <DynamicIsland />
}
