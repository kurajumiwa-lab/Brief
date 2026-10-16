import { CalendarDays, MapPin, Users, Sparkles } from "lucide-react";
import Badge from "@/components/ui/Badge";
import CardShell, { CardBody, CardPoster, CardTitle, CardPrice, CardMeta, CardVendor } from "./CardShell";
import { dayLabel, shortDateTime, currency, num } from "@/lib/formatters";

/**
 * NOTICE CARD — AI-assisted notice on the home feed shelf (v3.3).
 *
 * Reuses the Events page design system:
 *   - Same typography
 *   - Same spacing
 *   - Same image assets
 *   - Same aspect ratios
 *   - Same crop behavior
 *   - Same layout
 *   - Same responsive rules
 *
 * Do NOT introduce unnecessary frames or decorative card borders.
 * Do NOT overlay text on images unless the Events page already uses that treatment.
 * Do NOT combine unrelated text and images into graphics.
 * Do NOT create a different visual system.
 */

const NOTICE_TYPE_LABELS = {
  product_promotion: "Product Promotion",
  service_offering: "Service",
  event: "Event",
  business_announcement: "Announcement",
  opportunity: "Opportunity",
  user_agenda: "Agenda",
};

const STATUS_BADGE = {
  draft: "gray",
  published: "brand",
  archived: "red",
  expired: "amber",
};

export default function NoticeCard({ item }) {
  const isAIGenerated = item.source === "ai" || item.ai_assisted;

  return (
    <CardShell 
      to={item.to || `/notices/${item.id}`}
      label={`${item.title} — ${item.type ? NOTICE_TYPE_LABELS[item.type] || item.type : "Notice"}. ${item.start_date ? `On ${dayLabel(item.start_date)}` : ""}`}
    >
      {/* Poster - reuses CardPoster with AI indicator */}
      <CardPoster
        icon={item.type === "event" ? CalendarDays : item.type === "product_promotion" ? Sparkles : Users}
        label={item.type ? NOTICE_TYPE_LABELS[item.type] || item.type : "Notice"}
        tone={isAIGenerated ? "brand" : "amber"}
        corner={
          isAIGenerated && (
            <span className="absolute right-2 top-2">
              <Badge variant="brand" size="xs">
                <Sparkles size={8} /> AI
              </Badge>
            </span>
          )
        }
      />

      <CardBody>
        <CardTitle>{item.title}</CardTitle>
        
        {/* Date and type */}
        {item.start_date && (
          <CardPrice>
            {dayLabel(item.start_date)}
            {item.location && !item.is_virtual && ` · ${item.location}`}
            {item.is_virtual && " · Virtual"}
          </CardPrice>
        )}
        
        {/* Organizer */}
        <CardVendor name={item.organizer || item.organizer_business || item.owner?.name} />
        
        {/* Metadata */}
        <CardMeta>
          {item.price != null && (
            <span>{item.price ? currency(item.price) : "Free"}</span>
          )}
          {item.view_count != null && (
            <span className="ml-2">
              <Users size={10} className="inline" /> {num(item.view_count)} views
            </span>
          )}
        </CardMeta>
        
        {/* Tags */}
        {item.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {item.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="outline" size="xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        
        {/* Status badge */}
        {item.status && item.status !== "published" && (
          <div className="mt-1">
            <Badge variant={STATUS_BADGE[item.status] || "gray"} size="xs">
              {item.status}
            </Badge>
          </div>
        )}
      </CardBody>
    </CardShell>
  );
}
