import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { useAuthStore } from "@/stores/authStore";
import { blueprintsAPI, apiError } from "@/lib/api";

export default function BlueprintDetailPage() {
  const { key } = useParams();
  const signedIn = useAuthStore((s) => !!s.vendor);
  const [bp, setBp] = useState(null);
  const [mine, setMine] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await blueprintsAPI.one(key);
      setBp(data);
      setError(null);
      if (signedIn) {
        const progress = await blueprintsAPI.mine();
        setMine(progress.data.started.find((s) => s.key === key) || null);
      }
    } catch (err) {
      setError(apiError(err, "This template is not available"));
    }
  }, [key, signedIn]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn, ok) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      await load();
    } catch (err) {
      toast.error(apiError(err, "That did not work"));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p role="alert" className="p-6 text-sm text-red-600">{error}</p>;
  if (!bp) return <PageSpinner />;

  const doneSet = new Set((mine?.steps || []).filter((s) => s.done).map((s) => s.key));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      <Link to="/templates" className="text-sm font-medium text-brand-700 underline">← All templates</Link>
      <Card className="space-y-2">
        <div className="flex gap-2"><Badge variant="brand">{bp.cost}</Badge><Badge variant="gray">{bp.steps.length} steps</Badge></div>
        <h1 className="text-lg font-semibold text-ink-1">{bp.title}</h1>
        <p className="text-sm text-ink-2">{bp.summary}</p>
        {signedIn && !mine && (
          <Button loading={busy} onClick={() => run(() => blueprintsAPI.start(key), "Started. The first step is in Today.")}>
            Start this template (free)
          </Button>
        )}
        {!signedIn && <p className="text-sm text-ink-3"><Link to="/auth" className="font-medium text-brand-700 underline">Sign in</Link> to start and track it.</p>}
        {mine && <p className="text-xs text-ink-3">{mine.done_count} of {mine.total} steps done</p>}
      </Card>

      <ol className="space-y-2">
        {bp.steps.map((s, i) => {
          const done = doneSet.has(s.key);
          return (
            <li key={s.key}>
              <Card padding="p-3" className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink-2">{i + 1}</span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className={`text-sm font-medium ${done ? "text-ink-3 line-through" : "text-ink-1"}`}>{s.title}</p>
                  <p className="text-xs text-ink-2">{s.detail}</p>
                </div>
                {mine && (
                  <Button size="sm" variant={done ? "outline" : "primary"} disabled={busy}
                    onClick={() => run(() => (done ? blueprintsAPI.untick(key, s.key) : blueprintsAPI.tick(key, s.key)))}>
                    {done ? "Undo" : "Done"}
                  </Button>
                )}
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
