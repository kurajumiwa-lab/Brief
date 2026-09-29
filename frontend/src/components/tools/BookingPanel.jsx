import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Hotel, Store, Warehouse, X } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Tabs from "@/components/ui/Tabs";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { toolAPI, apiError } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { currency, dayLabel, shortDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const STATUS_BADGE = { requested: "amber", confirmed: "brand", declined: "gray", cancelled: "gray", completed: "blue" };
const KIND_ICON = { warehouse: Warehouse, popup_shop: Store, hotel_sourcing: Hotel };
const KIND_LABEL = { warehouse: "warehouse space", popup_shop: "pop-up shop", hotel_sourcing: "hotel sourcing" };

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Dated tool bookings and their availability calendars (v2.1 §5.2–5.4):
 * warehouse space, pop-up shops and hotel sourcing all share one calendar, so
 * the host confirms or declines, the booker cancels, and both can read free
 * capacity day by day before they ask.
 */
export default function BookingPanel() {
  const me = useAuthStore((s) => s.vendor);
  const confirm = useConfirm();
  const [tab, setTab] = useState("bookings");
  const [bookings, setBookings] = useState([]);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [calendar, setCalendar] = useState(null);
  const [calendarListing, setCalendarListing] = useState(null);
  const [from, setFrom] = useState(today());

  const loadBookings = async () => {
    setLoading(true);
    try {
      const { data } = await toolAPI.bookings("all");
      setBookings(data);
    } catch (e) {
      toast.error(apiError(e, "Couldn't load bookings"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBookings();
    toolAPI
      .mine()
      .then(({ data }) => setListings(data.filter((t) => ["warehouse", "cold_storage", "popup_shop", "hotel_sourcing"].includes(t.category))))
      .catch(() => setListings([]));
  }, []);

  const loadCalendar = async (listing, start = from) => {
    setCalendarListing(listing);
    setCalendar(null);
    try {
      const { data } = await toolAPI.calendar(listing.id, { from: start, days: 14 });
      setCalendar(data);
    } catch (e) {
      toast.error(apiError(e, "Couldn't read the calendar"));
    }
  };

  const host = (b) => b.host_handle === me?.vendor_handle;
  const act = async (booking, status, note) => {
    if (status === "cancelled" && !(await confirm({ title: "Cancel this booking?", message: "The dates are freed for other vendors immediately.", confirmLabel: "Cancel booking", danger: true }))) return;
    try {
      const { data } = await toolAPI.setBookingStatus(booking.id, status, note);
      toast.success(data.message || `Booking ${status}`);
      loadBookings();
      if (calendarListing) loadCalendar(calendarListing, from);
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const incoming = useMemo(() => bookings.filter((b) => host(b) && b.status === "requested"), [bookings, me?.vendor_handle]);
  const mineBooking = useMemo(() => bookings.filter((b) => !host(b)), [bookings, me?.vendor_handle]);

  return (
    <div className="space-y-3">
      <Tabs
        size="sm"
        variant="pill"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "bookings", label: "Bookings", icon: CalendarDays, count: incoming.length || undefined },
          { value: "calendar", label: "Availability", icon: Warehouse },
        ]}
      />

      {tab === "bookings" &&
        (loading && bookings.length === 0 ? (
          <PageSpinner />
        ) : bookings.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="No bookings yet"
            description="Ask a warehouse, pop-up or hotel for a window from Tools → Browse; hosts see requests here."
          />
        ) : (
          <div className="space-y-4">
            {incoming.length > 0 && (
              <section className="space-y-2">
                <p className="text-2xs uppercase tracking-wider text-ink-4">Waiting on you</p>
                {incoming.map((b) => (
                  <BookingRow key={b.id} booking={b} isHost onAct={act} />
                ))}
              </section>
            )}
            {mineBooking.length > 0 && (
              <section className="space-y-2">
                <p className="text-2xs uppercase tracking-wider text-ink-4">Your requests</p>
                {mineBooking.map((b) => (
                  <BookingRow key={b.id} booking={b} onAct={act} />
                ))}
              </section>
            )}
            {bookings.filter((b) => host(b) && b.status !== "requested").length > 0 && (
              <section className="space-y-2">
                <p className="text-2xs uppercase tracking-wider text-ink-4">Hosting</p>
                {bookings.filter((b) => host(b) && b.status !== "requested").map((b) => (
                  <BookingRow key={b.id} booking={b} isHost onAct={act} />
                ))}
              </section>
            )}
          </div>
        ))}

      {tab === "calendar" &&
        (listings.length === 0 ? (
          <EmptyState
            icon={Warehouse}
            title="Nothing of yours has a calendar"
            description="Warehouses, cold rooms, pop-up spaces and hotel rooms you list get a day-by-day calendar here."
          />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={calendarListing?.id || ""}
                onChange={(e) => {
                  const listing = listings.find((l) => l.id === e.target.value);
                  if (listing) loadCalendar(listing, from);
                }}
                className="h-9 rounded-lg border border-edge-2 bg-surface-1 px-3 text-sm text-ink-1 focus:outline-none focus:border-brand-500"
                aria-label="Choose a listing"
              >
                <option value="">Pick a listing…</option>
                {listings.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title} — {KIND_LABEL[l.category] || l.category}
                  </option>
                ))}
              </select>
              {calendarListing && (
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" icon={ChevronLeft} aria-label="Previous fortnight" onClick={() => { const next = addDays(from, -14); setFrom(next); loadCalendar(calendarListing, next); }} />
                  <span className="text-xs text-ink-4 font-mono px-1">{shortDate(from)}</span>
                  <Button size="icon" variant="ghost" icon={ChevronRight} aria-label="Next fortnight" onClick={() => { const next = addDays(from, 14); setFrom(next); loadCalendar(calendarListing, next); }} />
                </div>
              )}
            </div>

            {calendarListing && !calendar ? (
              <PageSpinner />
            ) : calendar ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-4">
                  <Badge variant="outline" size="xs">{calendar.kind} · {calendar.unit}</Badge>
                  <span>capacity {calendar.capacity} / day</span>
                  <span>· {calendar.location}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                  {calendar.days.map((d) => (
                    <div
                      key={d.date}
                      className={cn(
                        "rounded-lg border p-2.5 space-y-1",
                        d.full ? "border-red-900/60 bg-red-950/20" : d.committed > 0 ? "border-amber-900/50 bg-amber-950/10" : "border-edge-1 bg-surface-1"
                      )}
                    >
                      <p className="text-2xs text-ink-4">{dayLabel(d.date)}</p>
                      <p className="text-sm font-mono text-ink-1">
                        {d.free}
                        <span className="text-2xs text-ink-4"> / {d.capacity} free</span>
                      </p>
                      <div className="h-1 rounded-full bg-surface-3 overflow-hidden">
                        <div className={cn("h-full rounded-full", d.full ? "bg-red-500/70" : "bg-brand-600")} style={{ width: `${d.capacity ? (100 * d.committed) / d.capacity : 0}%` }} />
                      </div>
                      {d.my_quantity > 0 && <p className="text-2xs text-brand-300 font-mono">yours: {d.my_quantity}</p>}
                    </div>
                  ))}
                </div>
                <p className="text-2xs text-ink-4">
                  Committed days include requested bookings while the host decides — {calendar.mine?.length || 0} of yours in this window.
                </p>
              </>
            ) : (
              <p className="text-xs text-ink-4">Pick a listing to see its fortnight.</p>
            )}
          </div>
        ))}
    </div>
  );
}

function BookingRow({ booking: b, isHost, onAct }) {
  const Icon = KIND_ICON[b.kind] || CalendarDays;
  const active = ["requested", "confirmed"].includes(b.status);
  return (
    <Card className="flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <div className="w-9 h-9 rounded-lg bg-surface-3 border border-edge-1 flex items-center justify-center text-brand-300 shrink-0">
          <Icon size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-1 truncate">{b.tool.title}</p>
          <p className="text-2xs text-ink-4">
            {shortDate(b.start_date)} → {shortDate(b.end_date)} · {b.quantity} {b.unit}
            {b.estimated_cost ? ` · ${currency(b.estimated_cost)}` : ""} · {isHost ? `@${b.booker_handle}` : `@${b.host_handle}`}
          </p>
          {b.notes && <p className="text-2xs text-ink-4 mt-0.5 truncate">“{b.notes}”</p>}
          {b.decision_note && <p className="text-2xs text-brand-300 mt-0.5">host: {b.decision_note}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant={STATUS_BADGE[b.status] || "gray"} size="xs">
          {b.status}
        </Badge>
        {active && !isHost && (
          <Button size="xs" variant="ghost" icon={X} onClick={() => onAct(b, "cancelled")}>
            Cancel
          </Button>
        )}
        {b.status === "requested" && isHost && (
          <>
            <Button size="xs" variant="secondary" icon={X} onClick={() => onAct(b, "declined")}>
              Decline
            </Button>
            <Button size="xs" icon={Check} onClick={() => onAct(b, "confirmed")}>
              Confirm
            </Button>
          </>
        )}
        {b.status === "confirmed" && isHost && (
          <Button size="xs" variant="secondary" icon={Check} onClick={() => onAct(b, "completed")}>
            Complete
          </Button>
        )}
      </div>
    </Card>
  );
}
