import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { officeAPI, apiError } from "@/lib/api";

const ROLE_LABELS = {
  editor: "Editor (can invite and add events)",
  approver: "Approver",
  member: "Member (read only)",
  partner: "Partner",
  staff: "Staff",
};

/** Home office: one person is enough. Team members join by link or by accepted invite. */
export default function OfficePage() {
  const [offices, setOffices] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const loadMine = useCallback(async () => {
    try {
      const { data } = await officeAPI.mine();
      setOffices(data.offices);
      setSelected((cur) => cur || data.offices[0]?.id || null);
    } catch (err) {
      setError(apiError(err, "Your offices could not be loaded."));
    }
  }, []);

  const loadDetail = useCallback(async (id) => {
    if (!id) return setDetail(null);
    try {
      const { data } = await officeAPI.detail(id);
      setDetail(data);
    } catch (err) {
      setError(apiError(err, "This office could not be opened."));
    }
  }, []);

  useEffect(() => { loadMine(); }, [loadMine]);
  useEffect(() => { loadDetail(selected); }, [selected, loadDetail]);

  async function downloadCalendar() {
    try {
      const { data } = await officeAPI.calendar(selected);
      const url = URL.createObjectURL(new Blob([data], { type: "text/calendar" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${detail?.name || "office"}.ics`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(apiError(err, "The calendar could not be downloaded."));
    }
  }

  async function run(fn, done) {
    setError(null);
    setNotice(null);
    try {
      const res = await fn();
      setNotice(done(res));
      await loadDetail(selected);
    } catch (err) {
      setError(apiError(err, "That did not work. Try again."));
    }
  }

  if (offices === null && !error) return <p className="p-6 text-sm text-ink-3">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-1">Home office</h1>
        <p className="text-sm text-ink-3">
          A profile for one person or a team. Add people only when they agree. Your exact address is shared only after both sides confirm a booking.
        </p>
      </header>

      {error && <p role="alert" className="text-sm font-medium text-red-600">{error}</p>}
      {notice && <p role="status" className="text-sm text-ink-2">{notice}</p>}

      {offices && offices.length > 0 && (
        <label className="block text-sm text-ink-2">
          Office
          <select
            className="mt-1 block w-full rounded-md border border-edge-2 bg-surface-0 p-2 text-ink-1"
            value={selected || ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {offices.map((o) => (
              <option key={o.id} value={o.id}>{o.name} · {o.my_role}</option>
            ))}
          </select>
        </label>
      )}

      <CreateOffice onCreated={(o) => { setNotice("Your office is set up."); setSelected(o.id); loadMine(); }} onError={setError} />

      {detail && (
        <section className="space-y-6">
          <div className="rounded-lg bg-surface-2 p-4">
            <h2 className="font-semibold text-ink-1">{detail.name}</h2>
            <p className="text-sm text-ink-3">{detail.nature} · {detail.area}{detail.hours_text ? ` · ${detail.hours_text}` : ""}</p>
            <p className="mt-1 text-xs text-ink-4">Your role: {detail.my_role}</p>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-1">People</h3>
            <ul className="divide-y divide-edge-2 rounded-lg border border-edge-2">
              {detail.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <span className="text-ink-1">
                    {m.name} <span className="text-ink-3">· {m.role}{m.function_label ? ` · ${m.function_label}` : ""}</span>
                    {m.status !== "active" && <span className="ml-2 text-xs text-ink-4">({m.status})</span>}
                  </span>
                  {detail.my_role === "owner" && m.role !== "owner" && (
                    <Button variant="ghost" size="sm" onClick={() => run(() => officeAPI.removeMember(detail.id, m.id), () => "Removed.")}>Remove</Button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {detail.my_role === "owner" && (
            <InviteForms detail={detail} onRun={run} />
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-1">Calendar</h3>
              <Button variant="outline" size="sm" onClick={downloadCalendar}>Download .ics</Button>
            </div>
            {detail.events.length === 0 ? (
              <p className="text-sm text-ink-3">No events yet.</p>
            ) : (
              <ul className="space-y-2">
                {detail.events.map((e) => (
                  <li key={e.id} className="rounded-md border border-edge-2 p-3 text-sm">
                    <span className="font-medium text-ink-1">{e.title}</span>
                    <span className="ml-2 text-ink-3">{new Date(e.starts_at).toLocaleString()} – {new Date(e.ends_at).toLocaleTimeString()}</span>
                    {e.location_text && <span className="block text-xs text-ink-4">{e.location_text}</span>}
                  </li>
                ))}
              </ul>
            )}
            {(detail.my_role === "owner" || detail.my_role === "editor") && (
              <EventForm officeId={detail.id} onRun={run} />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function CreateOffice({ onCreated, onError }) {
  const [form, setForm] = useState({ name: "", nature: "", area: "", hours_text: "", contact_mode: "none" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await officeAPI.create({ ...form, hours_text: form.hours_text || null });
      setForm({ name: "", nature: "", area: "", hours_text: "", contact_mode: "none" });
      onCreated(data);
    } catch (err) {
      onError(apiError(err, "Your office could not be created."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-lg border border-edge-2 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-ink-1">Set up a new home office</summary>
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <Input label="Name" value={form.name} onChange={set("name")} required />
        <Input label="What you do" value={form.nature} onChange={set("nature")} placeholder="e.g. Barber, home visits" required />
        <Input label="Area" value={form.area} onChange={set("area")} placeholder="e.g. Milimani, Kisumu" required />
        <Input label="Hours (optional)" value={form.hours_text} onChange={set("hours_text")} />
        <label className="block text-sm text-ink-2 sm:col-span-2">
          Show contact on your public page
          <select className="mt-1 block w-full rounded-md border border-edge-2 bg-surface-0 p-2" value={form.contact_mode} onChange={set("contact_mode")}>
            <option value="none">Nothing</option>
            <option value="phone">Phone</option>
            <option value="email">Email</option>
          </select>
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" loading={busy}>Create office</Button>
        </div>
      </form>
    </details>
  );
}

function InviteForms({ detail, onRun }) {
  const [handle, setHandle] = useState("");
  const [accRole, setAccRole] = useState("staff");
  const [label, setLabel] = useState("");
  const [linkRole, setLinkRole] = useState("member");
  const [link, setLink] = useState(null);
  const roles = detail.roles.filter((r) => r !== "owner");

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <form
        className="space-y-3 rounded-lg border border-edge-2 p-4"
        onSubmit={(e) => { e.preventDefault(); onRun(() => officeAPI.inviteAccount(detail.id, { handle, role: accRole }), () => "Invite sent. They must accept before they join."); setHandle(""); }}
      >
        <p className="text-sm font-semibold text-ink-1">Invite a registered partner</p>
        <Input label="Their handle" value={handle} onChange={(e) => setHandle(e.target.value)} required />
        <label className="block text-sm text-ink-2">
          Role
          <select className="mt-1 block w-full rounded-md border border-edge-2 bg-surface-0 p-2" value={accRole} onChange={(e) => setAccRole(e.target.value)}>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
          </select>
        </label>
        <Button type="submit" variant="secondary">Send invite</Button>
      </form>

      <form
        className="space-y-3 rounded-lg border border-edge-2 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const { data } = await officeAPI.inviteLink(detail.id, { role: linkRole, function_label: label });
            setLink(`${window.location.origin}${data.path}`);
            setLabel("");
          } catch (err) {
            onRun(() => Promise.reject(err), () => "");
          }
        }}
      >
        <p className="text-sm font-semibold text-ink-1">Add someone without an account</p>
        <Input label="Their job here" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Barber, receptionist" required />
        <label className="block text-sm text-ink-2">
          Role
          <select className="mt-1 block w-full rounded-md border border-edge-2 bg-surface-0 p-2" value={linkRole} onChange={(e) => setLinkRole(e.target.value)}>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
          </select>
        </label>
        <Button type="submit" variant="secondary">Make single-use link</Button>
        {link && (
          <p className="break-all rounded bg-surface-2 p-2 text-xs text-ink-2">
            {link} <span className="block text-ink-4">Works once. Expires in 7 days.</span>
          </p>
        )}
      </form>
    </div>
  );
}

function EventForm({ officeId, onRun }) {
  const [form, setForm] = useState({ activity: "", title: "", starts_at: "", ends_at: "", location_text: "" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <form
      className="mt-4 grid gap-3 rounded-lg border border-edge-2 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const body = { ...form, starts_at: new Date(form.starts_at).toISOString(), ends_at: new Date(form.ends_at).toISOString(), location_text: form.location_text || null };
        onRun(() => officeAPI.addEvent(officeId, body), () => "Event added.");
        setForm({ activity: "", title: "", starts_at: "", ends_at: "", location_text: "" });
      }}
    >
      <Input label="Service" value={form.activity} onChange={set("activity")} placeholder="e.g. Haircut" required />
      <Input label="Title" value={form.title} onChange={set("title")} required />
      <Input label="Starts" type="datetime-local" value={form.starts_at} onChange={set("starts_at")} required />
      <Input label="Ends" type="datetime-local" value={form.ends_at} onChange={set("ends_at")} required />
      <Input label="Place (optional, area only)" value={form.location_text} onChange={set("location_text")} className="sm:col-span-2" />
      <div className="sm:col-span-2"><Button type="submit">Add event</Button></div>
    </form>
  );
}
