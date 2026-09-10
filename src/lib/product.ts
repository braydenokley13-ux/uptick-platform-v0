import type { DB } from "./db";

export const offerGoals = [
  {
    id: "acquisition",
    label: "Bring nearby people in",
    hint: "A clear first reason to choose you.",
  },
  {
    id: "morning",
    label: "Grow morning traffic",
    hint: "Make a morning purchase feel a little better.",
  },
  {
    id: "basket",
    label: "Grow in-store purchases",
    hint: "Connect a free extra to a useful purchase.",
  },
  {
    id: "product",
    label: "Move a specific product",
    hint: "Give one product a reason to be noticed.",
  },
  {
    id: "return",
    label: "Bring people back this week",
    hint: "A fresh reason for your audience to return.",
  },
  {
    id: "slow",
    label: "Fill a quieter time",
    hint: "Give people a simple reason to visit then.",
  },
  {
    id: "new",
    label: "Introduce something new",
    hint: "Let customers try a new part of your business.",
  },
] as const;
export type OfferMetadata = {
  goal: string;
  templateId: string | null;
  customerValue: number | null;
  rewardCost: number | null;
  requiredPurchase: number | null;
  staffInstructions: string;
};
export const defaultMetadata: OfferMetadata = {
  goal: "return",
  templateId: null,
  customerValue: null,
  rewardCost: null,
  requiredPurchase: null,
  staffInstructions: "",
};
export async function loadOfferMetadata(
  db: DB,
  offerId: string,
  version: number,
): Promise<OfferMetadata> {
  const [row] = await db.query<{
    goal: string;
    template_id: string | null;
    customer_value: string | null;
    reward_cost: string | null;
    required_purchase: string | null;
    staff_instructions: string;
  }>("select * from offer_product_metadata where offer_id=$1 and version=$2", [
    offerId,
    version,
  ]);
  return row
    ? {
        goal: row.goal,
        templateId: row.template_id,
        customerValue:
          row.customer_value === null ? null : Number(row.customer_value),
        rewardCost: row.reward_cost === null ? null : Number(row.reward_cost),
        requiredPurchase:
          row.required_purchase === null ? null : Number(row.required_purchase),
        staffInstructions: row.staff_instructions,
      }
    : { ...defaultMetadata };
}
export type OfferTemplate = {
  id: string;
  name: string;
  category:
    "Acquisition" | "Morning traffic" | "Slow hours" | "Return" | "Limited";
  bestAs: "anchor" | "drop" | "both";
  goals: string[];
  goodFor: string;
  how: string;
  qualification: string;
  reward: string;
  fields: string;
  terms?: string;
  limit?: number;
};
export const offerTemplates: OfferTemplate[] = [
  {
    id: "fuel-coffee",
    name: "Fuel + Free Coffee",
    category: "Acquisition",
    bestAs: "anchor",
    goals: ["acquisition", "basket"],
    goodFor: "Nearby drivers with a reason to stop.",
    how: "Tie a familiar free item to a fuel purchase.",
    qualification: "Buy $25 of gas",
    reward: "Get a free large coffee",
    fields: "Fuel spend · drink size",
  },
  {
    id: "spend-free",
    name: "Spend + Free Item",
    category: "Acquisition",
    bestAs: "both",
    goals: ["basket", "acquisition"],
    goodFor: "A simple purchase threshold.",
    how: "Choose an attainable spend and one clear reward.",
    qualification: "Spend $15 in store",
    reward: "Get a free fountain drink",
    fields: "Minimum spend · free item",
  },
  {
    id: "first-visit",
    name: "First Visit Bonus",
    category: "Acquisition",
    bestAs: "anchor",
    goals: ["acquisition", "new"],
    goodFor: "Introducing your store to the neighborhood.",
    how: "Give one free extra on the first redemption of this offer.",
    qualification: "Make a qualifying in-store purchase",
    reward: "Get a free snack on your first redemption",
    fields: "Qualifying purchase · free item",
  },
  {
    id: "service-extra",
    name: "Service + Free Add-On",
    category: "Acquisition",
    bestAs: "anchor",
    goals: ["acquisition", "new"],
    goodFor: "Service businesses with a small add-on.",
    how: "Pair the core service with one included upgrade.",
    qualification: "Buy a standard car wash",
    reward: "Get a free tire shine",
    fields: "Service · free upgrade",
  },
  {
    id: "breakfast",
    name: "Breakfast + Coffee",
    category: "Morning traffic",
    bestAs: "drop",
    goals: ["morning", "return"],
    goodFor: "An easy breakfast habit.",
    how: "Reward a breakfast purchase with a free drink.",
    qualification: "Buy a breakfast sandwich",
    reward: "Get a free large coffee",
    fields: "Breakfast item · drink size",
  },
  {
    id: "morning-drink",
    name: "Morning Purchase + Free Drink",
    category: "Morning traffic",
    bestAs: "both",
    goals: ["morning", "basket"],
    goodFor: "Turning a morning stop into a purchase.",
    how: "Use one spend threshold in a defined morning window.",
    qualification: "Spend $10 in store before 11 AM",
    reward: "Get a free coffee",
    fields: "Spend · cutoff time · drink",
  },
  {
    id: "before-eleven",
    name: "Before 11 AM",
    category: "Morning traffic",
    bestAs: "drop",
    goals: ["morning", "slow"],
    goodFor: "A morning visit before the rush ends.",
    how: "Add a free extra to one item before a clear cutoff.",
    qualification: "Buy any pastry before 11 AM",
    reward: "Get a free small coffee",
    fields: "Purchase · cutoff time · reward",
  },
  {
    id: "afternoon",
    name: "Afternoon Drop",
    category: "Slow hours",
    bestAs: "drop",
    goals: ["slow", "product"],
    goodFor: "A reason to stop during a quiet afternoon.",
    how: "Keep the purchase simple and name the hours.",
    qualification: "Buy a sandwich between 2 PM and 5 PM",
    reward: "Get a free fountain drink",
    fields: "Item · hours · drink",
  },
  {
    id: "midweek",
    name: "Midweek Drop",
    category: "Slow hours",
    bestAs: "drop",
    goals: ["slow", "return"],
    goodFor: "A quieter Tuesday or Wednesday.",
    how: "Give one day its own free extra.",
    qualification: "Spend $15 in store this Wednesday",
    reward: "Get a free bag of chips",
    fields: "Spend · day · free item",
  },
  {
    id: "last-hours",
    name: "Last Two Hours",
    category: "Slow hours",
    bestAs: "drop",
    goals: ["slow", "product"],
    goodFor: "A short, staff-friendly closing offer.",
    how: "Pair a qualifying purchase with an available extra.",
    qualification: "Buy a prepared meal in our last two hours",
    reward: "Get a free cookie",
    fields: "Meal · exact hours · reward",
  },
  {
    id: "come-back",
    name: "Come Back This Week",
    category: "Return",
    bestAs: "drop",
    goals: ["return", "basket"],
    goodFor: "Giving your current audience a fresh reason.",
    how: "Keep the week’s offer easy to remember.",
    qualification: "Spend $20 in store this week",
    reward: "Get a free cold drink",
    fields: "Spend · dates · drink",
  },
  {
    id: "buy-get",
    name: "Buy X → Get Y Free",
    category: "Return",
    bestAs: "both",
    goals: ["product", "return"],
    goodFor: "Focusing attention on a specific item.",
    how: "Buy one named item; get one named extra.",
    qualification: "Buy any fresh-made sandwich",
    reward: "Get a free bag of chips",
    fields: "Purchase item · free item",
  },
  {
    id: "weekend",
    name: "Weekend Return Drop",
    category: "Return",
    bestAs: "drop",
    goals: ["return", "new"],
    goodFor: "A weekend invitation to your audience.",
    how: "Bundle a familiar purchase with something free.",
    qualification: "Buy a pizza this weekend",
    reward: "Get a free 2-liter drink",
    fields: "Purchase · weekend dates · reward",
  },
  {
    id: "first-thirty",
    name: "First 30",
    category: "Limited",
    bestAs: "drop",
    goals: ["new", "product"],
    goodFor: "A reward with a genuinely limited supply.",
    how: "Reserve an item for each of the first 30 claims.",
    qualification: "Buy a lunch sandwich",
    reward: "Get a free bakery cookie",
    fields: "Purchase · reward · quantity",
    limit: 30,
  },
  {
    id: "supplies",
    name: "While Supplies Last",
    category: "Limited",
    bestAs: "drop",
    goals: ["product", "new"],
    goodFor: "A fixed amount of a real reward.",
    how: "Set the redemption cap to the stock you can honor.",
    qualification: "Buy a fountain drink",
    reward: "Get a free sample snack",
    fields: "Purchase · reward · available quantity",
    limit: 50,
  },
  {
    id: "one-day",
    name: "One-Day Drop",
    category: "Limited",
    bestAs: "drop",
    goals: ["slow", "return"],
    goodFor: "One clear reason to visit on one day.",
    how: "Keep a one-day offer easy to explain at the counter.",
    qualification: "Spend $10 in store this Friday",
    reward: "Get a free coffee",
    fields: "Spend · date · reward",
  },
];
export type QualityCheck = {
  key: string;
  label: string;
  detail: string;
  tone: "strong" | "watch";
};
export function qualityReview(
  input: Pick<
    OfferMetadata,
    "customerValue" | "rewardCost" | "requiredPurchase" | "staffInstructions"
  > & {
    qualification: string;
    reward: string;
    terms: string;
    startsAt: string;
    expiresAt: string;
  },
): QualityCheck[] {
  const free = /\bfree\b/i.test(input.reward),
    wordCount = (input.qualification + " " + input.reward)
      .trim()
      .split(/\s+/).length;
  const conditions = (
    input.qualification.match(
      /\b(and|or|only|before|after|between|minimum|excluding)\b/gi,
    ) || []
  ).length;
  const window =
    (Date.parse(input.expiresAt) - Date.parse(input.startsAt)) / 3600000;
  return [
    {
      key: "free",
      tone: free ? "strong" : "watch",
      label: free ? "Something is clearly free" : "Name the free reward",
      detail: free
        ? "The reward includes the word “free.”"
        : "Weekly Drops work around one clear free item. Put it in the reward.",
    },
    {
      key: "clarity",
      tone: wordCount <= 20 ? "strong" : "watch",
      label:
        wordCount <= 20
          ? "A quick read on a screen"
          : "Shorten the screen message",
      detail: `${wordCount} words across purchase and reward. Aim for 20 or fewer.`,
    },
    {
      key: "conditions",
      tone: conditions <= 2 ? "strong" : "watch",
      label:
        conditions <= 2
          ? "A simple purchase to explain"
          : "Several conditions to explain",
      detail:
        conditions <= 2
          ? "The main offer has two or fewer condition words. Check that staff can explain it in one sentence."
          : `${conditions} condition words appear in the purchase. Consider a simpler requirement.`,
    },
    ...(input.customerValue !== null && input.requiredPurchase !== null
      ? [
          {
            key: "value",
            tone:
              input.requiredPurchase > input.customerValue * 30
                ? ("watch" as const)
                : ("strong" as const),
            label:
              input.requiredPurchase > input.customerValue * 30
                ? "Check the value of the ask"
                : "Customer value is visible",
            detail:
              input.requiredPurchase > input.customerValue * 30
                ? "Required purchase is more than 30× the estimated reward value. Make sure the offer still feels worthwhile."
                : "The free reward and required purchase both have merchant-entered estimates.",
          },
        ]
      : []),
    {
      key: "window",
      tone: Number.isFinite(window) && window >= 4 ? "strong" : "watch",
      label:
        Number.isFinite(window) && window >= 4
          ? "Time to act"
          : "Check the redemption window",
      detail: Number.isFinite(window)
        ? `${window.toFixed(1)} hours between the proposed start and end. ${window < 4 ? "A short window may be easy to miss." : "Confirm the dates match your opening hours."}`
        : "Choose valid start and end dates.",
    },
    {
      key: "staff",
      tone: input.staffInstructions.trim() ? "strong" : "watch",
      label: input.staffInstructions.trim()
        ? "A note for the counter"
        : "Add a quick staff note",
      detail: input.staffInstructions.trim()
        ? "The operator can include this note in the printable staff sheet."
        : "Tell staff what to check and what to give. It helps the first redemption go smoothly.",
    },
  ];
}
export function offerSmsPreview(
  merchant: string,
  qualification: string,
  reward: string,
  kind: string,
  passUrl = "[private pass link]",
) {
  return `${merchant} via Uptick: ${kind === "drop" ? "Your Weekly Drop. " : ""}${qualification}. ${reward}. Your private pass: ${passUrl} Reply STOP to stop, HELP for help.`;
}
export function offerState(state: string, expiresAt?: string) {
  if (
    expiresAt &&
    new Date(expiresAt) < new Date() &&
    ["live", "scheduled"].includes(state)
  )
    return "Completed";
  return (
    (
      {
        review: "In Uptick review",
        needs_changes: "Needs changes",
        rejected: "Not approved",
        ended: "Completed",
        draft: "Draft",
        scheduled: "Scheduled",
        live: "Live",
        paused: "Paused",
        approved: "Approved",
      } as Record<string, string>
    )[state] || state
  );
}
export function placementState(status: string, state = "active") {
  if (state === "revoked") return "Removed";
  return (
    (
      {
        intended: "Intended",
        confirmed: "Confirmed by Uptick",
        external_confirmed: "Externally confirmed",
        externally_confirmed: "Externally confirmed",
        paused: "Paused",
        removed: "Removed",
        unknown: "Unknown",
      } as Record<string, string>
    )[status] || "Unknown"
  );
}
