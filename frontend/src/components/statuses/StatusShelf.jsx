import { useCallback, useEffect, useState } from "react";
import { Plus, UserPlus } from "lucide-react";
import { statusesAPI } from "@/lib/api";
import { errorText, initialOf, ringClass } from "@/components/statuses/statusCore";
import StatusViewer from "@/components/statuses/StatusViewer";
import StatusComposer from "@/components/statuses/StatusComposer";
import { useAuthStore } from "@/stores/authStore";

/**
 * STATUS SHELF: a row of businesses you follow, each with their live 24-hour
 * statuses. Coloured ring = something unseen, muted ring = already seen.
 * Your own status is the first tile.
 *
 * Empty state: when you follow nobody yet, the row offers businesses to follow.
 * It renders nothing when there is nothing to show and nothing to suggest.
 * It sits inside the Home header section, so Home keeps its four sections.
 */
export default function StatusShelf() {
  const vendor = useAuthStore((s) => s.vendor);
  const [groups, setGroups] = useState([]);
  const [mine, setMine] = useState([]);
  const [suggested, setSuggested] = useState([]);
  const [viewing, setViewing] = useState(null); // { group, own }
  const [composing, setComposing] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const [feedRes, mineRes, sugRes] = await Promise.allSettled([
      statusesAPI.feed(),
      statusesAPI.mine(),
      statusesAPI.suggestions(),
    ]);
    if (feedRes.status === "fulfilled") setGroups(feedRes.value.data.groups || []);
    if (mineRes.status === "fulfilled") setMine(mineRes.value.data.statuses || []);
    if (sugRes.status === "fulfilled") setSuggested(sugRes.value.data.businesses || []);
  }, []);

  useEffect(() => {
    if (!vendor) return;
    refresh().catch(() => {});
  }, [vendor, refresh]);

  if (!vendor) return null;

  const ownGroup = mine.length
    ? {
        vendor: { id: vendor.id, handle: vendor.vendor_handle, business_name: vendor.business_name },
        statuses: mine,
        unseen: false,
      }
    : null;

  const showSuggestions = groups.length === 0 && suggested.length > 0;
  if (!ownGroup && groups.length === 0 && !showSuggestions && !composing) return null;

  const follow = async (business) => {
    try {
      await statusesAPI.follow(business.vendor_id);
      setSuggested((list) => list.filter((b) => b.vendor_id !== business.vendor_id));
      setNotice(`Following ${business.business_name}`);
      refresh().catch(() => {});
    } catch (err) {
      setNotice(errorText(err, "Could not follow that business. Please try again."));
    }
  };

  const unfollow = async (group) => {
    try {
      await statusesAPI.unfollow(group.vendor.id);
      setViewing(null);
      setNotice(`Unfollowed ${group.vendor.business_name}`);
      refresh().catch(() => {});
    } catch (err) {
      setNotice(errorText(err, "Could not unfollow. Please try again."));
    }
  };

  return (
    <section aria-label="Status shelf" className="space-y-2">
      <div className="flex gap-3 overflow-x-auto pb-1" role="list">
        <div role="listitem" className="shrink-0">
          <button
            type="button"
            onClick={() => setComposing(true)}
            aria-label="Add your status"
            className="flex w-16 flex-col items-center gap-1"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-edge-2 bg-surface-0 text-brand-700 dark:text-brand-400">
              <Plus size={18} aria-hidden="true" />
            </span>
            <span className="w-full truncate text-center text-micro font-semibold text-ink-2">Your status</span>
          </button>
        </div>

        {ownGroup && (
          <div role="listitem" className="shrink-0">
            <button
              type="button"
              onClick={() => setViewing({ group: ownGroup, own: true })}
              aria-label="View your statuses"
              className="flex w-16 flex-col items-center gap-1"
            >
              <span className={`flex h-14 w-14 items-center justify-center rounded-full bg-surface-0 text-sm font-bold text-ink-1 ${ringClass({ unseen: false })}`}>
                {initialOf(vendor.business_name)}
              </span>
              <span className="w-full truncate text-center text-micro font-semibold text-ink-2">Yours</span>
            </button>
          </div>
        )}

        {groups.map((g) => (
          <div role="listitem" key={g.vendor.id} className="shrink-0">
            <button
              type="button"
              onClick={() => setViewing({ group: g, own: false })}
              aria-label={`${g.vendor.business_name}, ${g.unseen ? "new" : "seen"} statuses`}
              className="flex w-16 flex-col items-center gap-1"
            >
              <span className={`flex h-14 w-14 items-center justify-center rounded-full bg-surface-0 text-sm font-bold text-ink-1 ${ringClass(g)}`}>
                {initialOf(g.vendor.business_name)}
              </span>
              <span className="w-full truncate text-center text-micro font-semibold text-ink-2">{g.vendor.business_name}</span>
            </button>
          </div>
        ))}
      </div>

      {showSuggestions && (
        <div className="space-y-2 rounded-2xl border border-edge-1 bg-surface-0 p-3">
          <p className="text-xs font-semibold text-ink-1">Follow a business to see its updates here</p>
          <ul className="space-y-2">
            {suggested.map((b) => (
              <li key={b.vendor_id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-xs text-ink-2">
                  <span className="font-semibold text-ink-1">{b.business_name}</span>
                  {b.live_statuses > 0 && <span className="ml-1 text-micro text-ink-3">· {b.live_statuses} live</span>}
                </span>
                <button
                  type="button"
                  onClick={() => follow(b)}
                  aria-label={`Follow ${b.business_name}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-brand-500 px-3 py-1 text-micro font-bold text-brand-700 hover:bg-brand-50 dark:text-brand-400"
                >
                  <UserPlus size={12} aria-hidden="true" /> Follow
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {notice && <p role="status" className="text-micro text-ink-3">{notice}</p>}

      {viewing && (
        <StatusViewer
          group={viewing.group}
          own={viewing.own}
          onClose={() => { setViewing(null); refresh().catch(() => {}); }}
          onUnfollow={() => unfollow(viewing.group)}
          onDeleted={() => { setViewing(null); refresh().catch(() => {}); }}
        />
      )}

      {composing && (
        <StatusComposer
          onClose={() => setComposing(false)}
          onPosted={() => {
            setComposing(false);
            setNotice("Posted. It stays for 24 hours.");
            refresh().catch(() => {});
          }}
        />
      )}
    </section>
  );
}
