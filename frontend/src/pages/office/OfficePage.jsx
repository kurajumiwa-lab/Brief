import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, ArrowUpRight, CalendarDays, CheckCircle2, Circle,
  Globe2, Lock, Store, Users, Wallet,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { officeAPI, apiError } from "@/lib/api";
import { FLUID_TEAMS_ENABLED } from "@/config/flags";
import { NoticeBoard, PartnerPanel } from "@/components/office/TeamsPanels";
import SavedItemsPanel from "@/components/office/SavedItemsPanel";

const ROLE_LABELS = {
  editor: "Editor (can invite and add events)",
  approver: "Approver",
  member: "Member (read only)",
  partner: "Partner",
  staff: "Staff",
};

/**
 * HOME OFFICE — the private workroom, not the shop.
 *
 * The confusion this screen fixes: opening an office used to land on a staff
 * list and a calendar, as if a team registry were the point. The office is the
 * back room. The Page is the public front door. The shelf is what is currently
 * on offer. This screen now says which is which, links to the real Page, and
 * gives the four next steps that make the Page useful.
 *
 * People are optional and sit behind a disclosure. One person is a complete
 * office.
 */
export default function OfficePage() {
  const [offices, setOffices] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  // True once we have waited long enough to stop pretending this is progress.
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (offices !== null) return undefined;
    const timer = window.setTimeout(() => setStalled(true), 10000);
    return () => window.clearTimeout(timer);
  }, [offices]);

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

  // A white screen on a phone is indistinguishable from a broken app, and this
  // page used to answer a slow or failed request with one grey word on an
  // otherwise empty page. Every state now names itself: the heading is always
  // drawn, a failure offers a retry, and a stall after ten seconds says so
  // instead of waiting quietly forever.
  if (offices === null) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <header>
          <p className="eyebrow flex items-center gap-1.5 text-ink-4">
            <Lock size={11} aria-hidden="true" /> Private workspace
          </p>
          <h1 className="mt-1 text-xl font-semibold text-ink-1">Home office</h1>
        </header>
        {error ? (
          <div role="alert" className="rounded-xl border border-edge-1 bg-surface-1 p-4">
            <p className="text-sm font-semibold text-ink-1">Your office did not open.</p>
            <p className="mt-1 text-sm text-ink-3">{error}</p>
            <p className="mt-1 text-micro text-ink-4">
              Nothing was lost. Your page, your stock and your records are untouched.
            </p>
            <Button className="mt-3" size="sm" onClick={() => { setError(null); loadMine(); }}>
              Try again
            </Button>
          </div>
        ) : stalled ? (
          <div role="status" className="rounded-xl border border-edge-1 bg-surface-1 p-4">
            <p className="text-sm font-semibold text-ink-1">This is taking longer than usual.</p>
            <p className="mt-1 text-sm text-ink-3">
              The network answered nothing. You can wait, or try again — nothing has changed
              while you were waiting.
            </p>
            <Button className="mt-3" size="sm" onClick={loadMine}>Try again</Button>
          </div>
        ) : (
          <div role="status" aria-live="polite" className="space-y-2" data-testid="office-loading">
            <div className="h-16 animate-pulse rounded-xl bg-surface-2" />
            <div className="h-24 animate-pulse rounded-xl bg-surface-2" />
            <p className="text-micro text-ink-4">Opening your office…</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header>
        <p className="eyebrow flex items-center gap-1.5 text-ink-4">
          <Lock size={11} aria-hidden="true" /> Private workspace
        </p>
        <h1 className="mt-1 text-xl font-semibold text-ink-1">Home office</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-3">
          The back room for you and anyone who helps you deliver. Customers never see
          this screen — they see your <strong className="font-semibold text-ink-2">Page</strong>,
          and what is currently on your <strong className="font-semibold text-ink-2">shelf</strong>.
          You can run this office alone.
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

      {detail && (
        <div className="space-y-6" data-testid="office-model">
          <section className="rounded-xl border border-edge-1 bg-surface-1 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-ink-1">{detail.name}</h2>
                <p className="text-sm text-ink-3">
                  {detail.nature} · {detail.area}
                  {detail.hours_text ? ` · ${detail.hours_text}` : ""}
                </p>
              </div>
              <span className="rounded-full bg-surface-2 px-2.5 py-1 text-micro font-bold text-ink-3">
                Your role: {detail.my_role}
              </span>
            </div>
          </section>

          <OfficeFrontDoor page={detail.page} office={detail} />
          <SavedItemsPanel officeId={detail.id} role={detail.my_role} />
          <OfficeNextSteps setup={detail.setup} page={detail.page} />
          <OfficePeople detail={detail} onRun={run} />

          {FLUID_TEAMS_ENABLED && (
            <>
              <PartnerPanel detail={detail} onRun={run} />
              <NoticeBoard detail={detail} onRun={run} />
            </>
          )}

          <section aria-labelledby="office-calendar-heading">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <h3 id="office-calendar-heading" className="flex items-center gap-1.5 text-sm font-semibold text-ink-1">
                  <CalendarDays size={14} aria-hidden="true" /> Internal calendar
                </h3>
                <p className="text-micro text-ink-4">
                  Only office members see this. For a public round or a ticketed event,
                  publish it on your Page or under Events.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={downloadCalendar}>Download .ics</Button>
            </div>
            {detail.events.length === 0 ? (
              <p className="text-sm text-ink-3">No internal entries yet.</p>
            ) : (
              <ul className="space-y-2">
                {detail.events.map((e) => (
                  <li key={e.id} className="rounded-md border border-edge-2 p-3 text-sm">
                    <span className="font-medium text-ink-1">{e.title}</span>
                    <span className="ml-2 text-ink-3">
                      {new Date(e.starts_at).toLocaleString()} – {new Date(e.ends_at).toLocaleTimeString()}
                    </span>
                    {e.location_text && <span className="block text-xs text-ink-4">{e.location_text}</span>}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {(detail.my_role === "owner" || detail.my_role === "editor") && (
                <OfficeEventForm officeId={detail.id} onRun={run} />
              )}
              <Link
                to="/events"
                className="inline-flex h-10 items-center gap-1 rounded-lg border border-edge-1 bg-surface-0 px-3 text-xs font-bold text-ink-2 hover:border-edge-2"
              >
                <Globe2 size={13} aria-hidden="true" /> Publish a public event
                <ArrowUpRight size={12} aria-hidden="true" />
              </Link>
            </div>
          </section>
        </div>
      )}

      {(!offices || offices.length === 0) && (
        <CreateOffice
          onCreated={(o) => { setNotice("Your office is set up."); setSelected(o.id); loadMine(); }}
          onError={setError}
        />
      )}

      {offices && offices.length > 0 && (
        <details className="rounded-lg border border-edge-2 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-ink-1">
            Create another home office
          </summary>
          <div className="mt-4">
            <CreateOffice
              onCreated={(o) => { setNotice("Your office is set up."); setSelected(o.id); loadMine(); }}
              onError={setError}
            />
          </div>
        </details>
      )}
    </div>
  );
}

/** The public front door. The office is private; this card is the way out. */
function OfficeFrontDoor({ page, office }) {
  if (!page) return null;
  const published = page.published && page.url;
  return (
    <section
      aria-labelledby="office-page-heading"
      className="overflow-hidden rounded-xl border border-edge-1 bg-surface-1"
      data-testid="office-front-door"
    >
      <div className="flex flex-wrap items-start gap-3 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-700 text-white">
          <Globe2 size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-ink-4">Public page</p>
          <h2 id="office-page-heading" className="truncate text-sm font-bold text-ink-1">
            {published ? page.url : "Not ready yet"}
          </h2>
          <p className="mt-0.5 text-micro text-ink-4">
            {published
              ? `${page.discoverable ? "Discoverable in Regions" : "Hidden from discovery"} · ${office?.name || "This office"}`
              : "A Page is the card you send when somebody asks what you do."}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {published && (
            <Link
              to={page.url}
              className="inline-flex h-10 items-center gap-1 rounded-lg border border-edge-1 bg-surface-0 px-3 text-xs font-bold text-ink-2 hover:border-edge-2"
            >
              Open <ArrowUpRight size={12} aria-hidden="true" />
            </Link>
          )}
          <Link
            to="/you/page"
            className="inline-flex h-10 items-center gap-1 rounded-lg bg-brand-700 px-3 text-xs font-bold text-white hover:bg-brand-800"
          >
            {published ? "Edit page" : "Create page"} <ArrowRight size={12} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/** Four real steps, each one linking to the screen that finishes it. */
function OfficeNextSteps({ setup, page }) {
  const preset = setup?.preset || page?.preset || "service";
  const shelfHref = preset === "shop" ? "/stock" : preset === "host" ? "/events" : "/calendar";
  const shelfLabel = preset === "shop" ? "Open your stock" : preset === "host" ? "Open Events" : "Open your services";
  const steps = [
    {
      key: "page",
      done: Boolean(setup?.page_ready),
      title: "Finish your Page",
      body: "Name, area and a line about what you do. This is what a customer opens.",
      to: "/you/page",
      cta: "Page editor",
      icon: Globe2,
    },
    {
      key: "shelf",
      done: Boolean(setup?.shelf_ready),
      title: "Put what you offer on the shelf",
      body: setup?.shelf_ready
        ? preset === "host"
          ? `${setup.event_count || 0} public event${setup.event_count === 1 ? "" : "s"} on your Page calendar.`
          : `${setup.service_count || 0} service${setup.service_count === 1 ? "" : "s"} and ${setup.stock_count || 0} stock line${setup.stock_count === 1 ? "" : "s"} live.`
        : preset === "host"
          ? "Publish a round or a ticketed event so people can join."
          : "A service with a duration and price, or a stock line with a quantity.",
      to: shelfHref,
      cta: shelfLabel,
      icon: Store,
    },
    {
      key: "hours",
      done: Boolean(setup?.hours_ready),
      title: "Set when you are open",
      body: "Availability windows for services, or visiting / pickup hours for a shelf.",
      to: "/calendar",
      cta: "Set hours",
      icon: CalendarDays,
    },
    {
      key: "payment",
      done: Boolean(setup?.payment_ready),
      optional: true,
      title: "Say how customers pay you",
      body: "Publish your own Till or Paybill on the Page. The office never holds the money.",
      to: "/you/page",
      cta: "Add payment tag",
      icon: Wallet,
    },
  ];
  const done = steps.filter((s) => s.done).length;

  return (
    <section aria-labelledby="office-next-heading" data-testid="office-next-steps">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 id="office-next-heading" className="text-sm font-semibold text-ink-1">
          What next
        </h3>
        <span className="text-micro font-bold tabular-nums text-ink-4">
          {done}/{steps.length} done
        </span>
      </div>
      <ol className="space-y-2">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <li
              key={step.key}
              data-testid={`office-step-${step.key}`}
              data-done={step.done ? "true" : "false"}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-edge-1 bg-surface-1 p-3"
            >
              <span className="shrink-0" aria-hidden="true">
                {step.done ? (
                  <CheckCircle2 size={18} className="text-brand-700 dark:text-brand-300" />
                ) : (
                  <Circle size={18} className="text-ink-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-xs font-bold text-ink-1">
                  <Icon size={12} className="text-ink-4" aria-hidden="true" />
                  {step.title}
                  {step.optional && <span className="font-normal text-ink-4">· optional</span>}
                </p>
                <p className="mt-0.5 text-micro leading-relaxed text-ink-4">{step.body}</p>
              </div>
              {!step.done && (
                <Link
                  to={step.to}
                  className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-edge-1 bg-surface-0 px-2.5 text-micro font-bold text-ink-2 hover:border-edge-2"
                >
                  {step.cta} <ArrowRight size={11} aria-hidden="true" />
                </Link>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-micro text-ink-4">
        Adding people comes after this, and only if someone helps you deliver.
      </p>
    </section>
  );
}

/** People are optional. The list and invites stay available, just not first. */
function OfficePeople({ detail, onRun }) {
  const active = detail.members.filter((m) => m.status === "active");
  return (
    <details
      id="office-people"
      open={detail.members.length > 1}
      className="rounded-xl border border-edge-1 bg-surface-1 p-4"
      data-testid="office-people"
    >
      <summary className="cursor-pointer text-sm font-semibold text-ink-1">
        <span className="inline-flex items-center gap-1.5">
          <Users size={14} aria-hidden="true" /> People in this office
          <span className="font-normal text-ink-4">· {active.length} active · optional</span>
        </span>
      </summary>
      <p className="mt-2 text-micro text-ink-4">
        One person is a complete office. Add a colleague only when they agree, or
        when someone needs the internal calendar.
      </p>
      <ul className="mt-3 divide-y divide-edge-2 rounded-lg border border-edge-2">
        {detail.members.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 p-3 text-sm">
            <span className="text-ink-1">
              {m.name}{" "}
              <span className="text-ink-3">
                · {m.role}{m.function_label ? ` · ${m.function_label}` : ""}
              </span>
              {m.status !== "active" && <span className="ml-2 text-xs text-ink-4">({m.status})</span>}
            </span>
            {detail.my_role === "owner" && m.role !== "owner" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRun(() => officeAPI.removeMember(detail.id, m.id), () => "Removed.")}
              >
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      {detail.my_role === "owner" && <InviteForms detail={detail} onRun={onRun} />}
    </details>
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
    <form onSubmit={submit} className="grid gap-3 rounded-lg border border-edge-2 p-4 sm:grid-cols-2">
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
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <form
        className="space-y-3 rounded-lg border border-edge-2 p-3"
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
        className="space-y-3 rounded-lg border border-edge-2 p-3"
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

function OfficeEventForm({ officeId, onRun }) {
  const [form, setForm] = useState({ activity: "", title: "", starts_at: "", ends_at: "", location_text: "" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <details className="w-full rounded-lg border border-edge-2 p-3">
      <summary className="cursor-pointer text-xs font-bold text-ink-2">Add an internal calendar entry</summary>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const body = {
            ...form,
            starts_at: new Date(form.starts_at).toISOString(),
            ends_at: new Date(form.ends_at).toISOString(),
            location_text: form.location_text || null,
          };
          onRun(() => officeAPI.addEvent(officeId, body), () => "Entry added.");
          setForm({ activity: "", title: "", starts_at: "", ends_at: "", location_text: "" });
        }}
      >
        <Input label="Service" value={form.activity} onChange={set("activity")} placeholder="e.g. Haircut" required />
        <Input label="Title" value={form.title} onChange={set("title")} required />
        <Input label="Starts" type="datetime-local" value={form.starts_at} onChange={set("starts_at")} required />
        <Input label="Ends" type="datetime-local" value={form.ends_at} onChange={set("ends_at")} required />
        <Input label="Place (optional, area only)" value={form.location_text} onChange={set("location_text")} className="sm:col-span-2" />
        <div className="sm:col-span-2"><Button type="submit" size="sm">Add entry</Button></div>
      </form>
    </details>
  );
}
