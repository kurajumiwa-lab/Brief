import { useCallback, useEffect, useState } from "react";
import { Pin, Timer } from "lucide-react";
import Button from "@/components/ui/Button";
import { teamsAPI, apiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const ACTIVE_OR_PENDING = ["invited", "active"];

// The whiteboard (0082). A sticky note is the thing you write and rub out; a
// notice is the thing you keep. Same board, different weight — colour is the
// only cue, so the words still carry the meaning for anyone who cannot see it.
const STICKY_SKIN = {
  amber: "bg-accent-50 border-accent-200 dark:bg-accent-500/10 dark:border-accent-500/30",
  lime: "bg-tech-50 border-tech-200 dark:bg-tech-500/10 dark:border-tech-500/30",
  sky: "bg-blue-50 border-blue-200 dark:bg-blue-500/10 dark:border-blue-500/30",
  rose: "bg-red-50 border-red-200 dark:bg-red-500/10 dark:border-red-500/30",
  plain: "bg-surface-2 border-edge-2",
};

/**
 * Partner teams: one office invites another by its office ID. The other office's owner accepts
 * or declines. Either owner may end an active link. The server checks every action.
 */
export function PartnerPanel({ detail, onRun }) {
  const [links, setLinks] = useState(null);
  const [partnerId, setPartnerId] = useState("");
  const [err, setErr] = useState(null);
  const isOwner = detail.my_role === "owner";

  const load = useCallback(async () => {
    try {
      const { data } = await teamsAPI.listPartners(detail.id);
      setLinks(data.partners.filter((p) => ACTIVE_OR_PENDING.includes(p.status)));
      setErr(null);
    } catch (e) {
      setErr(apiError(e, "Partner teams could not be loaded."));
    }
  }, [detail.id]);

  useEffect(() => { load(); }, [load]);

  async function invite(e) {
    e.preventDefault();
    if (!partnerId.trim()) return;
    await onRun(() => teamsAPI.invitePartner(detail.id, partnerId.trim()), () => "Partner invite sent.");
    setPartnerId("");
    await load();
  }

  async function act(fn, done) {
    await onRun(fn, done);
    await load();
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-ink-1">Partner teams</h3>
      <p className="text-xs text-ink-3">
        Partner teams work together. Members of partnered offices cannot rate each other on a trade.
      </p>
      {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      {links === null ? null : links.length === 0 ? (
        <p className="text-sm text-ink-3">No partner teams yet.</p>
      ) : (
        <ul className="divide-y divide-edge-2 rounded-lg border border-edge-2">
          {links.map((l) => (
            <li key={l.link_id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <span className="text-ink-1">
                Office <span className="break-all font-mono text-xs">{l.other_office_id}</span>
                <span className="ml-2 text-xs text-ink-3">
                  {l.status === "active" ? "partner team" : l.direction === "sent" ? "invite sent, waiting" : "invite received"}
                </span>
              </span>
              {isOwner && l.status === "invited" && l.direction === "received" && (
                <span className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => act(() => teamsAPI.answerPartner(l.link_id, true), () => "Accepted.")}>Accept</Button>
                  <Button variant="ghost" size="sm" onClick={() => act(() => teamsAPI.answerPartner(l.link_id, false), () => "Declined.")}>Decline</Button>
                </span>
              )}
              {isOwner && (l.status === "active" || (l.status === "invited" && l.direction === "sent")) && (
                <Button variant="ghost" size="sm" onClick={() => act(() => teamsAPI.endPartner(l.link_id), () => "Link ended.")}>
                  {l.status === "active" ? "End partnership" : "Cancel invite"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isOwner && (
        <form onSubmit={invite} className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[12rem] text-sm text-ink-2">
            Partner office ID
            <input
              className="mt-1 block w-full rounded-md border border-edge-2 bg-surface-0 p-2 text-ink-1"
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              placeholder="The other office's ID"
            />
          </label>
          <Button type="submit" variant="outline" size="sm">Invite partner</Button>
        </form>
      )}
    </div>
  );
}

/**
 * Noticeboard: every member reads it. Owners and editors post, edit and delete. Authors may
 * edit their own posts on the server; this screen only offers the owner and editor controls.
 */
export function NoticeBoard({ detail, onRun }) {
  const [notices, setNotices] = useState(null);
  const [form, setForm] = useState({ title: "", body: "", kind: "notice", colour: "plain", pinned: false });
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState(null);
  const canWrite = detail.my_role === "owner" || detail.my_role === "editor";

  const load = useCallback(async () => {
    try {
      const { data } = await teamsAPI.notices(detail.id);
      setNotices(data.notices);
      setErr(null);
    } catch (e) {
      setErr(apiError(e, "The noticeboard could not be loaded."));
    }
  }, [detail.id]);

  useEffect(() => { load(); }, [load]);

  async function post(e) {
    e.preventDefault();
    await onRun(() => teamsAPI.postNotice(detail.id, form), () => "Notice posted.");
    setForm({ title: "", body: "", kind: "notice", colour: "plain", pinned: false });
    await load();
  }

  async function saveEdit(id) {
    await onRun(() => teamsAPI.editNotice(detail.id, id, editing), () => "Notice updated.");
    setEditing(null);
    await load();
  }

  async function remove(id) {
    await onRun(() => teamsAPI.deleteNotice(detail.id, id), () => "Notice removed.");
    await load();
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-ink-1">Noticeboard</h3>
      {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      {notices === null ? null : notices.length === 0 ? (
        <p className="text-sm text-ink-3">Nothing posted yet.</p>
      ) : (
        <ul className="space-y-2">
          {notices.map((n) => (
            <li
              key={n.id}
              data-testid={n.kind === "sticky" ? "office-sticky" : "office-notice"}
              className={cn(
                "rounded-md border p-3 text-sm",
                n.kind === "sticky" ? STICKY_SKIN[n.colour] || STICKY_SKIN.plain : "border-edge-2",
              )}
            >
              {editing && editing.id === n.id ? (
                <div className="space-y-2">
                  <input
                    className="block w-full rounded-md border border-edge-2 bg-surface-0 p-2 text-ink-1"
                    value={editing.title}
                    onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  />
                  <textarea
                    className="block w-full rounded-md border border-edge-2 bg-surface-0 p-2 text-ink-1"
                    rows={3}
                    value={editing.body}
                    onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                  />
                  <span className="flex gap-2">
                    <Button size="sm" onClick={() => saveEdit(n.id)}>Save</Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                  </span>
                </div>
              ) : (
                <>
                  <p className="font-medium text-ink-1">{n.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-ink-2">{n.body}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-4">
                    <span>{new Date(n.created_at).toLocaleString()}{n.edited_at ? " · edited" : ""}</span>
                    {n.pinned && (
                      <span className="inline-flex items-center gap-0.5 font-bold text-ink-2">
                        <Pin size={10} aria-hidden="true" /> pinned
                      </span>
                    )}
                    {n.expires_at && (
                      <span className="inline-flex items-center gap-0.5">
                        <Timer size={10} aria-hidden="true" />
                        clears {new Date(n.expires_at).toLocaleDateString()}
                      </span>
                    )}
                  </p>
                  {canWrite && (
                    <span className="mt-2 flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setEditing({ id: n.id, title: n.title, body: n.body })}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(n.id)}>Delete</Button>
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form onSubmit={post} className="space-y-2">
          <input
            className="block w-full rounded-md border border-edge-2 bg-surface-0 p-2 text-ink-1"
            placeholder="Notice title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <textarea
            className="block w-full rounded-md border border-edge-2 bg-surface-0 p-2 text-ink-1"
            rows={3}
            placeholder="What the team needs to know"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {["notice", "sticky"].map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={form.kind === kind}
                onClick={() => setForm({ ...form, kind })}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-2xs font-bold",
                  form.kind === kind
                    ? "border-ink-1 bg-ink-1 text-surface-0"
                    : "border-edge-2 text-ink-3 hover:text-ink-1",
                )}
              >
                {kind === "notice" ? "Notice" : "Sticky"}
              </button>
            ))}
            {form.kind === "sticky" && (
              <>
                {Object.keys(STICKY_SKIN).map((colour) => (
                  <button
                    key={colour}
                    type="button"
                    aria-label={`${colour} sticky`}
                    aria-pressed={form.colour === colour}
                    onClick={() => setForm({ ...form, colour })}
                    className={cn(
                      "h-5 w-5 rounded-full border-2",
                      STICKY_SKIN[colour],
                      form.colour === colour ? "border-ink-1" : "border-transparent",
                    )}
                  />
                ))}
                <label className="inline-flex items-center gap-1 text-2xs font-bold text-ink-3">
                  <input
                    type="checkbox"
                    checked={form.pinned}
                    onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
                  />
                  Pin
                </label>
              </>
            )}
          </div>
          <Button type="submit" variant="outline" size="sm">Post notice</Button>
        </form>
      )}
    </div>
  );
}
