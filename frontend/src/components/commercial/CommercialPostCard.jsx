import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Bookmark, Share2, Users, PiggyBank, MapPin, Tag, Clock,
  ShoppingCart, TrendingDown, Store, BadgeCheck, Heart, MessageSquare,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import { currency, relativeTime, num } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import PriceComparison, { SavingsBadge } from "./PriceComparison";
import GroupBuyProgress from "./GroupBuyProgress";

const TYPE_META = {
  regular: { label: "Post", color: "gray", icon: MessageSquare },
  commercial: { label: "Offer", color: "brand", icon: Store },
  group_buy: { label: "Group buy", color: "blue", icon: Users },
  deal: { label: "Deal", color: "amber", icon: ShoppingCart },
  savings: { label: "Savings", color: "emerald", icon: PiggyBank },
};

export default function CommercialPostCard({ post, onSave, onShare, onJoin, onView, compact = false, showActions = true }) {
  const [expanded, setExpanded] = useState(false);
  const meta = TYPE_META[post.post_type] || TYPE_META.regular;
  const Icon = meta.icon;

  const isGroupBuy = post.post_type === "group_buy";
  const hasPricing = post.individual_price != null || post.group_price != null;
  const hasSavings = post.savings_amount > 0 || post.savings_percentage > 0;

  if (compact) {
    return (
      <article className="glass rounded-2xl p-3 space-y-2.5 hover:border-brand-500/30 transition-colors">
        <div className="flex items-start gap-2.5">
          <div className="h-8 w-8 rounded-full bg-brand-500/15 grid place-items-center text-brand-700 dark:text-brand-300 shrink-0">
            <Store size={14} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-ink-1 truncate">@{post.vendor_handle || "vendor"}</span>
              <span className="text-2xs text-ink-4">· {relativeTime(post.created_at)}</span>
              {hasSavings && <SavingsBadge amount={post.savings_amount} pct={post.savings_percentage} />}
            </div>
            <p className="text-xs text-ink-2 line-clamp-2 mt-1">{post.title || post.content}</p>
            {hasPricing && (
              <div className="mt-2">
                <PriceComparison individual={post.individual_price} group={post.group_price} savings={post.savings_amount} savingsPct={post.savings_percentage} compact />
              </div>
            )}
          </div>
        </div>
        {isGroupBuy && (
          <div className="flex items-center gap-2 text-2xs text-ink-4">
            <Users size={12} /> {post.current_interested} interested · {post.current_quantity_pledged}/{post.target_quantity || post.min_group_size || "?"} units
          </div>
        )}
      </article>
    );
  }

  return (
    <article className="glass rounded-2xl overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="p-3.5 pb-3 flex items-start gap-3">
        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-brand-500/20 to-accent-500/20 grid place-items-center text-brand-700 dark:text-brand-300 shrink-0 border border-edge-1">
          <Store size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-ink-1">{post.vendor_business || "A vendor"}</span>
            <span className="text-xs text-ink-4">@{post.vendor_handle || "vendor"}</span>
            {post.is_commercial && <Badge variant="brand" size="xs"><Icon size={10} /> {meta.label}</Badge>}
            {hasSavings && <Badge variant="emerald" size="xs"><TrendingDown size={10} /> {post.savings_percentage}% off</Badge>}
          </div>
          <div className="flex items-center gap-2 mt-1 text-2xs text-ink-4">
            <span className="inline-flex items-center gap-1"><Clock size={10} /> {relativeTime(post.created_at)}</span>
            {post.location && <span className="inline-flex items-center gap-1"><MapPin size={10} /> {post.location}</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onSave?.(post)}
          className={cn("p-2 rounded-xl transition-colors", post.is_saved ? "bg-brand-500/15 text-brand-600" : "hover:bg-surface-2 text-ink-4")}
          title={post.is_saved ? "Saved" : "Save"}
        >
          <Bookmark size={16} className={post.is_saved ? "fill-current" : ""} />
        </button>
      </div>

      {/* Content */}
      <div className="px-3.5 pb-3">
        {post.title && <h3 className="text-sm font-bold text-ink-1 mb-1.5">{post.title}</h3>}
        <p className="text-sm text-ink-2 leading-relaxed whitespace-pre-wrap break-words">
          {expanded || post.content.length < 220 ? post.content : `${post.content.slice(0, 220)}…`}
          {post.content.length > 220 && (
            <button type="button" onClick={() => setExpanded(!expanded)} className="ml-1 text-xs font-semibold text-brand-600 dark:text-brand-400">
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </p>

        {post.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2.5">
            {post.tags.slice(0, 4).map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1 text-2xs text-ink-4">
                <Tag size={10} /> {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Commercial shelf — pricing */}
      {hasPricing && (
        <div className="px-3.5 pb-3">
          <PriceComparison
            individual={post.individual_price}
            group={post.group_price}
            savings={post.savings_amount}
            savingsPct={post.savings_percentage}
          />
        </div>
      )}

      {/* Group-buying layer */}
      {isGroupBuy && (
        <div className="px-3.5 pb-3">
          <div className="rounded-2xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200/50 dark:border-blue-500/20 p-3">
            <GroupBuyProgress
              current={post.current_quantity_pledged}
              target={post.target_quantity}
              minSize={post.min_group_size}
              interested={post.current_interested}
            />
          </div>
        </div>
      )}

      {/* Images */}
      {post.images?.length > 0 && (
        <div className="px-3.5 pb-3">
          <div className="grid grid-cols-2 gap-2">
            {post.images.slice(0, 4).map((img, i) => (
              <img key={i} src={img} alt="" className="rounded-xl w-full h-24 object-cover bg-surface-2" loading="lazy" />
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      {showActions && (
        <div className="px-3.5 py-2.5 border-t border-edge-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <span className="text-2xs text-ink-4 inline-flex items-center gap-1">
              <Users size={12} /> {num(post.current_interested || post.interest_count || 0)} interested
            </span>
            <span className="text-2xs text-ink-4">·</span>
            <span className="text-2xs text-ink-4">{num(post.view_count || 0)} views</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onShare?.(post)}
              className="h-8 px-3 rounded-xl bg-surface-2 text-ink-2 hover:text-ink-1 text-xs font-medium inline-flex items-center gap-1.5"
            >
              <Share2 size={14} /> Share
            </button>
            {isGroupBuy || hasPricing ? (
              <button
                type="button"
                onClick={() => onJoin?.(post)}
                className={cn(
                  "h-8 px-4 rounded-xl text-xs font-bold inline-flex items-center gap-1.5",
                  post.is_interested
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-brand-600 text-white hover:bg-brand-700"
                )}
              >
                {post.is_interested ? (
                  <>
                    <BadgeCheck size={14} /> Joined
                  </>
                ) : (
                  <>
                    <Users size={14} /> {isGroupBuy ? "Join group" : "Express interest"}
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onView?.(post)}
                className="h-8 px-3 rounded-xl bg-brand-600 text-white text-xs font-bold"
              >
                View
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
