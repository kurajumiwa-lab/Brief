import { List, ShieldCheck, Star, Users } from "lucide-react";
import Badge from "@/components/ui/Badge";
import CardShell, { CardBody, CardPoster, CardTitle, CardMeta, CardVendor } from "./CardShell";
import { num } from "@/lib/formatters";

/**
 * COMMUNITY CARD — a public group, or an open curated vendor list.
 *
 * Groups and lists are where a merchant's next suppliers actually come from, so
 * they get a shelf instead of a nav item nobody opens. Membership counts and
 * list ratings are the records' own numbers; groups you are already in, and
 * lists you run, are filtered out before they reach here.
 */
/** A group's own type, in the words the product already uses. */
const GROUP_TYPE_LABELS = { trade: "Trade group", buyer: "Buyer group", niche: "Niche group", open: "Open group" };

export default function CommunityCard({ item }) {
  const isList = item.subtype === "list";
  const Icon = isList ? List : Users;

  return (
    <CardShell
      to={item.to}
      label={`${item.title} — ${isList ? "vendor list" : "group"} with ${item.members} ${item.members === 1 ? "member" : "members"}. Open ${isList ? "vendor lists" : "groups"}`}
    >
      <CardPoster
        icon={Icon}
        label={isList ? "Vendor list" : GROUP_TYPE_LABELS[item.groupType] || "Group"}
        tone={isList ? "orchid" : "brand"}
        corner={
          <>
            <span className="absolute left-2 top-2">
              <Badge variant={isList ? "purple" : "brand"} size="xs">{isList ? "Vendor list" : "Group"}</Badge>
            </span>
            {item.requiresApproval && (
              <span className="absolute right-2 top-2">
                <Badge variant="gray" size="xs">Approval</Badge>
              </span>
            )}
          </>
        }
      />

      <CardBody>
        <CardTitle>{item.title}</CardTitle>
        {item.description ? (
          <p className="line-clamp-2 text-micro leading-snug text-ink-3">{item.description}</p>
        ) : null}
        <CardMeta>{num(item.members)} member{item.members === 1 ? "" : "s"}{item.maxMembers ? ` of ${num(item.maxMembers)}` : ""}</CardMeta>
        {item.category || item.region ? <CardMeta>{[item.category, item.region].filter(Boolean).join(" · ")}</CardMeta> : null}
        {isList && item.rating ? (
          <CardMeta>
            <span className="inline-flex items-center gap-1">
              <Star size={10} aria-hidden="true" />
              {item.rating.toFixed(1)} from {num(item.reviewCount)} review{item.reviewCount === 1 ? "" : "s"}
            </span>
          </CardMeta>
        ) : null}
        {isList && item.patron ? (
          <CardVendor name={item.patron} />
        ) : isList ? (
          <p className="mt-auto flex items-center gap-1 pt-1 text-micro text-ink-4">
            <ShieldCheck size={10} aria-hidden="true" /> Run by the group
          </p>
        ) : null}
      </CardBody>
    </CardShell>
  );
}
