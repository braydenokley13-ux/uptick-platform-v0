import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, History, ShieldCheck } from "lucide-react";
import { requireActor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { overview, merchantSourceContext } from "@/lib/read-model";
import { loadOfferMetadata } from "@/lib/product";
import { Shell } from "@/components/shell";
import { PageHeading, ButtonLink, Location } from "@/components/ui";
import {
  Metrics,
  CommandStatus,
  AnchorCard,
  DropCard,
  SourcesTable,
  Loop,
  RecommendationCard,
  AudienceCard,
  NetworkMap,
  SourceDetail,
  GrowthPlan,
  AudienceView,
  ReturnEvidence,
  DropHistoryView,
  NextThirtyDays,
  MerchantActivity,
} from "@/components/dashboard";
import { Builder } from "@/components/builder";
import "@/components/merchant.css";

export const dynamic = "force-dynamic";

export default async function Merchant({
  params,
  searchParams,
}: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<{ id?: string }>;
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
    ].includes(section)
  )
    notFound();
  const db = await getDb();
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
        {section === "" && (
          <>
            <PageHeading
              eyebrow="YOUR NEIGHBORHOOD GROWTH, IN MOTION"
              title={
                <>
                  Good things <em>come around.</em>
                </>
              }
              description={`A reason to visit ${data.organization.name}. A reason to return.`}
              action={
                <ButtonLink href="/merchant/create">
                  Plan your next Drop
                </ButtonLink>
              }
            />
            <CommandStatus data={data} />
            <div className="feature-grid">
              <AnchorCard data={data} />
              <DropCard data={data} />
            </div>
            <RecommendationCard data={data} />
            <div className="command-secondary-grid">
              <AudienceCard data={data} />
              <NextThirtyDays data={data} compact />
            </div>
            <Loop data={data} />
            <div className="merchant-bottom-links">
              <span>
                <ShieldCheck size={14} />
                Managed by Uptick. Built around your store.
              </span>
              <Link href="/merchant/activity">
                View program activity
                <History size={14} />
              </Link>
            </div>
          </>
        )}
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
        {section === "drops" && (
          <>
            <PageHeading
              eyebrow="YOUR WEEKLY DROPS"
              title={
                <>
                  Keep a good thing <em>going.</em>
                </>
              }
              description="One simple offer a week. A fresh reason to come back."
              action={
                <ButtonLink href="/merchant/create">
                  Create a Weekly Drop
                </ButtonLink>
              }
            />
            <div className="drop-workflow">
              <span className="eyebrow">WORKING TOGETHER</span>
              <span>
                <b>01</b>You draft
              </span>
              <span>→</span>
              <span>
                <b>02</b>Uptick reviews
              </span>
              <span>→</span>
              <span>
                <b>03</b>We schedule
              </span>
              <span>→</span>
              <span>
                <b>04</b>Your audience receives it
              </span>
            </div>
            <DropHistoryView data={data} />
            <div className="merchant-bottom-links">
              <span>
                Every Drop keeps its offer details and recorded response.
              </span>
              <Link href="/merchant/calendar">
                See the next 30 days
                <ArrowUpRight size={14} />
              </Link>
            </div>
          </>
        )}
        {section === "create" && (
          <>
            <PageHeading
              eyebrow={
                editing
                  ? "OFFER STUDIO · YOUR SAVED DRAFT"
                  : "OFFER STUDIO · CREATE A WEEKLY DROP"
              }
              title={
                <>
                  Their next visit starts <em>here.</em>
                </>
              }
              description="A useful goal. One free extra. A reason to come back."
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
              organizationId={data.organization.id}
              merchant={data.organization.name}
              offer={editing}
              metadata={metadata}
              timezone={data.organization.timezone}
            />
          </>
        )}
        {section === "plan" && (
          <>
            <PageHeading
              eyebrow="YOUR GROWTH PLAN"
              title={
                <>
                  A system around <em>your store.</em>
                </>
              }
              description="One connected plan for finding nearby customers and giving them reasons to return."
            />
            <GrowthPlan data={data} />
            <RecommendationCard data={data} all />
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
            {source ? (
              <SourceDetail
                source={source}
                timezone={data.organization.timezone}
                context={sourceContext}
              />
            ) : (
              <NetworkMap data={data} />
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
        {section === "audience" && (
          <>
            <PageHeading
              eyebrow="YOUR WEEKLY DROP AUDIENCE"
              title={
                <>
                  Your next invitation. <em>Already welcome.</em>
                </>
              }
              description={`People who chose to hear from ${data.organization.name}. One merchant relationship at a time.`}
              action={
                <ButtonLink href="/merchant/create">
                  Plan their next Drop
                </ButtonLink>
              }
            />
            <AudienceView data={data} />
            {actor.canExport && (
              <section className="merchant-export-note">
                <ShieldCheck size={17} />
                <p>
                  Your export includes consent evidence. Handle customer details
                  with care.
                </p>
                <Link className="text-link" href="/api/export">
                  Export consented contacts
                  <ArrowUpRight size={14} />
                </Link>
              </section>
            )}
          </>
        )}
        {section === "calendar" && (
          <>
            <PageHeading
              eyebrow="THE NEXT 30 DAYS"
              title={
                <>
                  Good growth has <em>a rhythm.</em>
                </>
              }
              description="Your current Anchor, proposed Drops, confirmed schedules, and the next useful review."
              action={
                <ButtonLink href="/merchant/create">
                  Plan a Weekly Drop
                </ButtonLink>
              }
            />
            <NextThirtyDays data={data} />
            <RecommendationCard data={data} />
          </>
        )}
        {section === "activity" && (
          <>
            <PageHeading
              eyebrow="YOUR PROGRAM ACTIVITY"
              title={
                <>
                  Every step. <em>In the open.</em>
                </>
              }
              description="Offer drafts, Uptick reviews, placements, and message preparation, as they happen."
              action={
                <ButtonLink href="/merchant/plan" quiet>
                  Your Growth Plan
                </ButtonLink>
              }
            />
            <MerchantActivity data={data} />
          </>
        )}
        {section === "loop" && (
          <>
            <PageHeading
              eyebrow="THE UPTICK LOOP"
              title={
                <>
                  First a visit. <em>Then a habit.</em>
                </>
              }
              description="Find them nearby. Bring them in. Welcome them to the Drop. Give them reasons to return."
            />
            <Loop data={data} expanded />
            <ReturnEvidence data={data} />
            <RecommendationCard data={data} all />
          </>
        )}
        {section === "results" && (
          <>
            <PageHeading
              eyebrow="OBSERVABLE RESULTS"
              title={
                <>
                  What happened. <em>Clearly.</em>
                </>
              }
              description="Recorded activity across your acquisition and return loop."
            />
            <div className="period-line">
              <span>ALL RECORDED ACTIVITY</span>
              <span>
                Current subscribers · historical claims and redemptions
              </span>
            </div>
            <Metrics data={data} />
            <ReturnEvidence data={data} />
            <DropHistoryView data={data} comparison />
            <SourcesTable data={data} />
            <section className="panel detail-panel merchant-definitions">
              <p className="eyebrow">A LITTLE CLARITY GOES A LONG WAY</p>
              <h2>What these numbers mean.</h2>
              <p>
                A claim is a saved entitlement. A redemption is a completed
                counter record. Delivered means the carrier reported delivery;
                it does not mean the message was read.
              </p>
              <p>
                A recorded return is a later Weekly Drop redemption after an
                initial Anchor redemption. These results do not establish new
                customers, screen impressions, incremental sales, or revenue.
              </p>
              <Link className="text-link" href="/merchant/loop">
                Follow the whole Uptick Loop
                <ArrowUpRight size={15} />
              </Link>
            </section>
          </>
        )}
      </div>
    </Shell>
  );
}
