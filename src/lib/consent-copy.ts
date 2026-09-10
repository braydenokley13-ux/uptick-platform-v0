/** The exact customer-facing copy recorded with each consent decision. */
export function disclosure(
  purpose: "fulfillment" | "merchant" | "network",
  merchant: string,
) {
  if (purpose === "fulfillment")
    return `Text me the pass I requested from ${merchant} via Uptick. Message and data rates may apply. Reply HELP for help or STOP to stop texts. Marketing consent is not required.`;
  if (purpose === "merchant")
    return `Send me ${merchant}’s Weekly Drop via Uptick: at most one promotional Drop per week. Optional; consent is not a condition of purchase. Message and data rates may apply. Reply STOP to stop or HELP for help.`;
  return "Send me Uptick Local offers from nearby businesses. Optional; consent is not a condition of purchase. Up to 1 promotional text per week. Message and data rates may apply. Reply STOP to stop or HELP for help.";
}
