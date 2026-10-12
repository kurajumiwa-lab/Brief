import { useMemo, useState } from "react";
import { Hash, MessageCircle, HeartHandshake, Users, ListChecks, Plus, Search, UserCheck } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { resolveIdentityDisplay } from "./ChatIdentityModal";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { cn } from "@/lib/utils";

const TYPE_META = {
  direct: { label: "Direct", icon: MessageCircle, order: 0 },
  deal: { label: "Deals", icon: HeartHandshake, order: 1 },
  group: { label: "Groups", icon: Users, order: 2 },
  vendor_list: { label: "Vendor lists", icon: ListChecks, order: 3 },
  niche: { label: "Topics", icon: Hash, order: 4 },
};

export default function RoomList({ rooms = [], activeId, onSelect, onNewTopic, onOpenIdentity, className }) {
  const [q, setQ] = useState("");
  const vendor = useAuthStore((s) => s.vendor);
  const chatIdentity = useChatStore((s) => s.chatIdentity);

  const myListIdentity = resolveIdentityDisplay({
    vendor,
    chatIdentity,
    location: "conversation_list",
  });

  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? rooms.filter((r) => `${r.name} ${r.topic || ""} ${(r.topic_tags || []).join(" ")}`.toLowerCase().includes(needle))
      : rooms;
    const by = {};
    for (const r of filtered) (by[r.room_type] ||= []).push(r);
    return Object.entries(by).sort(([a], [b]) => (TYPE_META[a]?.order ?? 9) - (TYPE_META[b]?.order ?? 9));
  }, [rooms, q]);

  return (
    <div className={cn("flex flex-col h-full bg-surface-0", className)}>
      {/* Current Vendor Chat Identity Strip */}
      <div className="p-3 border-b border-edge-1 bg-surface-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar
            name={myListIdentity.businessName}
            personalName={myListIdentity.personalName}
            businessName={myListIdentity.businessName}
            src={myListIdentity.avatarUrl || undefined}
            logoSrc={myListIdentity.logoUrl || undefined}
            mode={myListIdentity.mode}
            size="sm"
          />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-ink-1 truncate">{myListIdentity.primaryTitle}</p>
            <p className="text-micro text-ink-4 truncate">{myListIdentity.secondarySubtitle}</p>
          </div>
        </div>
        {onOpenIdentity && (
          <Button
            size="xs"
            variant="secondary"
            icon={UserCheck}
            onClick={onOpenIdentity}
            aria-label="Chat identity"
            title="Configure how your personal photo and business logo appear in chat"
          >
            Identity
          </Button>
        )}
      </div>

      <div className="p-3 border-b border-edge-1 space-y-2 bg-surface-0">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a room"
            aria-label="Find a room"
            className="w-full h-8 pl-8 pr-2 rounded-lg bg-surface-1 border border-edge-1 text-xs text-ink-1 placeholder:text-ink-4 focus:outline-none focus:border-brand-500"
          />
        </div>
        <Button size="sm" variant="outline" icon={Plus} fullWidth onClick={onNewTopic}>
          New topic
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-2 bg-surface-0">
        {sections.length === 0 && (
          <div className="px-3 py-4">
            <EmptyState
              compact
              illustration={q.trim() ? "search" : "messages"}
              title={q.trim() ? `No rooms match "${q}"` : "No rooms yet"}
              description={
                q.trim()
                  ? "Clear the search filter to see all conversations and open topics."
                  : "Start a topic or message a vendor from their shop front."
              }
              action={
                q.trim() ? (
                  <Button size="xs" variant="secondary" onClick={() => setQ("")}>
                    Clear filter
                  </Button>
                ) : (
                  <Button size="xs" variant="secondary" icon={Plus} onClick={onNewTopic}>
                    Start a topic
                  </Button>
                )
              }
            />
          </div>
        )}
        {sections.map(([type, list]) => {
          const meta = TYPE_META[type] || { label: type, icon: Hash };
          const Icon = meta.icon;
          return (
            <div key={type} className="mb-2 px-1.5">
              <div className="px-2 py-1 text-2xs uppercase tracking-wider text-ink-4 flex items-center gap-1.5 font-semibold">
                <Icon size={11} /> {meta.label} <span className="font-mono">{list.length}</span>
              </div>
              {list.map((r) => {
                const active = r.id === activeId;
                const otherParticipant =
                  (r.participants || []).find((p) => p.id !== vendor?.id) || r.participants?.[0];
                const showParticipantAvatar =
                  (type === "direct" || type === "deal") &&
                  chatIdentity?.locations?.conversation_list !== false &&
                  otherParticipant;

                return (
                  <button
                    key={r.id}
                    onClick={() => onSelect(r)}
                    className={cn(
                      "w-full text-left px-2.5 py-2 flex items-start gap-2.5 rounded-xl transition-colors",
                      active ? "bg-brand-50 dark:bg-surface-2 ring-1 ring-brand-500/25" : "hover:bg-surface-1"
                    )}
                  >
                    {showParticipantAvatar ? (
                      <Avatar
                        name={otherParticipant.business_name || otherParticipant.vendor_handle || r.name}
                        personalName={otherParticipant.sender_name || otherParticipant.vendor_handle}
                        businessName={otherParticipant.business_name || r.name}
                        src={otherParticipant.avatar_url || undefined}
                        logoSrc={otherParticipant.logo_url || undefined}
                        mode={chatIdentity?.mode || "combined"}
                        size="sm"
                        className="mt-0.5"
                      />
                    ) : (
                      <div
                        className={cn(
                          "mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                          active
                            ? "bg-brand-600 text-white"
                            : "bg-surface-2 text-ink-4"
                        )}
                      >
                        <Icon size={13} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("text-xs font-medium truncate", active ? "text-ink-1 font-semibold" : "text-ink-2")}>
                          {r.name}
                        </span>
                        {!r.joined && type === "niche" && (
                          <Badge variant="outline" size="xs">
                            open
                          </Badge>
                        )}
                      </div>
                      <div className="text-2xs text-ink-4 truncate">
                        {r.topic || `${r.participant_count} vendor${r.participant_count === 1 ? "" : "s"}`} · {r.message_count} msg
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
