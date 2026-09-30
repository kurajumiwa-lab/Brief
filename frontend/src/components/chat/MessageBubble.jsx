import { Link } from "react-router-dom";
import { Pin } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import StockShare from "./StockShare";
import DealProposalCard from "./DealProposalCard";
import VoiceNote from "./VoiceNote";
import { timeOnly } from "@/lib/formatters";
import { cn } from "@/lib/utils";

export default function MessageBubble({ message: m, mine, showHeader = true }) {
  if (m.message_type === "system") {
    const kind = m.deal_data?.kind;
    return (
      <div className="px-4 mt-3 flex justify-center" data-testid="system-message">
        <p className={cn("max-w-[85%] text-center text-2xs rounded-full border px-3 py-1", kind === "deal_accepted" ? "border-brand-800/60 bg-brand-950/40 text-brand-200" : kind === "deal_declined" ? "border-red-900/50 bg-red-950/30 text-red-200" : "border-edge-1 bg-surface-2 text-ink-3")} title={timeOnly(m.sent_at)}>
          {m.content}
        </p>
      </div>
    );
  }
  return (
    <div className={cn("flex gap-2.5 px-4", mine ? "flex-row-reverse" : "flex-row", showHeader ? "mt-3" : "mt-0.5")}>
      <div className="w-8 shrink-0">{showHeader && !mine && <Avatar name={m.sender_business || m.sender_handle} size="sm" />}</div>
      <div className={cn("max-w-[78%] min-w-0 flex flex-col", mine ? "items-end" : "items-start")}>
        {showHeader && (
          <div className={cn("flex items-baseline gap-2 mb-1 text-2xs", mine && "flex-row-reverse")}>
            <Link to={`/@${m.sender_handle}`} className="font-medium text-ink-2 hover:text-brand-300">
              {mine ? "You" : m.sender_business || `@${m.sender_handle}`}
            </Link>
            {!mine && <span className="font-mono text-ink-4">@{m.sender_handle}</span>}
            <span className="text-ink-4">{timeOnly(m.sent_at)}</span>
            {m.is_pinned && <Pin size={10} className="text-amber-400" />}
          </div>
        )}
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words",
            mine ? "bg-brand-700/90 text-white rounded-tr-md" : "bg-surface-3 text-ink-1 rounded-tl-md",
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
