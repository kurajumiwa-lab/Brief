import { List, ShieldCheck, Star, Users } from "lucide-react";
import Badge from "@/components/ui/Badge";
import CardShell, { CardBody, CardMedia, CardTitle, CardMeta, CardVendor } from "./CardShell";
import { num } from "@/lib/formatters";

/**
 * COMMUNITY CARD — a public group, or an open curated vendor list.
 *
 * Groups and lists are where a merchant's next suppliers actually come from, so
 * they get a shelf instead of a nav item nobody opens. Membership counts and
 * list ratings are the records' own numbers; groups you are already in, and
 * lists you run, are filtered out before they reach here.
 */
export default function CommunityCard({ item }) {
  const isList = item.subtype === "list";
  const Icon = isList ? List : Users;

  return (
    <CardShell
      to={item.to}
      label={`${item.title} — ${isList ? "vendor list" : "group"} with ${item.members} ${item.members === 1 ? "member" : "members"}. Open ${isList ? "vendor lists" : "groups"}`}
    >
      <CardMedia
        tint={isList ? "bg-orchid-50 dark:bg-surface-2" : "bg-brand-50 dark:bg-surface-2"}
        fallback={<Icon size={26} className={isList ? "text-orchid-700 dark:text-orchid-300" : "text-brand-700 dark:text-brand-300"} />}
      >
        <span className="absolute left-2 top-2">
          <Badge variant={isList ? "purple" : "brand"} size="xs">{isList ? "Vendor list" : "Group"}</Badge>
        </span>
        {item.requiresApproval && (
          <span className="absolute right-2 top-2">
            <Badge variant="gray" size="xs">Approval</Badge>
          </span>
        )}
      </CardMedia>

      <CardBody>
        <CardTitle>{item.title}</CardTitle>
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
