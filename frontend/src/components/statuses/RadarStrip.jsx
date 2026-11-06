import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { statusesAPI } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

/**
 * RADAR: the quick glance under the status shelf. It counts what is new:
 * statuses from businesses you follow, new followers, and trades that need you.
 *
 * Hidden when everything is zero. It never marks anything as seen. Activity
 * stays below it, unchanged.
 */
export default function RadarStrip() {
  const vendor = useAuthStore((s) => s.vendor);
  const [radar, setRadar] = useState(null);

  useEffect(() => {
    if (!vendor) return;
    let live = true;
    statusesAPI.radar()
      .then(({ data }) => { if (live) setRadar(data); })
      .catch(() => { if (live) setRadar(null); });
    return () => { live = false; };
  }, [vendor]);

  if (!vendor || !radar) return null;

  const chips = [];
  if (radar.unseen_statuses > 0) {
    chips.push({
      key: "statuses",
      text: `${radar.unseen_statuses} new ${radar.unseen_statuses === 1 ? "update" : "updates"} from ${radar.unseen_businesses} ${radar.unseen_businesses === 1 ? "business" : "businesses"}`,
    });
  }
  if (radar.unread_trade > 0) {
    chips.push({
      key: "trade",
      text: `${radar.unread_trade} ${radar.unread_trade === 1 ? "trade needs" : "trades need"} you`,
      to: "/orders?needs=me",
    });
  }
  if (radar.unread_follows > 0) {
    chips.push({
      key: "follows",
      text: `${radar.unread_follows} new ${radar.unread_follows === 1 ? "follower" : "followers"}`,
      to: "/activity",
    });
  }
  if (chips.length === 0) return null;

  return (
    <nav aria-label="Radar" className="flex flex-wrap gap-2">
      {chips.map((c) => (
        c.to ? (
          <Link key={c.key} to={c.to}
            className="rounded-full border border-brand-500/40 bg-brand-50 px-3 py-1 text-micro font-bold text-brand-700 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-400">
            {c.text}
          </Link>
        ) : (
          <span key={c.key} className="rounded-full border border-edge-1 bg-surface-0 px-3 py-1 text-micro font-bold text-ink-2">
            {c.text}
          </span>
        )
      ))}
    </nav>
  );
}
