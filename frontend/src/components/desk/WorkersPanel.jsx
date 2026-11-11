import { useCallback, useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { toast } from "@/components/ui/Toast";
import { officeAPI, workersAPI, apiError } from "@/lib/api";

const STATUS_TEXT = { assigned: "Waiting to start", in_progress: "In progress", done: "Done", cancelled: "Cancelled" };
const MANAGER_ROLES = ["owner", "editor"];

/**
 * Work assigned to me (for workers), and work I manage in offices where I am an owner or
 * editor. Every action is checked again by the backend against my current membership.
 */
export function AssignedToMe() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await workersAPI.mine();
      setItems(data.items);
    } catch (e) {
      setError(apiError(e, "Could not load your assigned work."));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (id, fn, done) => {
    setBusy(id);
    try {
      await fn(id);
      toast.success(done);
      await load();
    } catch (e) {
      toast.error(apiError(e, "Couldn't update that. Try again."));
    } finally {
      setBusy("");
    }
  };

  return (
    <section aria-labelledby="assigned-to-me" className="space-y-2">
      <h2 id="assigned-to-me" className="text-sm font-bold uppercase tracking-wide text-ink-2">Assigned to me</h2>
      {error && <Card role="alert" className="p-3 text-sm text-ink-2">{error}</Card>}
      {!error && items === null && <p className="text-sm text-ink-3">Loading…</p>}
      {items && items.length === 0 && <p className="text-sm text-ink-3">No work is assigned to you right now.</p>}
      {items && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((w) => (
            <li key={w.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink-1">{w.title}</p>
                  <p className="text-xs text-ink-2">{STATUS_TEXT[w.status] || w.status}{w.details ? ` · ${w.details}` : ""}</p>
                </div>
                <div className="flex gap-2">
                  {w.status === "assigned" && (
                    <Button size="sm" disabled={busy === w.id} onClick={() => act(w.id, workersAPI.start, "Started")}>Start</Button>
                  )}
                  {(w.status === "assigned" || w.status === "in_progress") && (
                    <Button size="sm" variant="ghost" disabled={busy === w.id}
                      onClick={() => act(w.id, workersAPI.complete, "Marked done")}>Mark done</Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Assign and manage work in one office I can manage. */
function ManageOffice({ office }) {
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [handle, setHandle] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [moving, setMoving] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await workersAPI.assignments(office.id);
      setItems(data.items);
    } catch (e) {
      toast.error(apiError(e, "Could not load this office's work."));
    }
  }, [office.id]);

  useEffect(() => { load(); }, [load]);

  const assign = async (e) => {
    e.preventDefault();
    const found = {};
    if (title.trim().length < 2) found.title = "Give the work a title of at least 2 characters.";
    if (handle.trim().length < 3) found.handle = "Enter the person's @handle.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      await workersAPI.assign(office.id, {
        title: title.trim(), details: details.trim() || null, assignee_handle: handle.trim().replace(/^@/, ""),
      });
      toast.success("Assigned.");
      setTitle(""); setDetails(""); setHandle("");
      await load();
    } catch (err) {
      toast.error(apiError(err, "Couldn't assign that. Check the handle is an active member."));
    } finally {
      setSaving(false);
    }
  };

  const reassign = async (id) => {
    if (!moving || moving.id !== id || !moving.handle.trim()) return;
    try {
      await workersAPI.reassign(id, moving.handle.trim().replace(/^@/, ""));
      toast.success("Moved to them.");
      setMoving(null);
      await load();
    } catch (err) {
      toast.error(apiError(err, "Couldn't move that work."));
    }
  };

  const cancel = async (id) => {
    try {
      await workersAPI.cancel(id);
      toast.success("Cancelled.");
      await load();
    } catch (err) {
      toast.error(apiError(err, "Couldn't cancel that."));
    }
  };

  return (
    <Card className="space-y-4 p-4">
      <h3 className="text-base font-bold text-ink-1">{office.name}</h3>
      <form onSubmit={assign} className="space-y-3" aria-label={`Assign work in ${office.name}`} noValidate>
        <Input label="Work" value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
        <Textarea label="Details (optional)" rows={2} value={details} onChange={(e) => setDetails(e.target.value)} />
        <Input label="Assign to (@handle)" value={handle} onChange={(e) => setHandle(e.target.value)} error={errors.handle}
          hint="Must already be an active member of this office." />
        <Button type="submit" disabled={saving}>Assign work</Button>
      </form>

      {items.length > 0 && (
        <ul className="space-y-2 border-t border-surface-3 pt-3">
          {items.map((w) => (
            <li key={w.id} className="space-y-2 text-sm">
              <p>
                <span className="font-semibold text-ink-1">{w.title}</span>
                <span className="text-ink-2"> · @{w.assignee_handle} · {STATUS_TEXT[w.status] || w.status}
                  {!w.assignee_active ? " · no longer a member" : ""}</span>
              </p>
              {(w.status === "assigned" || w.status === "in_progress") && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setMoving({ id: w.id, handle: "" })}>Move to someone else</Button>
                  <Button size="sm" variant="ghost" onClick={() => cancel(w.id)}>Cancel</Button>
                  {moving?.id === w.id && (
                    <>
                      <Input aria-label="New assignee handle" placeholder="@handle" value={moving.handle}
                        onChange={(e) => setMoving({ id: w.id, handle: e.target.value })} />
                      <Button size="sm" onClick={() => reassign(w.id)}>Move</Button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Lists the offices I can manage, one assignment form each. Hidden when I manage none. */
export function ManageWork() {
  const [offices, setOffices] = useState(null);

  useEffect(() => {
    let live = true;
    officeAPI.mine()
      .then(({ data }) => { if (live) setOffices((data.offices || []).filter((o) => MANAGER_ROLES.includes(o.my_role))); })
      .catch(() => { if (live) setOffices([]); });
    return () => { live = false; };
  }, []);

  if (!offices || offices.length === 0) return null;
  return (
    <section aria-labelledby="manage-work" className="space-y-3">
      <h2 id="manage-work" className="text-sm font-bold uppercase tracking-wide text-ink-2">Work I assign</h2>
      {offices.map((o) => <ManageOffice key={o.id} office={o} />)}
    </section>
  );
}
