import { offerSmsPreview } from "./product";
export function internalTestMessage(
  snapshot: { merchant: string; qualification: string; reward: string },
  kind: "anchor" | "drop",
  passUrl = "[private internal test link]",
) {
  return `INTERNAL TEST — no purchase or reward. ${offerSmsPreview(snapshot.merchant, snapshot.qualification, snapshot.reward, kind, passUrl)}`;
}
