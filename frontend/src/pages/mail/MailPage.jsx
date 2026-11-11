import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Hash, HeartHandshake, ListChecks, MessageCircle, Search, Users } from "lucide-react";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import { apiError, chatAPI } from "@/lib/api";

/**
 * MAIL — every conversation I have joined, in one list.
 *
 * This is a view over the existing chat rooms, not a second messaging system: each row
 * opens the same thread at /chat?room=<id>. Rooms are grouped by what they are. The bell
 * (Connect) is still where notifications go; nothing here is a notification.
 */
export const TYPE_META = {
  direct: { label: "Direct", icon: MessageCircle, order: 0 },
  deal: { label: "Deals", icon: HeartHandshake, order: 1 },
  group: { label: "Groups", icon: Users, order: 2 },
  vendor_list: { label: "Business lists", icon: ListChecks, order: 3 },
  niche: { label: "Topics", icon: Hash, order: 4 },
};

/** Pure: filter by name, topic or tag, then group by room type in display order. */
export function groupConversations(rooms = [], query = "") {
  const needle = query.trim().toLowerCase();
  const filtered = rooms.filter((r) => r.joined !== false).filter((r) => !needle
    || `${r.name} ${r.topic || ""} ${(r.topic_tags || []).join(" ")}`.toLowerCase().includes(needle));
  const by = {};
  for (const r of filtered) (by[r.room_type] ||= []).push(r);
  return Object.entries(by).sort(([a], [b]) => (TYPE_META[a]?.order ?? 9) - (TYPE_META[b]?.order ?? 9));
}

export default function MailPage() {
  const [rooms, setRooms] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await chatAPI.rooms({ mine_only: true });
      setRooms(Array.isArray(data) ? data : data?.rooms || []);
    } catch (e) {
      setError(apiError(e, "Could not load your conversations."));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const sections = useMemo(() => groupConversations(rooms || [], q), [rooms, q]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <header>
        <h1 className="text-xl font-bold text-ink-1">Mail</h1>
        <p className="text-sm text-ink-3">Your conversations. Notifications are in the bell.</p>
      </header>

      {rooms !== null && rooms.length > 0 && (
        <Input
          label="Search conversations"
          placeholder="Name or topic"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          icon={Search}
        />
      )}

      {error && (
        <Card role="alert" className="space-y-2 p-4">
          <p className="text-sm text-ink-2">{error}</p>
          <button type="button" className="text-sm font-semibold text-brand-600" onClick={load}>Try again</button>
        </Card>
      )}

      {!error && rooms === null && <p className="text-sm text-ink-3">Loading…</p>}

      {rooms !== null && rooms.length === 0 && (
        <EmptyState
          title="No conversations yet"
          description="Start one from a business or a deal. Your conversations will be listed here."
        />
      )}

      {rooms !== null && rooms.length > 0 && sections.length === 0 && (
        <p className="text-sm text-ink-3">No conversations match “{q}”.</p>
      )}

      {sections.map(([type, list]) => {
        const meta = TYPE_META[type] || { label: type, icon: MessageCircle };
        const Icon = meta.icon;
        return (
          <section key={type} aria-labelledby={`mail-${type}`} className="space-y-2">
            <h2 id={`mail-${type}`} className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink-2">
              <Icon size={14} aria-hidden="true" /> {meta.label} ({list.length})
            </h2>
            <ul className="space-y-2">
              {list.map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/chat?room=${encodeURIComponent(r.id)}`}
                    className="block rounded-xl border border-edge-1 bg-surface-1 p-3 hover:bg-surface-2"
                  >
                    <p className="truncate font-semibold text-ink-1">{r.name}</p>
                    {r.topic && <p className="truncate text-xs text-ink-3">{r.topic}</p>}
                    {(r.participants || []).length > 0 && (
                      <p className="truncate text-xs text-ink-3">
                        With {r.participants.map((p) => p.business_name || `@${p.vendor_handle}`).join(", ")}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
