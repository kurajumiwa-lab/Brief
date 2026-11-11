import { useCallback, useEffect, useState } from "react";
import { Users } from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { toast } from "@/components/ui/Toast";
import { apiError, socialAPI } from "@/lib/api";

/**
 * CIRCLES — the groups I can follow, on the existing social circle endpoints.
 * Following is the same record the backend already keeps (social_circle_follows).
 * Private circles only appear to people who already follow them, so this list is safe to show.
 */
export default function CirclesPanel() {
  const [circles, setCircles] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await socialAPI.circles();
      setCircles(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(apiError(e, "Could not load circles."));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Optimistic toggle: flip now, roll back if the server refuses.
  const toggle = async (circle) => {
    const next = !circle.following;
    setBusy(circle.id);
    setCircles((prev) => prev.map((c) => (c.id === circle.id ? { ...c, following: next } : c)));
    try {
      if (next) await socialAPI.followCircle(circle.id);
      else await socialAPI.unfollowCircle(circle.id);
    } catch (e) {
      setCircles((prev) => prev.map((c) => (c.id === circle.id ? { ...c, following: circle.following } : c)));
      toast.error(apiError(e, "Could not update that circle."));
    } finally {
      setBusy("");
    }
  };

  return (
    <section aria-labelledby="circles-heading" className="rounded-card-lg border border-edge-1 bg-surface-1 p-5 space-y-3">
      <h2 id="circles-heading" className="text-lg font-bold text-ink-1 flex items-center gap-2">
        <Users size={18} className="text-brand-600" aria-hidden="true" /> Circles
      </h2>
      {error && <p role="alert" className="text-sm text-ink-2">{error}</p>}
      {!error && circles === null && <p className="text-sm text-ink-3">Loading…</p>}
      {circles && circles.length === 0 && <p className="text-sm text-ink-3">No circles to follow yet.</p>}
      {circles && circles.length > 0 && (
        <ul className="space-y-2">
          {circles.map((c) => (
            <li key={c.id}>
              <Card className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink-1">{c.name}</p>
                  <p className="truncate text-xs text-ink-3">
                    {[c.region, c.is_public ? "Open" : "Private", `${c.post_count ?? 0} posts`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={c.following ? "secondary" : "primary"}
                  disabled={busy === c.id}
                  aria-pressed={c.following}
                  onClick={() => toggle(c)}
                >
                  {c.following ? "Following" : "Follow"}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
