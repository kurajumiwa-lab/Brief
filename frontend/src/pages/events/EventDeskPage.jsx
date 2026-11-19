import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  CalendarDays, CheckCircle2, ClipboardList, Clock, MapPin, MessageSquare,
  Plus, Send, Store, Wallet, XCircle,
} from "lucide-react";
import Tabs from "@/components/ui/Tabs";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Select from "@/components/ui/Select";
import Modal from "@/components/ui/Modal";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useAuthStore } from "@/stores/authStore";
import { EVENT_VENDOR_CATEGORIES } from "@/config/constants";
import { apiError, eventAPI } from "@/lib/api";
import { eventDeskAPI } from "@/lib/eventDeskApi";
import { formatKes } from "@/lib/receipts";
import { parseApiDate, shortDateTime } from "@/lib/formatters";

const TABS = [
  { value: "open", label: "Open requests" },
  { value: "mine", label: "My requests" },
  { value: "quotes", label: "My quotes" },
];

const PAYERS = [
  { value: "organizer", label: "Organiser pays" },
  { value: "vendor", label: "Business pays (reimburse)" },
  { value: "split", label: "Split" },
  { value: "undecided", label: "Agree in the quote" },
];

const STATUS_BADGE = { open: "brand", closed: "gray", awarded: "blue", cancelled: "red", submitted: "amber", shortlisted: "purple", accepted: "brand", declined: "gray", withdrawn: "gray" };
const labelFor = (value) => EVENT_VENDOR_CATEGORIES.find((c) => c.value === value)?.label || value;

const toLocalInput = (date) => {
  if (!date || Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const deadlineFor = (event) => {
  if (!event?.start_date) return "";
  const start = parseApiDate(event.start_date)?.getTime();
  if (!start) return "";
  const target = Math.min(Date.now() + 7 * 86400000, start - 3600000);
  return target > Date.now() ? toLocalInput(new Date(target)) : "";
};

const splitList = (value) => String(value || "").split(",").map((v) => v.trim()).filter(Boolean);

const emptyPost = () => ({
  event_id: "", title: "", category: "decor", brief: "",
  budget_min_kes: "", budget_max_kes: "", payer: "organizer",
  access_time: "", power: "", parking: "", setup: "", notes: "",
  response_deadline: "",
});

const emptyQuote = () => ({ amount_kes: "", package_id: "", message: "", inclusions: "", valid_until: "" });

/**
 * The event vendor desk. One page, two sides of the same commitment:
 * an organiser broadcasts and accepts; a vendor quotes from a rate card.
 * Money is never collected here — accepting a quote only opens contact details.
 */
export default function EventDeskPage() {
  const me = useAuthStore((s) => s.vendor);
  const [params] = useSearchParams();
  const [tab, setTab] = useState("open");
  const [category, setCategory] = useState(params.get("category") || "");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState([]);
  const [mine, setMine] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [rateCard, setRateCard] = useState(null);

  const [posting, setPosting] = useState(false);
  const [postForm, setPostForm] = useState(emptyPost);
  const [myEvents, setMyEvents] = useState([]);
  const [postBusy, setPostBusy] = useState(false);

  const [quoteFor, setQuoteFor] = useState(null);
  const [quoteForm, setQuoteForm] = useState(emptyQuote);
  const [quoteBusy, setQuoteBusy] = useState(false);

  const [detail, setDetail] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const [board, own, myQuotes, card] = await Promise.all([
        eventDeskAPI.openRequests({ category, q: query }),
        eventDeskAPI.myRequests(),
        eventDeskAPI.myQuotes(),
        eventDeskAPI.myRateCard(),
      ]);
      setOpen(board.data.requests || []);
      setMine(own.data.requests || []);
      setQuotes(myQuotes.data.quotes || []);
      setRateCard(card.data.rate_card || null);
    } catch (error) {
      toast.error(apiError(error, "Could not load the event desk"));
    } finally {
      setLoading(false);
    }
  }, [category, query]);

  useEffect(() => { load(true); }, [load]);

  const organised = useMemo(() => {
    const now = Date.now();
    return myEvents.filter((event) => event.organizer_id === me?.id
      && !["completed", "cancelled"].includes(event.status)
      && (parseApiDate(event.start_date)?.getTime() || 0) > now);
  }, [myEvents, me?.id]);

  const activePackages = useMemo(() => (rateCard?.packages || []).filter((p) => p.is_active !== false), [rateCard]);

  const openPost = async () => {
    setPostForm(emptyPost());
    setPosting(true);
    try {
      const { data } = await eventAPI.mine();
      setMyEvents(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error(apiError(error, "Could not load your events"));
    }
  };

  const chooseEvent = (eventId) => {
    const event = myEvents.find((e) => e.id === eventId);
    setPostForm((form) => ({
      ...form,
      event_id: eventId,
      title: event ? `${labelFor(form.category)} for ${event.title}` : form.title,
      response_deadline: event ? deadlineFor(event) : form.response_deadline,
    }));
  };

  const submitPost = async () => {
    if (!postForm.event_id) return toast.error("Choose one of your events");
    if (!postForm.title.trim()) return toast.error("Name the job you need done");
    if (!postForm.response_deadline) return toast.error("Set a response deadline before the event starts");
    setPostBusy(true);
    try {
      await eventDeskAPI.createRequest(postForm.event_id, {
        title: postForm.title.trim(),
        category: postForm.category,
        brief: postForm.brief.trim(),
        budget_min_kes: Number(postForm.budget_min_kes) || 0,
        budget_max_kes: Number(postForm.budget_max_kes) || 0,
        payer: postForm.payer,
        requirements: {
          access_time: postForm.access_time, power: postForm.power,
          parking: postForm.parking, setup: postForm.setup, notes: postForm.notes,
        },
        response_deadline: new Date(postForm.response_deadline).toISOString(),
      });
      toast.success("Request broadcast to the event desk");
      setPosting(false);
      setTab("mine");
      await load();
    } catch (error) {
      toast.error(apiError(error, "Could not broadcast the request"));
    } finally {
      setPostBusy(false);
    }
  };

  const openQuote = (request) => {
    const existing = request.my_quote;
    setQuoteForm({
      amount_kes: existing?.amount_kes ? String(existing.amount_kes) : "",
      package_id: existing?.package_id || "",
      message: existing?.message || "",
      inclusions: (existing?.inclusions || []).join(", "),
      valid_until: "",
    });
    setQuoteFor(request);
  };

  const choosePackage = (packageId) => {
    const pack = activePackages.find((p) => p.id === packageId);
    setQuoteForm((form) => ({
      ...form,
      package_id: packageId,
      amount_kes: pack ? String(pack.price_kes) : form.amount_kes,
      inclusions: pack && !form.inclusions ? (pack.inclusions || []).join(", ") : form.inclusions,
    }));
  };

  const submitQuote = async () => {
    const amount = Number(quoteForm.amount_kes);
    if (!amount || amount < 1) return toast.error("Enter the amount you are quoting");
    setQuoteBusy(true);
    try {
      await eventDeskAPI.submitQuote(quoteFor.id, {
        amount_kes: amount,
        package_id: quoteForm.package_id || null,
        message: quoteForm.message.trim(),
        inclusions: splitList(quoteForm.inclusions),
        valid_until: quoteForm.valid_until ? new Date(quoteForm.valid_until).toISOString() : null,
      });
      toast.success(quoteFor.my_quote ? "Quote updated" : "Quote submitted");
      setQuoteFor(null);
      await load();
    } catch (error) {
      toast.error(apiError(error, "Could not submit the quote"));
    } finally {
      setQuoteBusy(false);
    }
  };

  const openDetail = async (requestId) => {
    setDetailBusy(true);
    try {
      const { data } = await eventDeskAPI.request(requestId);
      setDetail(data);
    } catch (error) {
      toast.error(apiError(error, "Could not open that request"));
    } finally {
      setDetailBusy(false);
    }
  };

  const decide = async (quote, status) => {
    if (status === "accepted") {
      const ok = await confirm({
        title: "Accept this quote?",
        message: `${quote.vendor?.business_name} · ${formatKes(quote.amount_kes)}. The other quotes will be declined and contact details will open. Payment is still arranged directly.`,
        confirmLabel: "Accept and book",
      });
      if (!ok) return;
    }
    if (status === "declined") {
      const ok = await confirm({ title: "Decline this quote?", message: quote.vendor?.business_name, confirmLabel: "Decline", danger: true });
      if (!ok) return;
    }
    try {
      await eventDeskAPI.setQuoteStatus(quote.id, status);
      toast.success(status === "accepted" ? "Quote accepted — contact details are open" : `Quote ${status}`);
      await openDetail(detail.id);
      await load();
    } catch (error) {
      toast.error(apiError(error));
    }
  };

  const closeRequest = async () => {
    const ok = await confirm({
      title: "Close this request?", message: "Businesses can no longer quote. Existing quotes stay on the record.",
      confirmLabel: "Close request", danger: true,
    });
    if (!ok) return;
    try {
      await eventDeskAPI.setRequestStatus(detail.id, "closed");
      toast.success("Request closed");
      setDetail(null);
      await load();
    } catch (error) {
      toast.error(apiError(error));
    }
  };

  const withdraw = async (quote) => {
    const ok = await confirm({ title: "Withdraw this quote?", message: "The organiser will see it as withdrawn.", confirmLabel: "Withdraw", danger: true });
    if (!ok) return;
    try {
      await eventDeskAPI.setQuoteStatus(quote.id, "withdrawn");
      toast.success("Quote withdrawn");
      await load();
    } catch (error) {
      toast.error(apiError(error));
    }
  };

  const header = (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
      <div>
        <p className="text-2xs font-semibold uppercase tracking-wider text-brand-600">The event desk</p>
        <h2 className="text-xl font-semibold text-ink-1 tracking-tight">Plan an event in 3 steps</h2>
        <p className="text-xs text-ink-4 mt-1">Post what the day needs. Compare quotes. Accept one and agree payment directly.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button as={Link} to="/rate-card" size="sm" variant="secondary" icon={Store}>My rate card</Button>
        <Button size="sm" icon={Plus} onClick={openPost}>Post a request</Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {header}

      <div className="grid sm:grid-cols-3 gap-2">
        <Step number="1" title="Pick your event" text="One of your own events, with a date and a place." />
        <Step number="2" title="Say what the day needs" text="Category, budget band, access, power and parking." />
        <Step number="3" title="Accept one quote" text="The booking is recorded. Contacts open; money stays direct." />
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "open" && (
        <div className="grid sm:grid-cols-[12rem_1fr] gap-2">
          <Select value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Any category"
                  options={EVENT_VENDOR_CATEGORIES} />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search requests, events or locations" />
        </div>
      )}

      {loading ? (
        <PageSpinner />
      ) : tab === "open" ? (
        open.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No open requests" description="When an organiser broadcasts a job, it lands here." />
        ) : (
          <div className="grid lg:grid-cols-2 gap-3">
            {open.map((request) => (
              <Card key={request.id} className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" size="xs">{labelFor(request.category)}</Badge>
                      {request.my_quote && <Badge variant={STATUS_BADGE[request.my_quote.status] || "gray"} size="xs">Your quote: {request.my_quote.status}</Badge>}
                    </div>
                    <h3 className="text-sm font-semibold text-ink-1 mt-1.5 leading-snug">{request.title}</h3>
                    <p className="text-2xs text-ink-4 mt-0.5">{request.event?.title} · {request.organizer?.business_name}</p>
                  </div>
                  <Badge variant="gray" size="xs">{request.quote_count} quote{request.quote_count === 1 ? "" : "s"}</Badge>
                </div>
                <p className="text-xs text-ink-3 line-clamp-2">{request.brief || "The brief is in the requirements."}</p>
                <div className="grid grid-cols-2 gap-2 text-2xs text-ink-4">
                  <span className="inline-flex items-center gap-1"><CalendarDays size={11} /> {shortDateTime(request.event?.start_date)}</span>
                  <span className="inline-flex items-center gap-1"><MapPin size={11} /> {request.event?.location || "Location not set"}</span>
                  <span className="inline-flex items-center gap-1"><Wallet size={11} /> {budgetLabel(request)}</span>
                  <span className="inline-flex items-center gap-1"><Clock size={11} /> closes {shortDateTime(request.response_deadline)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <Link to={`/event/${request.event?.id}`} className="text-2xs text-ink-4 hover:text-brand-600">
                    Event details · @{request.organizer?.handle}
                  </Link>
                  <Button size="sm" icon={Send} disabled={!request.can_quote} onClick={() => openQuote(request)}>
                    {request.my_quote ? "Update quote" : "Quote"}
                  </Button>
                </div>
                {!request.can_quote && <p className="text-micro text-ink-4">This request is closed, past its deadline, or yours.</p>}
              </Card>
            ))}
          </div>
        )
      ) : tab === "mine" ? (
        mine.length === 0 ? (
          <EmptyState icon={ClipboardList} title="You have not broadcast a request"
                      description="Start with the event you are already planning. A structured brief gets a real quote."
                      action={<Button size="sm" icon={Plus} onClick={openPost}>Post a request</Button>} />
        ) : (
          <div className="grid lg:grid-cols-2 gap-3">
            {mine.map((request) => (
              <Card key={request.id} className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-2xs text-ink-4">{labelFor(request.category)} · {request.event?.title}</p>
                    <h3 className="text-sm font-semibold text-ink-1 mt-0.5">{request.title}</h3>
                  </div>
                  <Badge variant={STATUS_BADGE[request.status] || "gray"} size="xs">{request.status}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-4">
                  <span>{budgetLabel(request)}</span>
                  <span>closes {shortDateTime(request.response_deadline)}</span>
                  <span>{request.quote_count} quote{request.quote_count === 1 ? "" : "s"}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Link to={`/event/${request.event?.id}`} className="text-2xs text-ink-4 hover:text-brand-600">Open event</Link>
                  <Button size="sm" variant="secondary" icon={MessageSquare} onClick={() => openDetail(request.id)}>
                    View quotes
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : quotes.length === 0 ? (
        <EmptyState icon={Send} title="No quotes yet" description="Open requests show what the day needs. Answer one with a package."
                    action={<Button size="sm" onClick={() => setTab("open")}>Browse requests</Button>} />
      ) : (
        <div className="grid lg:grid-cols-2 gap-3">
          {quotes.map((quote) => (
            <Card key={quote.id} className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-2xs text-ink-4">{labelFor(quote.request?.category)} · {quote.event?.title}</p>
                  <h3 className="text-sm font-semibold text-ink-1 mt-0.5">{quote.request?.title}</h3>
                </div>
                <Badge variant={STATUS_BADGE[quote.status] || "gray"} size="xs">{quote.status}</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-4">
                <span className="font-semibold text-ink-1">{formatKes(quote.amount_kes)}</span>
                <span>{quote.organizer?.business_name}</span>
                <span>{shortDateTime(quote.event?.start_date)}</span>
              </div>
              {quote.organizer_contact && (
                <p className="rounded-lg bg-brand-50 dark:bg-brand-500/10 p-2 text-2xs text-brand-700 dark:text-brand-300">
                  Booked. Contact {quote.organizer_contact.business_name}: {quote.organizer_contact.phone || quote.organizer_contact.email}
                </p>
              )}
              <div className="flex items-center justify-between gap-2">
                <Link to={`/event/${quote.event?.id}`} className="text-2xs text-ink-4 hover:text-brand-600">Open event</Link>
                {["submitted", "shortlisted"].includes(quote.status) && (
                  <Button size="xs" variant="dangerGhost" onClick={() => withdraw(quote)}>Withdraw</Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-edge-1 bg-surface-1 p-4 text-xs text-ink-3">
        <p className="font-semibold text-ink-1">No money is held by the platform.</p>
        <p className="mt-0.5">A quote is a price. An accepted quote is a booking. The two parties agree payment directly; the desk keeps the record.</p>
      </div>

      <Modal open={posting} onClose={() => setPosting(false)} title="Post a service request" size="lg"
             description="Three steps: choose the event, say what the day needs, set a deadline."
             footer={<><Button variant="ghost" size="sm" onClick={() => setPosting(false)}>Cancel</Button>
               <Button size="sm" onClick={submitPost} loading={postBusy} icon={Send}>Broadcast request</Button></>}>
        <div className="space-y-3">
          <Select label="Which event?" value={postForm.event_id} onChange={(e) => chooseEvent(e.target.value)}
                  placeholder={organised.length ? "Choose one of your events" : "You have no upcoming events"}
                  options={organised.map((event) => ({ value: event.id, label: `${event.title} · ${shortDateTime(event.start_date)}` }))} />
          {organised.length === 0 && (
            <p className="text-xs text-ink-3">
              A request must attach to one of your own events. <Link to="/events" className="text-brand-600 hover:underline">Create an event first</Link>.
            </p>
          )}
          <div className="grid sm:grid-cols-2 gap-2">
            <Input label="Job title" value={postForm.title} onChange={(e) => setPostForm({ ...postForm, title: e.target.value })}
                   placeholder="Decor and lighting" maxLength={200} />
            <Select label="Category" value={postForm.category} options={EVENT_VENDOR_CATEGORIES}
                    onChange={(e) => setPostForm({ ...postForm, category: e.target.value })} />
          </div>
          <Textarea label="Brief" rows={3} value={postForm.brief} maxLength={4000}
                    onChange={(e) => setPostForm({ ...postForm, brief: e.target.value })}
                    placeholder="What must be ready, for how many people, and by when?" />
          <div className="grid sm:grid-cols-3 gap-2">
            <Input label="Budget from (KES)" type="number" min="0" value={postForm.budget_min_kes}
                   onChange={(e) => setPostForm({ ...postForm, budget_min_kes: e.target.value })} placeholder="90000" />
            <Input label="Budget to (KES)" type="number" min="0" value={postForm.budget_max_kes}
                   onChange={(e) => setPostForm({ ...postForm, budget_max_kes: e.target.value })} placeholder="140000" />
            <Select label="Who pays?" value={postForm.payer} options={PAYERS}
                    onChange={(e) => setPostForm({ ...postForm, payer: e.target.value })} />
          </div>
          <Input label="Response deadline" type="datetime-local" value={postForm.response_deadline}
                 onChange={(e) => setPostForm({ ...postForm, response_deadline: e.target.value })}
                 hint="Must be before the event starts." />
          <div className="grid sm:grid-cols-2 gap-2">
            <Input label="Access time" value={postForm.access_time} onChange={(e) => setPostForm({ ...postForm, access_time: e.target.value })} placeholder="From 6:00am" />
            <Input label="Power" value={postForm.power} onChange={(e) => setPostForm({ ...postForm, power: e.target.value })} placeholder="One 13A socket" />
            <Input label="Parking" value={postForm.parking} onChange={(e) => setPostForm({ ...postForm, parking: e.target.value })} placeholder="Two vans inside" />
            <Input label="Setup constraint" value={postForm.setup} onChange={(e) => setPostForm({ ...postForm, setup: e.target.value })} placeholder="No drilling" />
          </div>
          <Input label="Anything else" value={postForm.notes} onChange={(e) => setPostForm({ ...postForm, notes: e.target.value })} placeholder="The ceremony starts at 11am" />
        </div>
      </Modal>

      <Modal open={!!quoteFor} onClose={() => setQuoteFor(null)} title="Respond with a quote" size="md"
             description={quoteFor ? `${quoteFor.title} · ${quoteFor.event?.title}` : ""}
             footer={<><Button variant="ghost" size="sm" onClick={() => setQuoteFor(null)}>Cancel</Button>
               <Button size="sm" onClick={submitQuote} loading={quoteBusy} icon={Send}>{quoteFor?.my_quote ? "Update quote" : "Send quote"}</Button></>}>
        {quoteFor && (
          <div className="space-y-3">
            <div className="rounded-xl bg-surface-2 p-3 text-xs text-ink-3">
              <p><span className="font-semibold text-ink-1">Budget:</span> {budgetLabel(quoteFor)} · closes {shortDateTime(quoteFor.response_deadline)}</p>
              <p className="mt-1">{quoteFor.brief || "The organiser left the brief in the requirements."}</p>
              {quoteFor.requirements?.access_time && <p className="mt-1">Access: {quoteFor.requirements.access_time}</p>}
            </div>
            {activePackages.length > 0 ? (
              <Select label="Start from a rate-card package (optional)" value={quoteForm.package_id}
                      onChange={(e) => choosePackage(e.target.value)} placeholder="No package — custom quote"
                      options={activePackages.map((pack) => ({ value: pack.id, label: `${pack.name} · ${formatKes(pack.price_kes)}` }))} />
            ) : (
              <p className="text-xs text-ink-3 rounded-lg border border-edge-1 p-2">
                No active packages on your rate card yet. <Link to="/rate-card" className="text-brand-600 hover:underline">Build one</Link> to quote faster.
              </p>
            )}
            <Input label="Your price (KES)" type="number" min="1" value={quoteForm.amount_kes}
                   onChange={(e) => setQuoteForm({ ...quoteForm, amount_kes: e.target.value })} placeholder="105000" />
            <Input label="What is included" value={quoteForm.inclusions}
                   onChange={(e) => setQuoteForm({ ...quoteForm, inclusions: e.target.value })}
                   placeholder="Arch, aisle flowers, delivery" hint="Separate items with commas." />
            <Textarea label="Message to the organiser" rows={3} value={quoteForm.message} maxLength={2000}
                      onChange={(e) => setQuoteForm({ ...quoteForm, message: e.target.value })}
                      placeholder="Why your crew fits this day, and any condition the price depends on." />
            <Input label="Quote valid until (optional)" type="datetime-local" value={quoteForm.valid_until}
                   onChange={(e) => setQuoteForm({ ...quoteForm, valid_until: e.target.value })} />
            <p className="text-micro text-ink-4">Sending a quote does not take payment. The organiser accepts one quote and contacts you directly.</p>
          </div>
        )}
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Quotes for this request" size="lg"
             description={detail ? `${detail.title} · ${detail.event?.title}` : ""}>
        {detail && (
          <div className="space-y-3">
            <div className="rounded-xl bg-surface-2 p-3 text-xs text-ink-3">
              <p><span className="font-semibold text-ink-1">Budget:</span> {budgetLabel(detail)} · <span className="font-semibold text-ink-1">Closes:</span> {shortDateTime(detail.response_deadline)}</p>
              {detail.brief && <p className="mt-1">{detail.brief}</p>}
              <p className="mt-1">{detail.requirements?.access_time && <>Access: {detail.requirements.access_time}. </>}
                {detail.requirements?.parking && <>Parking: {detail.requirements.parking}. </>}
                {detail.requirements?.power && <>Power: {detail.requirements.power}.</>}</p>
            </div>
            {(detail.quotes || []).length === 0 ? (
              <p className="text-sm text-ink-4">No quotes yet. Businesses see the request on their board.</p>
            ) : (
              detail.quotes.map((quote) => (
                <div key={quote.id} className="rounded-xl border border-edge-1 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-ink-1">{quote.vendor?.business_name}</p>
                      <p className="text-2xs text-ink-4">@{quote.vendor?.handle}{quote.package_name ? ` · ${quote.package_name}` : ""}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-ink-1">{formatKes(quote.amount_kes)}</p>
                      <Badge variant={STATUS_BADGE[quote.status] || "gray"} size="xs">{quote.status}</Badge>
                    </div>
                  </div>
                  {quote.message && <p className="text-xs text-ink-3">{quote.message}</p>}
                  {(quote.inclusions || []).length > 0 && (
                    <p className="text-2xs text-ink-4">Includes: {quote.inclusions.join(", ")}</p>
                  )}
                  {quote.vendor_contact && (
                    <p className="rounded-lg bg-brand-50 dark:bg-brand-500/10 p-2 text-2xs text-brand-700 dark:text-brand-300">
                      Booked. Contact {quote.vendor_contact.business_name}: {quote.vendor_contact.phone || quote.vendor_contact.email}
                    </p>
                  )}
                  {detail.status === "open" && ["submitted", "shortlisted"].includes(quote.status) && (
                    <div className="flex flex-wrap gap-1.5">
                      {quote.status === "submitted" && <Button size="xs" variant="secondary" onClick={() => decide(quote, "shortlisted")}>Shortlist</Button>}
                      <Button size="xs" onClick={() => decide(quote, "accepted")} icon={CheckCircle2}>Accept & book</Button>
                      <Button size="xs" variant="ghost" onClick={() => decide(quote, "declined")} icon={XCircle}>Decline</Button>
                    </div>
                  )}
                </div>
              ))
            )}
            <div className="flex items-center justify-between gap-2 pt-1">
              <Link to={`/event/${detail.event?.id}`} className="text-2xs text-ink-4 hover:text-brand-600">Open event</Link>
              {detail.status === "open" && <Button size="xs" variant="dangerGhost" onClick={closeRequest}>Close request</Button>}
            </div>
            <p className="text-micro text-ink-4">Accepting one quote records the booking and opens contact details. Payment is direct between the two parties.</p>
          </div>
        )}
      </Modal>

      {detailBusy && <div className="text-xs text-ink-4 text-center">Opening quotes…</div>}
    </div>
  );
}

function budgetLabel(request) {
  const min = Number(request.budget_min_kes) || 0;
  const max = Number(request.budget_max_kes) || 0;
  if (!min && !max) return "Budget open";
  if (!max) return `From ${formatKes(min)}`;
  if (!min) return `Up to ${formatKes(max)}`;
  return `${formatKes(min)} – ${formatKes(max)}`;
}

function Step({ number, title, text }) {
  return (
    <div className="rounded-xl border border-edge-1 bg-surface-1 p-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-50 text-2xs font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">{number}</span>
        <p className="text-xs font-semibold text-ink-1">{title}</p>
      </div>
      <p className="text-2xs text-ink-4 mt-1">{text}</p>
    </div>
  );
}
