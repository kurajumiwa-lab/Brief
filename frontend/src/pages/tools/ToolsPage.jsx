import { useEffect, useState } from "react";
import { Plus, Wrench, Truck, MapPin, Star, CalendarCheck, CalendarDays, Power, Warehouse, Package, Store, Hotel, Box, Snowflake, Route } from "lucide-react";
import Tabs from "@/components/ui/Tabs";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import Modal from "@/components/ui/Modal";
import Input from "@/components/ui/Input";
import SearchInput from "@/components/ui/SearchInput";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import ToolForm, { CourierForm } from "@/components/forms/ToolForm";
import ShipmentPanel, { BookShipmentModal } from "@/components/tools/ShipmentPanel";
import RoutePlanner from "@/components/tools/RoutePlanner";
import BookingPanel from "@/components/tools/BookingPanel";
import { useSearchParams } from "react-router-dom";
import { useToolStore } from "@/stores/toolStore";
import { useAuthStore } from "@/stores/authStore";
import { TOOL_CATEGORIES, PRICE_UNITS } from "@/config/constants";
import { apiError, toolAPI } from "@/lib/api";
import { currency, num } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const TABS = [
  { value: "browse", label: "Browse", icon: Wrench },
  { value: "couriers", label: "Couriers", icon: Truck },
  { value: "shipments", label: "Shipments", icon: Package },
  { value: "routes", label: "Routes", icon: Route },
  { value: "bookings", label: "Bookings", icon: CalendarDays },
  { value: "mine", label: "My Listings" },
];

const ICONS = { Warehouse, Truck, Package, Store, Hotel, Wrench, Box, Snowflake };

const unitLabel = (u) => PRICE_UNITS.find((p) => p.value === u)?.label || (u ? `/ ${u.replace("per_", "")}` : "");

export default function ToolsPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get("tab")) ? params.get("tab") : "browse";
  const setTab = (v) => setParams(v === "browse" ? {} : { tab: v }, { replace: true });
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState(() => params.get("search") || "");
  useEffect(() => {
    const query = params.get("search") || "";
    setSearch((current) => current === query ? current : query);
  }, [params]);
  const updateSearch = (value) => {
    setSearch(value);
    const next = new URLSearchParams(params);
    if (value) next.set("search", value);
    else next.delete("search");
    setParams(next, { replace: true });
  };
  const [area, setArea] = useState("");
  const [listing, setListing] = useState(false);
  const [courier, setCourier] = useState(false);
  const [booking, setBooking] = useState(null);
  const [shipping, setShipping] = useState(null); // courier being booked for a parcel
  const [courierOpen, setCourierOpen] = useState(false);
  const me = useAuthStore((s) => s.vendor);
  const { tools, mine, couriers, loading, fetchTools, fetchMine, fetchCouriers, setAvailability } = useToolStore();

  useEffect(() => {
    if (tab === "browse") fetchTools({ category, search }).catch((e) => toast.error(apiError(e)));
    if (tab === "couriers") fetchCouriers({ area }).catch((e) => toast.error(apiError(e)));
    if (tab === "mine") fetchMine().catch((e) => toast.error(apiError(e)));
  }, [tab, category, search, area, fetchTools, fetchCouriers, fetchMine]);

  const toggle = (t) => setAvailability(t.id, !t.is_available).catch((e) => toast.error(apiError(e)));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink-1 tracking-tight">Vendor Tools</h2>
          <p className="text-xs text-ink-4">Shared infrastructure between vendors — warehouse space, transport, couriers, popup shops, hotel sourcing.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" icon={Truck} onClick={() => setCourier(true)}>
            Register courier
          </Button>
          <Button size="sm" icon={Plus} onClick={() => setListing(true)}>
            List a tool
          </Button>
        </div>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "browse" && (
        <>
          <div className="flex flex-col sm:flex-row gap-2">
            <SearchInput value={search} onChange={updateSearch} placeholder="Search tools" className="sm:w-72" />
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              <Chip active={!category} onClick={() => setCategory("")}>
                All
              </Chip>
              {TOOL_CATEGORIES.map((c) => (
                <Chip key={c.value} active={category === c.value} onClick={() => setCategory(category === c.value ? "" : c.value)} icon={c.icon}>
                  {c.label}
                </Chip>
              ))}
            </div>
          </div>
          {loading && tools.length === 0 ? (
            <PageSpinner />
          ) : tools.length === 0 ? (
            <EmptyState icon={Wrench} title="No tools listed here yet" description="Have a spare store, a lorry that runs empty on Tuesdays, or a hotel that needs a supplier? List it." action={<Button size="sm" icon={Plus} onClick={() => setListing(true)}>List a tool</Button>} />
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {tools.map((t) => (
                <ToolCard key={t.id} tool={t} mine={t.vendor_handle === me?.vendor_handle} onBook={setBooking} onToggle={toggle} />
              ))}
            </div>
          )}
        </>
      )}

      {tab === "couriers" && (
        <>
          <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Coverage area, e.g. Eastlands" wrapperClassName="sm:w-72" />
          {couriers.length === 0 ? (
            <EmptyState icon={Truck} title="No couriers registered" description="Boda riders and delivery fleets register here so vendors can route movements through them." action={<Button size="sm" onClick={() => setCourier(true)}>Register as a courier</Button>} />
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {couriers.map((c) => (
                <Card key={c.id} className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-ink-1 truncate">{c.courier_name}</h3>
                      <p className="text-2xs text-ink-4 font-mono">@{c.vendor_handle}{c.registration_number ? ` · ${c.registration_number}` : ""}</p>
                    </div>
                    {c.is_verified && (
                      <Badge variant="brand" size="xs">
                        verified
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(c.coverage_areas || []).map((a) => (
                      <Badge key={a} variant="outline" size="xs">
                        <MapPin size={9} /> {a}
                      </Badge>
                    ))}
                    {(c.service_types || []).map((s) => (
                      <Badge key={s} variant="blue" size="xs">
                        {s}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-auto flex items-center justify-between text-xs text-ink-4 font-mono pt-1">
                    <span>{c.price_per_kg != null ? `${currency(c.price_per_kg)}/kg` : ""}{c.base_rate != null ? ` · base ${currency(c.base_rate)}` : ""}</span>
                    <span className="inline-flex items-center gap-1">
                      <Star size={11} className="text-accent-600 dark:text-accent-400" /> {Number(c.rating || 0).toFixed(1)} · {num(c.total_deliveries || 0)} runs
                    </span>
                  </div>
                  {c.vendor_handle !== me?.vendor_handle && (
                    <Button size="xs" icon={Package} onClick={() => setShipping(c)} className="self-end">
                      Book a delivery
                    </Button>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "shipments" && <ShipmentPanel />}

      {tab === "routes" && <RoutePlanner onRegisterCourier={() => setCourierOpen(true)} />}

      {tab === "bookings" && <BookingPanel />}

      {tab === "mine" &&
        (mine.length === 0 ? (
          <EmptyState icon={Wrench} title="You haven't listed anything" description="Listings you create appear here; toggle availability when they're booked out." />
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {mine.map((t) => (
              <ToolCard key={t.id} tool={t} mine onToggle={toggle} />
            ))}
          </div>
        ))}

      <Modal open={listing} onClose={() => setListing(false)} title="List a tool" description="Priced per unit of time, weight or space — your call.">
        <ToolForm defaultCategory={category || "warehouse"} onDone={() => setListing(false)} onCancel={() => setListing(false)} />
      </Modal>
      <Modal open={courier || courierOpen} onClose={() => { setCourier(false); setCourierOpen(false); }} title="Register a courier service" description="Also listed under Tools → Courier so vendors can find you." size="sm">
        <CourierForm onDone={() => { setCourier(false); setCourierOpen(false); setTab("couriers"); }} onCancel={() => { setCourier(false); setCourierOpen(false); }} />
      </Modal>
      <BookingModal tool={booking} onClose={() => setBooking(null)} />
      <BookShipmentModal courier={shipping} open={!!shipping} onClose={() => setShipping(null)} onDone={() => setTab("shipments")} />
    </div>
  );
}

function ToolCard({ tool: t, mine, onBook, onToggle }) {
  const cat = TOOL_CATEGORIES.find((c) => c.value === t.category);
  const Icon = (cat && ICONS[cat.icon]) || Wrench;
  const bookable = ["warehouse", "cold_storage", "popup_shop", "hotel_sourcing"].includes(t.category);
  return (
    <Card className={cn("flex flex-col gap-3", !t.is_available && "opacity-70")}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-surface-3 border border-edge-1 flex items-center justify-center text-brand-600 dark:text-brand-400 shrink-0">
          <Icon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-ink-1 truncate">{t.title}</h3>
          <p className="text-2xs text-ink-4 truncate">
            {cat?.label} · <span className="text-ink-3">{t.vendor_business}</span> <span className="font-mono">@{t.vendor_handle}</span>
          </p>
        </div>
        {!t.is_available && (
          <Badge variant="gray" size="xs">
            unavailable
          </Badge>
        )}
      </div>
      {t.description && <p className="text-xs text-ink-3 line-clamp-2">{t.description}</p>}
      <div className="flex flex-wrap gap-1">
        {t.location && (
          <Badge variant="outline" size="xs">
            <MapPin size={9} /> {t.location}
          </Badge>
        )}
        {t.capacity?.value != null && (
          <Badge variant="outline" size="xs">
            {num(t.capacity.value)} {t.capacity.unit}
          </Badge>
        )}
        {(t.features || []).slice(0, 3).map((f) => (
          <Badge key={f} variant="gray" size="xs">
            {f}
          </Badge>
        ))}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <div className="text-xs">
          <span className="font-mono text-ink-1">{t.price_per_unit != null ? currency(t.price_per_unit) : "ask"}</span>
          <span className="text-ink-4"> {unitLabel(t.price_unit)}</span>
          {t.times_booked > 0 && <span className="text-2xs text-ink-4"> · {t.times_booked} booked</span>}
        </div>
        {mine ? (
          <Button size="xs" variant={t.is_available ? "ghost" : "secondary"} icon={Power} onClick={() => onToggle(t)}>
            {t.is_available ? "Mark unavailable" : "Make available"}
          </Button>
        ) : bookable ? (
          <Button size="xs" icon={CalendarCheck} onClick={() => onBook(t)} disabled={!t.is_available}>
            Book
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

const BOOKABLE_FIELDS = {
  warehouse: { unit: "sqm", label: "Space needed (sqm)" },
  cold_storage: { unit: "sqm", label: "Space needed (sqm)" },
  popup_shop: { unit: "spaces", label: "Spaces / stalls" },
  hotel_sourcing: { unit: "rooms", label: "Rooms" },
};

function BookingModal({ tool, onClose }) {
  const [form, setForm] = useState({ start: "", end: "", quantity: "", notes: "", guests: "" });
  const [calendar, setCalendar] = useState(null);
  const [busy, setBusy] = useState(false);
  const field = BOOKABLE_FIELDS[tool?.category] || { unit: "units", label: "Quantity" };
  useEffect(() => setForm({ start: "", end: "", quantity: "", notes: "", guests: "" }), [tool?.id]);

  // Paint free capacity for the chosen window before they ask for it.
  useEffect(() => {
    if (!tool || !form.start) return setCalendar(null);
    let live = true;
    toolAPI
      .calendar(tool.id, { from: form.start, to: form.end || form.start })
      .then(({ data }) => live && setCalendar(data))
      .catch(() => live && setCalendar(null));
    return () => {
      live = false;
    };
  }, [tool?.id, form.start, form.end]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.start || !form.end) return toast.error("Pick a start and an end date");
    setBusy(true);
    try {
      const quantity = Number(form.quantity) || 1;
      const details = { space_allocated: { value: quantity, unit: field.unit } };
      if (tool.category === "hotel_sourcing" && form.guests) details.guests = Number(form.guests);
      const res = await toolAPI.book(tool.id, {
        start_date: form.start,
        end_date: form.end,
        quantity,
        unit: field.unit,
        details,
        notes: form.notes || undefined,
      });
      toast.success(res.data?.message || "Booking requested");
      onClose();
    } catch (err) {
      toast.error(apiError(err, "Couldn't book"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!tool}
      onClose={onClose}
      title={tool ? `Book ${tool.title}` : ""}
      description={tool ? `${tool.vendor_business} · ${tool.price_per_unit != null ? currency(tool.price_per_unit) : "price on request"} ${unitLabel(tool.price_unit)}` : ""}
      size="sm"
    >
      {tool && (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="From" type="date" required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
            <Input label="Until (inclusive)" type="date" required min={form.start || undefined} value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
          </div>

          {calendar?.days?.length > 0 && (
            <div className="flex gap-1 overflow-x-auto pb-1">
              {calendar.days.map((d) => (
                <div
                  key={d.date}
                  title={`${d.committed} of ${d.capacity} ${calendar.unit} committed`}
                  className={cn(
                    "shrink-0 rounded-md border px-2 py-1 text-2xs font-mono",
                    d.full ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-400" : d.committed > 0 ? "border-accent-200 dark:border-accent-800 bg-accent-50 dark:bg-accent-500/15 text-accent-600 dark:text-accent-400" : "border-edge-1 bg-surface-1 text-ink-4"
                  )}
                >
                  {d.date.slice(8)} · {d.free} free
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Input label={field.label} type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="1" />
            {tool.category === "hotel_sourcing" && (
              <Input label="Guests" type="number" min="1" value={form.guests} onChange={(e) => setForm({ ...form, guests: e.target.value })} placeholder="2" />
            )}
          </div>
          <Input label="Notes for the host" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Delivery, access, storage needs…" />
          {tool.terms && <p className="text-2xs text-ink-4 rounded-lg bg-surface-1 border border-edge-1 p-2">Terms: {tool.terms}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Request booking
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function Chip({ active, onClick, icon, children }) {
  const Icon = icon ? ICONS[icon] : null;
  return (
    <button onClick={onClick} className={cn("shrink-0 inline-flex items-center gap-1 rounded-full border px-2.5 h-7 text-xs transition-colors", active ? "border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400" : "border-edge-1 bg-surface-1 text-ink-3 hover:border-edge-2 hover:text-ink-1")}>
      {Icon && <Icon size={11} />}
      {children}
    </button>
  );
}
