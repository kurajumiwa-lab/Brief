import { useMemo, useState } from "react";
import { Hash, MessageCircle, HeartHandshake, Users, ListChecks, Plus, Search } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { cn } from "@/lib/utils";

const TYPE_META = {
  direct: { label: "Direct", icon: MessageCircle, order: 0 },
  deal: { label: "Deals", icon: HeartHandshake, order: 1 },
  group: { label: "Groups", icon: Users, order: 2 },
  vendor_list: { label: "Vendor lists", icon: ListChecks, order: 3 },
  niche: { label: "Topics", icon: Hash, order: 4 },
};

export default function RoomList({ rooms = [], activeId, onSelect, onNewTopic, className }) {
  const [q, setQ] = useState("");

  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle ? rooms.filter((r) => `${r.name} ${r.topic || ""} ${(r.topic_tags || []).join(" ")}`.toLowerCase().includes(needle)) : rooms;
    const by = {};
    for (const r of filtered) (by[r.room_type] ||= []).push(r);
    return Object.entries(by).sort(([a], [b]) => (TYPE_META[a]?.order ?? 9) - (TYPE_META[b]?.order ?? 9));
  }, [rooms, q]);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="p-3 border-b border-edge-1 space-y-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a room" className="w-full h-8 pl-8 pr-2 rounded-lg bg-surface-1 border border-edge-1 text-xs text-ink-1 placeholder:text-ink-4 focus:outline-none focus:border-brand-500" />
        </div>
        <Button size="sm" variant="outline" icon={Plus} fullWidth onClick={onNewTopic}>
          New topic
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {sections.length === 0 && <p className="text-xs text-ink-4 text-center py-8">No rooms yet. Start a topic or message a vendor.</p>}
        {sections.map(([type, list]) => {
          const meta = TYPE_META[type] || { label: type, icon: Hash };
          const Icon = meta.icon;
          return (
            <div key={type} className="mb-2">
              <div className="px-3 py-1 text-2xs uppercase tracking-wider text-ink-4 flex items-center gap-1.5">
                <Icon size={11} /> {meta.label} <span className="font-mono">{list.length}</span>
              </div>
              {list.map((r) => {
                const active = r.id === activeId;
                return (
                  <button
                    key={r.id}
                    onClick={() => onSelect(r)}
                    className={cn(
                      "w-full text-left px-3 py-2 flex items-start gap-2.5 rounded-xl transition-colors",
                      active ? "bg-brand-50 dark:bg-brand-500/15 ring-1 ring-brand-500/25" : "hover:bg-surface-2"
                    )}
                  >
                    <div className={cn("mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0", active ? "bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400" : "bg-surface-3 text-ink-4")}>
                      <Icon size={13} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("text-xs font-medium truncate", active ? "text-ink-1" : "text-ink-2")}>{r.name}</span>
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
