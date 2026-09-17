/* The member's navigation, in one place.

   The bottom bar is the member's whole navigation, and it used to be defined in
   the component while the page decided separately which views it knew how to
   render. The two drifted: `Places` was in the bar, `?view=places` rendered
   Home, and Home stayed lit — a tab that looked broken when pressed.

   Declaring the tabs and the views together means a new tab cannot be added
   without a view to land on, and `tests/member-navigation.test.ts` fails if one
   ever is. */

/** Every `?view=` the member page renders. Anything else is Home. */
export const memberViews = ["history", "places", "preferences"] as const;
export type MemberView = (typeof memberViews)[number];

export function memberView(raw?: string): MemberView | undefined {
  return raw && (memberViews as readonly string[]).includes(raw)
    ? (raw as MemberView)
    : undefined;
}

/** The bottom bar, in order. `view` is undefined for tabs that leave the
    member page entirely — Support is a real page of its own. */
export const memberTabs = [
  { label: "Home", href: "/your-uptick", view: undefined },
  { label: "Uptick", href: "/your-uptick?view=history", view: "history" },
  { label: "Places", href: "/your-uptick?view=places", view: "places" },
  { label: "Support", href: "/sms", view: undefined },
  {
    label: "Profile",
    href: "/your-uptick?view=preferences",
    view: "preferences",
  },
] as const satisfies readonly {
  label: string;
  href: string;
  view: MemberView | undefined;
}[];

/** Which tab the bar should light for a given view. */
export function activeMemberTab(view?: string) {
  const resolved = memberView(view);
  return (
    memberTabs.find((tab) => resolved && tab.view === resolved)?.label || "Home"
  );
}
