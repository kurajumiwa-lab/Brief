import { Link } from "react-router-dom";
import { Pin } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import StockShare from "./StockShare";
import DealProposalCard from "./DealProposalCard";
import VoiceNote from "./VoiceNote";
import { resolveIdentityDisplay } from "./ChatIdentityModal";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import { timeOnly } from "@/lib/formatters";
import { cn } from "@/lib/utils";

export default function MessageBubble({ message: m, mine, showHeader = true }) {
  const vendor = useAuthStore((s) => s.vendor);
  const chatIdentity = useChatStore((s) => s.chatIdentity);

  if (m.message_type === "system") {
    const kind = m.deal_data?.kind;
    return (
      <div className="px-4 mt-3 flex justify-center" data-testid="system-message">
        <p
          className={cn(
            "max-w-[85%] text-center text-2xs rounded-full border px-3 py-1",
            kind === "deal_accepted"
              ? "border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-surface-2 text-brand-700 dark:text-brand-300"
              : kind === "deal_declined"
              ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-surface-2 text-red-700 dark:text-red-300"
              : "border-edge-1 bg-surface-2 text-ink-3"
          )}
          title={timeOnly(m.sent_at)}
        >
          {m.content}
        </p>
      </div>
    );
  }

  const showRichIdentity = chatIdentity?.locations?.messages !== false;
  const identity = resolveIdentityDisplay({
    vendor: mine ? vendor : null,
    chatIdentity,
    location: "messages",
    senderBusiness: m.sender_business || (mine ? vendor?.business_name : m.sender_handle),
    senderHandle: m.sender_handle || (mine ? vendor?.vendor_handle : "vendor"),
    senderName: mine
      ? chatIdentity?.sender_name || vendor?.business_name
      : m.sender_name || m.sender_business || m.sender_handle,
    senderRole: mine ? chatIdentity?.sender_role : m.sender_role,
    avatarUrl: mine ? chatIdentity?.avatar_url : m.sender_avatar_url,
    logoUrl: mine ? chatIdentity?.logo_url : m.sender_logo_url,
  });

  return (
    <div className={cn("flex gap-2.5 px-4", mine ? "flex-row-reverse" : "flex-row", showHeader ? "mt-3" : "mt-0.5")}>
      <div className="w-8 shrink-0">
        {showHeader && (
          <Avatar
            name={m.sender_business || m.sender_handle}
            personalName={identity.personalName}
            businessName={identity.businessName}
            src={showRichIdentity ? identity.avatarUrl || undefined : undefined}
            logoSrc={showRichIdentity ? identity.logoUrl || undefined : undefined}
            mode={showRichIdentity ? identity.mode : "default"}
            size="sm"
          />
        )}
      </div>
      <div className={cn("max-w-[78%] min-w-0 flex flex-col", mine ? "items-end" : "items-start")}>
        {showHeader && (
          <div className={cn("flex items-baseline flex-wrap gap-2 mb-1 text-2xs", mine && "flex-row-reverse")}>
            <Link to={`/@${m.sender_handle}`} className="font-medium text-ink-2 hover:text-brand-600 dark:hover:text-brand-400">
              {mine
                ? showRichIdentity && identity.mode !== "business_logo"
                  ? `You (${identity.primaryTitle})`
                  : "You"
                : showRichIdentity
                ? identity.primaryTitle
                : m.sender_business || `@${m.sender_handle}`}
            </Link>
            {!mine && <span className="font-mono text-ink-4">@{m.sender_handle}</span>}
            {showRichIdentity && identity.mode === "business_with_role" && identity.roleTitle && (
              <Badge variant="outline" size="xs">
                {identity.roleTitle}
              </Badge>
            )}
            <span className="text-ink-4">{timeOnly(m.sent_at)}</span>
            {m.is_pinned && <Pin size={10} className="text-accent-600 dark:text-accent-400" />}
          </div>
        )}
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words shadow-2xs",
            mine
              ? "bg-brand-700 text-white rounded-tr-md"
              : "bg-surface-2 border border-edge-1 text-ink-1 rounded-tl-md",
            m.message_type !== "text" && "w-full"
          )}
          title={!showHeader ? timeOnly(m.sent_at) : undefined}
        >
          {m.content && <p className="whitespace-pre-wrap">{m.content}</p>}
          {m.message_type === "stock_share" && <StockShare stock={m.shared_stock} mine={mine} />}
          {m.message_type === "deal_proposal" && <DealProposalCard message={m} mine={mine} />}
          {m.message_type === "voice" && <VoiceNote message={m} mine={mine} />}
        </div>
      </div>
    </div>
  );
}
