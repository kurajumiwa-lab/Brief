import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { routineAPI, apiError } from "@/lib/api";

/**
 * TODAY — the daily checks you chose. A dot means something is waiting and you
 * have not marked it done today. Every check says why it is there, and you can
 * switch any of them off.
 */
export default function TodayPage() {
  const [today, setToday] = useState(null);
  const [catalogue, setCatalogue] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([routineAPI.today(), routineAPI.catalogue()]);
      setToday(t.data);
      setCatalogue(c.data.checks);
    } catch (err) {
      toast.error(apiError(err, "Could not load Today"));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleDone = async (item) => {
    setBusy(true);
    try {
      if (item.done) await routineAPI.undo(item.key);
      else await routineAPI.done(item.key);
      await load();
    } catch (err) {
      toast.error(apiError(err, "Could not update that"));
    } finally {
      setBusy(false);
    }
  };

  const setCheck = async (key, enabled) => {
    setBusy(true);
    try {
      const { data } = await routineAPI.setChecks({ [key]: enabled });
      setCatalogue(data.checks);
      await load();
    } catch (err) {
      toast.error(apiError(err, "Could not change that"));
    } finally {
      setBusy(false);
    }
  };

  if (!today || !catalogue) return <PageSpinner />;

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 pb-16">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-ink-1">Today</h1>
          <p className="text-sm text-ink-3">{new Date(`${today.date}T00:00:00`).toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        {today.dots > 0 && <Badge variant="amber">{today.dots} waiting</Badge>}
      </header>

      {today.items.length === 0 && (
        <Card><p className="text-sm text-ink-3">Nothing switched on. Choose your daily checks below.</p></Card>
      )}

      <ul className="space-y-2">
        {today.items.map((item) => (
          <li key={item.key}>
            <Card padding="p-3" className="space-y-2">
              <div className="flex items-center gap-3">
                <span aria-label={item.dot ? "Waiting" : "Clear"} className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${item.dot ? "bg-accent-500" : "bg-edge-3"}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${item.done ? "text-ink-3 line-through" : "text-ink-1"}`}>{item.label}</p>
                  <p className="text-xs text-ink-3">
                    {item.kind === "check" ? (item.count > 0 ? `${item.count} waiting` : "All clear") : "Next step of a free blueprint"}
                  </p>
                </div>
                <Button size="sm" variant={item.done ? "outline" : "primary"} disabled={busy}
                  onClick={() => toggleDone(item)}>
                  {item.done ? "Undo" : "Done"}
                </Button>
              </div>
              <div className="flex gap-3 text-xs">
                <button type="button" className="text-brand-700 underline" onClick={() => setOpen(open === item.key ? null : item.key)}>
                  Why is this here?
                </button>
                <Link to={item.link} className="text-brand-700 underline">Open</Link>
              </div>
              {open === item.key && <p className="rounded-lg bg-surface-2 p-2 text-xs text-ink-2">{item.why}</p>}
            </Card>
          </li>
        ))}
      </ul>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink-1">Your daily checks</h2>
        <p className="text-xs text-ink-3">Switch on only what you want to see. Off means it never shows and never makes a dot.</p>
        {catalogue.map((c) => (
          <Card key={c.key} padding="p-3" className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-1">{c.label}</p>
              <p className="text-xs text-ink-3">{c.why}</p>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-xs text-ink-2">
              <input type="checkbox" checked={c.enabled} disabled={busy}
                onChange={(e) => setCheck(c.key, e.target.checked)} aria-label={`Show ${c.label} in Today`} />
              {c.enabled ? "On" : "Off"}
            </label>
          </Card>
        ))}
      </section>
    </div>
  );
}
