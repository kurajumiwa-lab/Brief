import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, Plus, MapPin, Users, Video, Ticket, Check, X, ClipboardList, Crown, DoorOpen, BarChart3 } from "lucide-react";
import Tabs from "@/components/ui/Tabs";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import Modal from "@/components/ui/Modal";
import Drawer from "@/components/ui/Drawer";
import Select from "@/components/ui/Select";
import Input from "@/components/ui/Input";
import Avatar from "@/components/ui/Avatar";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import EventForm from "@/components/forms/EventForm";
import { useEventStore } from "@/stores/eventStore";
import { useGroupStore } from "@/stores/groupStore";
import { useListStore } from "@/stores/listStore";
import { useAuthStore } from "@/stores/authStore";
import { EVENT_TYPES } from "@/config/constants";
import { apiError, eventAPI } from "@/lib/api";
import { currency, num, dayLabel, shortDateTime, relativeTime, parseApiDate } from "@/lib/formatters";
import { Check as CheckBox } from "@/components/forms/GroupForm";
import { cn, titleCase } from "@/lib/utils";

const TABS = [
  { value: "upcoming", label: "Upcoming" },
  { value: "mine", label: "My Events" },
];
const STATUS_BADGE = { upcoming: "brand", active: "blue", completed: "gray", cancelled: "red" };

export default function EventsPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get("tab")) ? params.get("tab") : "upcoming";
  const setTab = (v) => setParams(v === "upcoming" ? {} : { tab: v }, { replace: true });
  const [type, setType] = useState("");
  const [location, setLocation] = useState("");
  const [includePast, setIncludePast] = useState(false);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [fetched, setFetched] = useState(null); // event pulled for a ?event= deep link before the lists load
  const me = useAuthStore((s) => s.vendor);
  const { events, mine, loading, fetchEvents, fetchMine, register, cancelRegistration, setStatus } = useEventStore();
  // the drawer reads from the store so check-ins / status changes show up without reopening
  const open = openId ? [...events, ...mine].find((e) => e.id === openId) || (fetched?.id === openId ? fetched : null) : null;
  const setOpen = (ev) => setOpenId(ev ? ev.id : null);

  const deepLink = params.get("event");
  useEffect(() => {
    if (!deepLink) return;
    setOpenId(deepLink);
    eventAPI.get(deepLink).then(({ data }) => setFetched(data)).catch(() => {});
    const next = new URLSearchParams(params);
    next.delete("event");
    setParams(next, { replace: true });
  }, [deepLink]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useGroupStore((s) => s.mine);
  const fetchGroups = useGroupStore((s) => s.fetchMine);
  const lists = useListStore((s) => s.mine);
  const fetchLists = useListStore((s) => s.fetchMine);
  const confirm = useConfirm();

  useEffect(() => {
    if (tab === "upcoming") fetchEvents({ event_type: type, location, include_past: includePast || undefined }).catch((e) => toast.error(apiError(e)));
    else fetchMine().catch((e) => toast.error(apiError(e)));
  }, [tab, type, location, includePast, fetchEvents, fetchMine]);

  useEffect(() => {
    if (creating) {
      fetchGroups().catch(() => {});
      fetchLists().catch(() => {});
    }
  }, [creating, fetchGroups, fetchLists]);

  const onRegister = async (ev) => {
    try {
      const res = await register(ev);
      toast.success(res?.message || `You're in: ${ev.title}`);
    } catch (e) {
      toast.error(apiError(e, "Registration failed"));
    }
  };
  const onCancel = async (ev) => {
    if (!(await confirm({ title: "Cancel your registration?", message: ev.title, confirmLabel: "Cancel registration", danger: true }))) return;
    try {
      await cancelRegistration(ev);
      toast("Registration cancelled");
    } catch (e) {
      toast.error(apiError(e));
    }
  };
  const onStatus = async (ev, status) => {
    if (status === "cancelled" && !(await confirm({ title: `Cancel ${ev.title}?`, message: "Registered vendors will see it as cancelled.", confirmLabel: "Cancel event", danger: true }))) return;
    try {
      await setStatus(ev, status);
      toast.success(`Event ${status}`);
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const source = tab === "upcoming" ? events : mine;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink-1 tracking-tight">Events</h2>
          <p className="text-xs text-ink-4">Sourcing trips, market days, trade fairs and workshops — organised by patrons and groups, attended by vendors.</p>
        </div>
        <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
          New event
        </Button>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "upcoming" && (
        <div className="grid sm:grid-cols-[12rem_1fr_auto] gap-2 items-center">
          <Select value={type} onChange={(e) => setType(e.target.value)} placeholder="Any type" options={EVENT_TYPES} />
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" />
          <CheckBox checked={includePast} onChange={(e) => setIncludePast(e.target.checked)} label="Include past" />
        </div>
      )}

      {loading && source.length === 0 ? (
        <PageSpinner />
      ) : source.length === 0 ? (
        <EmptyState icon={CalendarDays} title={tab === "mine" ? "No events on your calendar" : "Nothing scheduled"} description={tab === "mine" ? "Events you organise or register for show up here." : "Organise one — a Saturday sourcing run is how most collectives start."} action={<Button size="sm" icon={Plus} onClick={() => setCreating(true)}>New event</Button>} />
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {source.map((ev) => {
            const organiser = ev.organizer === me?.vendor_handle;
            const full = ev.spots_left === 0;
            const past = ev.status === "completed" || ev.status === "cancelled";
            const typeMeta = EVENT_TYPES.find((t) => t.value === ev.event_type);
            return (
              <Card key={ev.id} className={cn("flex flex-col gap-3", ev.status === "cancelled" && "opacity-60")}>
                <div className="flex items-start gap-3">
                  <DateTile date={ev.start_date} />
                  <div className="min-w-0 flex-1">
                    <button onClick={() => setOpen(ev)} className="text-left">
                      <h3 className="text-sm font-semibold text-ink-1 leading-snug hover:text-brand-300">{ev.title}</h3>
                    </button>
                    <p className="text-2xs text-ink-4 mt-0.5">
                      {typeMeta?.label || titleCase(ev.event_type)} · by <span className="text-ink-3">{ev.organizer_business}</span>
                    </p>
                  </div>
                  <Badge variant={STATUS_BADGE[ev.status] || "gray"} size="xs">
                    {ev.status}
                  </Badge>
                </div>
                {ev.description && <p className="text-xs text-ink-3 line-clamp-2">{ev.description}</p>}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-4">
                  <span>{shortDateTime(ev.start_date)} → {shortDateTime(ev.end_date)}</span>
                  {ev.is_virtual ? (
                    <span className="inline-flex items-center gap-1">
                      <Video size={10} /> virtual
                    </span>
                  ) : (
                    ev.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={10} /> {ev.location}
                      </span>
                    )
                  )}
                  <span className="inline-flex items-center gap-1">
                    <Ticket size={10} /> {ev.entry_fee ? currency(ev.entry_fee) : "free"}
                  </span>
                </div>
                {requirementChips(ev.vendor_requirements).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {requirementChips(ev.vendor_requirements).map((r) => (
                      <Badge key={r} variant="outline" size="xs">
                        {r}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <span className="inline-flex items-center gap-1 text-xs text-ink-4 font-mono">
                    <Users size={12} /> {num(ev.registered_count)}
                    {ev.max_vendors ? ` / ${num(ev.max_vendors)}` : ""}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {organiser ? (
                      <>
                        <Badge variant="amber" size="xs">
                          <Crown size={9} /> organiser
                        </Badge>
                        <Button size="xs" variant="secondary" icon={ClipboardList} onClick={() => setOpen(ev)}>
                          Manage
                        </Button>
                      </>
                    ) : ev.my_status === "registered" || ev.my_status === "confirmed" ? (
                      <>
                        <Badge variant="brand">
                          <Check size={10} /> {ev.my_status}
                        </Badge>
                        {!past && <Button size="xs" variant="ghost" icon={X} onClick={() => onCancel(ev)} aria-label="Cancel registration" />}
                      </>
                    ) : (
                      !past && (
                        <Button size="xs" onClick={() => onRegister(ev)} disabled={full}>
                          {full ? "Full" : "Register"}
                        </Button>
                      )
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Organise an event" description="Optionally restrict registration to one of your groups or vendor lists.">
        <EventForm groups={groups.filter((g) => g.my_role === "admin")} lists={lists.filter((l) => l.i_run_it)} onDone={() => setCreating(false)} onCancel={() => setCreating(false)} />
      </Modal>
      <EventDrawer event={open} onClose={() => setOpen(null)} organiser={open?.organizer === me?.vendor_handle} onStatus={onStatus} onPatch={(patch) => setFetched((f) => (f && f.id === open?.id ? { ...f, ...patch } : f))} />
    </div>
  );
}

/** vendor_requirements is a dict: { categories: [...], other: [...], anything: value } */
export function requirementChips(req) {
  if (!req || typeof req !== "object") return [];
  return Object.entries(req).flatMap(([k, v]) => {
    const vals = Array.isArray(v) ? v : [v];
    return vals.filter((x) => x !== null && x !== "" && x !== undefined).map((x) => (k === "categories" ? `${x} vendors` : k === "other" ? String(x) : `${titleCase(k)}: ${x}`));
  });
}

function DateTile({ date }) {
  const d = parseApiDate(date);
  if (!d) return null;
  return (
    <div className="w-11 shrink-0 rounded-lg border border-edge-2 bg-surface-2 text-center overflow-hidden">
      <div className="bg-brand-700/80 text-white text-2xs uppercase tracking-wide py-0.5">{d.toLocaleString("en-KE", { month: "short" })}</div>
      <div className="text-lg font-semibold font-mono text-ink-1 leading-tight py-1">{d.getDate()}</div>
    </div>
  );
}

// mirrors routes/events.py: the window opens on the event's calendar day
const startsByToday = (iso) => {
  const d = parseApiDate(iso);
  if (!d) return false;
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return d <= endOfToday;
};

function EventDrawer({ event: ev, onClose, organiser, onStatus, onPatch }) {
  const { registrations, checkIn, checkInVendor, analytics } = useEventStore();
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState("");
  const load = () => {
    if (!ev || !organiser) return;
    registrations(ev.id).then(setRows).catch(() => setRows([]));
    analytics(ev.id).then(setStats).catch(() => setStats(null));
  };
  useEffect(() => {
    setRows([]);
    setStats(null);
    load();
  }, [ev?.id, organiser, ev?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const registered = ev?.my_status === "registered" || ev?.my_status === "confirmed";
  const checkInOpen = ev && (ev.status === "active" || (ev.status === "upcoming" && startsByToday(ev.start_date)));

  const selfCheckIn = async () => {
    setBusy("self");
    try {
      const res = await checkIn(ev);
      onPatch?.({ my_status: "attended" });
      toast.success(res?.message || "Checked in — enjoy the day");
    } catch (e) {
      toast.error(apiError(e, "Couldn't check you in"));
    } finally {
      setBusy("");
    }
  };
  const doorCheckIn = async (r) => {
    setBusy(r.vendor_id);
    try {
      await checkInVendor(ev.id, r.vendor_id);
      toast.success(`@${r.vendor_handle} is in`);
      load();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <Drawer open={!!ev} onClose={onClose} title={ev?.title} description={ev ? `${dayLabel(ev.start_date)} · ${ev.is_virtual ? "virtual" : ev.location || "location tba"}` : ""}>
      {ev && (
        <div className="space-y-5">
          {ev.description && <p className="text-sm text-ink-3 leading-relaxed">{ev.description}</p>}
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <Row k="Type" v={EVENT_TYPES.find((t) => t.value === ev.event_type)?.label || titleCase(ev.event_type)} />
            <Row k="Status" v={ev.status} />
            <Row k="Starts" v={shortDateTime(ev.start_date)} />
            <Row k="Ends" v={shortDateTime(ev.end_date)} />
            <Row k="Entry fee" v={ev.entry_fee ? currency(ev.entry_fee) : "free"} />
            <Row k="Capacity" v={ev.max_vendors ? `${num(ev.registered_count)} / ${num(ev.max_vendors)}` : `${num(ev.registered_count)} registered`} />
            <Row k="Organiser" v={`${ev.organizer_business} · @${ev.organizer}`} />
            {requirementChips(ev.vendor_requirements).length > 0 && <Row k="Requirements" v={requirementChips(ev.vendor_requirements).join(", ")} />}
          </dl>

          {!organiser && registered && ev.status !== "cancelled" && ev.status !== "completed" && (
            <div className="rounded-xl border border-edge-1 bg-surface-2 p-3 flex items-center justify-between gap-3">
              <p className="text-xs text-ink-3">{checkInOpen ? "Check-in is open. Tap when you arrive." : "Check-in opens on the day of the event."}</p>
              <Button size="sm" icon={DoorOpen} disabled={!checkInOpen} loading={busy === "self"} onClick={selfCheckIn}>
                Check in
              </Button>
            </div>
          )}
          {!organiser && ev.my_status === "attended" && (
            <Badge variant="brand" size="md">
              <Check size={11} /> Checked in
            </Badge>
          )}

          {organiser && stats && (
            <section data-testid="event-analytics">
              <h4 className="text-xs font-semibold text-ink-2 mb-2 inline-flex items-center gap-1.5">
                <BarChart3 size={13} className="text-brand-400" /> At a glance
              </h4>
              <div className="grid grid-cols-4 gap-2 text-xs">
                <Row k="Registered" v={`${num(stats.registered)} / ${num(stats.capacity)}`} />
                <Row k="Fill rate" v={`${stats.fill_rate}%`} />
                <Row k="Attended" v={num(stats.attended)} />
                <Row k="Attendance" v={`${stats.attendance_rate}%`} />
              </div>
              {stats.categories?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {stats.categories.slice(0, 8).map((c) => (
                    <Badge key={c.category} variant="outline" size="xs">
                      {c.category} · {c.vendors}
                    </Badge>
                  ))}
                </div>
              )}
            </section>
          )}

          {organiser && (
            <>
              <div className="flex flex-wrap gap-2">
                {ev.status === "upcoming" && (
                  <Button size="sm" variant="secondary" onClick={() => onStatus(ev, "active")}>
                    Mark active
                  </Button>
                )}
                {(ev.status === "upcoming" || ev.status === "active") && (
                  <Button size="sm" variant="secondary" onClick={() => onStatus(ev, "completed")}>
                    Mark completed
                  </Button>
                )}
                {ev.status !== "cancelled" && ev.status !== "completed" && (
                  <Button size="sm" variant="dangerGhost" onClick={() => onStatus(ev, "cancelled")}>
                    Cancel event
                  </Button>
                )}
              </div>
              <section>
                <h4 className="text-xs font-semibold text-ink-2 mb-2">
                  Registrations <span className="font-mono text-ink-4">{rows.length}</span>
                </h4>
                {rows.length === 0 ? (
                  <p className="text-2xs text-ink-4">Nobody has registered yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {rows.map((r) => (
                      <li key={r.vendor_id} className="flex items-center gap-2.5 text-xs">
                        <Avatar name={r.business_name} size="xs" />
                        <span className="text-ink-2 truncate">{r.business_name}</span>
                        <span className="font-mono text-ink-4 truncate">@{r.vendor_handle}</span>
                        <span className="ml-auto flex items-center gap-2 text-2xs text-ink-4">
                          {r.booth_assignment && <span>booth {r.booth_assignment}</span>}
                          <Badge variant={r.status === "cancelled" || r.status === "no_show" ? "red" : r.status === "attended" ? "brand" : "blue"} size="xs">
                            {r.status === "no_show" ? "no-show" : r.status}
                          </Badge>
                          {r.status === "attended" ? (
                            <span title={r.checked_in_at ? `checked in ${relativeTime(r.checked_in_at)}` : undefined}>{relativeTime(r.checked_in_at || r.registered_at)}</span>
                          ) : ev.status !== "completed" && ev.status !== "cancelled" && r.status !== "cancelled" ? (
                            <Button size="xs" variant="secondary" icon={DoorOpen} loading={busy === r.vendor_id} onClick={() => doorCheckIn(r)}>
                              Check in
                            </Button>
                          ) : (
                            <span>{relativeTime(r.registered_at)}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Row({ k, v }) {
  return (
    <div className="rounded-lg bg-surface-2 border border-edge-1 px-2.5 py-1.5 min-w-0">
      <dt className="text-2xs text-ink-4">{k}</dt>
      <dd className="text-ink-1 truncate">{v}</dd>
    </div>
  );
}
