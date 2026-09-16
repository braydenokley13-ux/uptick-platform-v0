import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { requireActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { overview, merchantSourceContext } from "@/lib/read-model";
import { loadOfferMetadata } from "@/lib/product";
import { merchantGrowth } from "@/lib/merchant-growth";
import { MerchantGrowthView } from "@/components/merchant-growth";
import "@/components/merchant-growth.css";
import { growthProgramWorkspace } from "@/lib/growth-programs";
import { merchantOverview } from "@/lib/merchant-overview";
import { MerchantOverview } from "@/components/merchant-overview";
import { GrowthPrograms } from "@/components/growth-programs";
import "@/components/growth-programs.css";
import { Shell } from "@/components/shell";
import { PageHeading, ButtonLink, Location } from "@/components/ui";
import { AnchorCard, SourcesTable, SourceDetail } from "@/components/dashboard";
import { Builder } from "@/components/builder";
import "@/components/merchant.css";

export const dynamic = "force-dynamic";

export default async function Merchant({
  params,
  searchParams,
}: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<{ id?: string; saved?: string }>;
}) {
  const [actor, route, query] = await Promise.all([
    requireActor(),
    params,
    searchParams,
  ]);
  const section = route.section?.[0] || "";
  if (
    (route.section?.length || 0) > 1 ||
    ![
      "",
      "overview",
      "anchor",
      "drops",
      "results",
      "create",
      "plan",
      "network",
      "audience",
      "calendar",
      "activity",
      "loop",
      "program",
      "fulfillment",
    ].includes(section)
  )
    notFound();
  const db = await getDb();
  if (section === "" || section === "overview") {
    const data = await merchantOverview(db, actor);
    return (
      <Shell
        actor={{ ...actor, role: "merchant" }}
        active="overview"
        name={data.organization?.name || "Your store"}
      >
        <MerchantOverview data={data} />
      </Shell>
    );
  }
  if (["program", "fulfillment", "results"].includes(section)) {
    const growth = await growthProgramWorkspace(db, actor);
    const growthSection = (section || "program") as
      "program" | "fulfillment" | "results";
    return (
      <Shell
        actor={{ ...actor, role: "merchant" }}
        active={growthSection}
        name={growth.organization.name}
      >
        <GrowthPrograms data={growth} section={growthSection} />
      </Shell>
    );
  }
  if (
    section !== "create" &&
    section !== "anchor" &&
    !(section === "network" && query.id)
  ) {
    const growth = await merchantGrowth(db, actor);
    return (
      <Shell
        actor={{ ...actor, role: "merchant" }}
        active={section}
        name={growth.organization.name}
      >
        <MerchantGrowthView
          data={growth}
          section={section || "home"}
          selectedOfferId={query.saved}
        />
      </Shell>
    );
  }
  const data = await overview(db, actor);
  const anchor =
    data.offers.find(
      (o) =>
        o.kind === "anchor" &&
        o.state === "live" &&
        new Date(o.starts_at) <= new Date() &&
        new Date(o.expires_at) > new Date(),
    ) || data.offers.find((o) => o.kind === "anchor");
  const editing =
    section === "create" && query.id
      ? data.offers.find(
          (o) =>
            o.id === query.id &&
            o.kind === "drop" &&
            ["draft", "review"].includes(o.state),
        )
      : undefined;
  const source =
    section === "network" && query.id
      ? data.sources.find((s) => s.id === query.id)
      : undefined;
  if (
    query.id &&
    ((section === "create" && !editing) || (section === "network" && !source))
  )
    notFound();
  const metadataOffer =
    section === "create" ? editing : section === "anchor" ? anchor : undefined;
  const [metadata, sourceContext] = await Promise.all([
    metadataOffer
      ? loadOfferMetadata(db, metadataOffer.id, metadataOffer.current_version)
      : undefined,
    source ? merchantSourceContext(db, actor, source.id) : undefined,
  ]);
  return (
    <Shell
      actor={{ ...actor, role: "merchant" }}
      active={section}
      name={data.organization.name}
    >
      <div className="merchant-workspace">
        {section === "anchor" && (
          <>
            <PageHeading
              eyebrow="YOUR ACQUISITION ANCHOR"
              title={
                <>
                  A reason to <em>stop by.</em>
                </>
              }
              description="Your Anchor introduces your business through nearby host locations."
              action={
                <ButtonLink href="/merchant/network" quiet>
                  See where it runs
                </ButtonLink>
              }
            />
            <div className="anchor-detail-layout">
              <AnchorCard data={data} />
              {anchor && (
                <section className="panel anchor-terms">
                  <p className="eyebrow">THE PROMISE ON EVERY PASS</p>
                  <h2>Clear at the counter.</h2>
                  <Location address={anchor.address} />
                  <p>{anchor.terms}</p>
                  <p className="fine">
                    Valid{" "}
                    {new Date(anchor.starts_at).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      timeZone: anchor.timezone,
                    })}{" "}
                    through{" "}
                    {new Date(anchor.expires_at).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                      timeZone: anchor.timezone,
                    })}{" "}
                    · {anchor.timezone}
                  </p>
                  {metadata?.staffInstructions && (
                    <div className="merchant-staff-note">
                      <p className="eyebrow">FOR YOUR TEAM</p>
                      <p>{metadata.staffInstructions}</p>
                    </div>
                  )}
                  <p className="fine">
                    Need a change? Uptick reviews updates so the screen, private
                    pass, and staff instructions stay in step.
                  </p>
                </section>
              )}
            </div>
            <SourcesTable data={data} />
          </>
        )}
        {section === "create" && (
          <>
            <PageHeading
              eyebrow={
                editing
                  ? "OFFER STUDIO · YOUR SAVED DRAFT"
                  : "OFFER STUDIO · CREATE A DROP"
              }
              title={
                <>
                  Their next visit starts <em>here.</em>
                </>
              }
              description="Start with a useful free perk. Next, choose the operating commitment for Uptick’s review."
              action={
                <ButtonLink href="/merchant/drops" quiet>
                  Back to your Drops
                </ButtonLink>
              }
            />
            {editing &&
              data.dropHistory.find((d) => d.id === editing.id)
                ?.review_note && (
                <div className="merchant-review-feedback">
                  <p className="eyebrow">A NOTE FROM UPTICK</p>
                  <p>
                    {
                      data.dropHistory.find((d) => d.id === editing.id)
                        ?.review_note
                    }
                  </p>
                </div>
              )}
            <Builder
              key={
                editing
                  ? `${editing.id}-${editing.current_version}`
                  : "new-drop"
              }
              networkGrowth
              organizationId={data.organization.id}
              merchant={data.organization.name}
              offer={editing}
              metadata={metadata}
              timezone={data.organization.timezone}
            />
          </>
        )}
        {section === "network" && (
          <>
            <PageHeading
              eyebrow="YOUR LOCAL NETWORK"
              title={
                <>
                  Around the corner. <em>On your side.</em>
                </>
              }
              description="See the real places carrying your Anchor, and the actions linked to each QR."
              action={
                source ? (
                  <ButtonLink href="/merchant/network" quiet>
                    All placements
                  </ButtonLink>
                ) : undefined
              }
            />
            {source && (
              <SourceDetail
                source={source}
                timezone={data.organization.timezone}
                context={sourceContext}
              />
            )}
            <SourcesTable data={data} />
            <section className="managed-network-note">
              <ShieldCheck size={22} />
              <div>
                <h3>A neighborhood network, managed for you.</h3>
                <p>
                  Uptick selects compatible hosts, prepares the screen creative,
                  and records each placement handoff. Your results start with an
                  observed QR visit.
                </p>
              </div>
              <Link className="text-link" href="/merchant/plan">
                Your Growth Plan
                <ArrowUpRight size={14} />
              </Link>
            </section>
          </>
        )}
      </div>
    </Shell>
  );
}
