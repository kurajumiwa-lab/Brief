import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CalendarDays, ImagePlus, MapPin, MessageCircle, Navigation, Send, Users } from "lucide-react";
import Button from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { useAuthStore } from "@/stores/authStore";
import { EVENT_HUB_ENABLED } from "@/config/flags";
import { apiError, eventAPI, eventHubAPI } from "@/lib/api";
import { shortDateTime } from "@/lib/formatters";

const RSVP_STATES = ["registered", "confirmed", "attended"];

/**
 * One event, one page. Everyone sees the details, the RSVP, and the host's public gallery.
 * People who RSVP'd also see the meeting point and can message the host. The host sets the
 * meeting point, uploads photos and answers messages. The server enforces every one of these.
 */
export default function EventHubPage() {
  const { eventId } = useParams();
  const me = useAuthStore((s) => s.vendor);
  const [event, setEvent] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await eventAPI.get(eventId);
      setEvent(data);
      setError(null);
    } catch (err) {
      setError(apiError(err, "This event could not be opened."));
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  if (error) return <p role="alert" className="p-6 text-sm font-medium text-red-600">{error}</p>;
  if (!event) return <PageSpinner label="Opening event…" />;

  const isHost = !!me && event.organizer_id === me.id;
  const isParticipant = isHost || RSVP_STATES.includes(event.my_status);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
          {event.event_type?.replaceAll("_", " ") || "Event"} · {event.status}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-1">{event.title}</h1>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-3">
          <span className="inline-flex items-center gap-1"><CalendarDays size={14} aria-hidden="true" />{shortDateTime(event.start_date)}</span>
          {event.location && <span className="inline-flex items-center gap-1"><MapPin size={14} aria-hidden="true" />{event.location}</span>}
          <span className="inline-flex items-center gap-1"><Users size={14} aria-hidden="true" />{event.spots_left} of {event.max_vendors} spots left</span>
        </p>
        <p className="text-sm text-ink-3">
          Hosted by{" "}
          <Link className="font-medium text-brand-700 hover:underline dark:text-brand-300" to={`/@${event.organizer}`}>
            {event.organizer_business || `@${event.organizer}`}
          </Link>
        </p>
      </header>

      {event.description && (
        <section className="rounded-2xl border border-edge-1 bg-surface-0 p-5 shadow-sm">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{event.description}</p>
        </section>
      )}

      <RsvpCard event={event} isHost={isHost} onChanged={load} />

      {EVENT_HUB_ENABLED && (
        <>
          <MeetingPointCard event={event} isHost={isHost} isParticipant={isParticipant} />
          <MessagesCard event={event} isHost={isHost} isParticipant={isParticipant} />
        </>
      )}

      {EVENT_HUB_ENABLED && <GalleryCard event={event} isHost={isHost} />}
    </div>
  );
}

function RsvpCard({ event, isHost, onChanged }) {
  const [busy, setBusy] = useState(false);
  const rsvped = RSVP_STATES.includes(event.my_status);
  const full = event.spots_left <= 0 && !rsvped;
  const closed = !["upcoming", "active"].includes(event.status);

  async function act(fn, done) {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      await onChanged();
    } catch (err) {
      toast.error(apiError(err, "That did not work. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-edge-1 bg-surface-0 p-5 shadow-sm">
      <div>
        <p className="text-sm font-semibold text-ink-1">{rsvped ? "You're going" : "Will you come?"}</p>
        <p className="text-xs text-ink-3">
          {isHost ? "You are the host." : closed ? "This event is closed." : full ? "This event is full." : "RSVP to see the meeting point and message the host."}
        </p>
      </div>
      {!isHost && !closed && (
        rsvped ? (
          <Button variant="ghost" disabled={busy} onClick={() => act(() => eventAPI.cancelRegistration(event.id), "RSVP cancelled.")}>
            Cancel RSVP
          </Button>
        ) : (
          <Button disabled={busy || full} onClick={() => act(() => eventAPI.register(event.id), "You're going.")}>
            RSVP
          </Button>
        )
      )}
    </section>
  );
}

function MeetingPointCard({ event, isHost, isParticipant }) {
  const [point, setPoint] = useState(undefined); // undefined = not loaded yet
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ label: "", maps_url: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await eventHubAPI.getMeetingPoint(event.id);
      setPoint(data.meeting_point);
    } catch {
      setPoint(null);
    }
  }, [event.id]);

  useEffect(() => { if (isParticipant) load(); }, [isParticipant, load]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await eventHubAPI.setMeetingPoint(event.id, { label: form.label, maps_url: form.maps_url || null });
      setPoint(data.meeting_point);
      setEditing(false);
      toast.success("Meeting point saved.");
    } catch (err) {
      toast.error(apiError(err, "The meeting point could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-edge-1 bg-surface-0 p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-1"><Navigation size={15} aria-hidden="true" />Meeting point</h2>
      {!isParticipant && <p className="text-sm text-ink-3">Shown to people who RSVP.</p>}
      {isParticipant && point === undefined && <p className="text-sm text-ink-3">Loading…</p>}
      {isParticipant && point && !editing && (
        <div className="space-y-2">
          <p className="text-sm text-ink-1">{point.label}</p>
          {point.maps_url && (
            <a href={point.maps_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
              Open in Google Maps
            </a>
          )}
        </div>
      )}
      {isParticipant && !point && !editing && !isHost && <p className="text-sm text-ink-3">The host has not set a meeting point yet.</p>}
      {isHost && !editing && (
        <Button variant="outline" size="sm" onClick={() => { setForm({ label: point?.label || "", maps_url: point?.maps_url || "" }); setEditing(true); }}>
          {point ? "Edit meeting point" : "Set meeting point"}
        </Button>
      )}
      {isHost && editing && (
        <form onSubmit={save} className="space-y-2">
          <input className="block w-full rounded-md border border-edge-2 bg-surface-0 p-2 text-sm text-ink-1" placeholder="Where to meet, e.g. Kisumu Museum gate"
            value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <input className="block w-full rounded-md border border-edge-2 bg-surface-0 p-2 text-sm text-ink-1" placeholder="Google Maps link (optional)"
            value={form.maps_url} onChange={(e) => setForm({ ...form, maps_url: e.target.value })} />
          <span className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>Save</Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
          </span>
        </form>
      )}
    </section>
  );
}

function MessagesCard({ event, isHost, isParticipant }) {
  const [messages, setMessages] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const me = useAuthStore((s) => s.vendor);

  const load = useCallback(async () => {
    try {
      const { data } = await eventHubAPI.messages(event.id);
      setMessages(data.messages);
    } catch {
      setMessages([]);
    }
  }, [event.id]);

  useEffect(() => { if (isParticipant) load(); }, [isParticipant, load]);

  async function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await eventHubAPI.sendMessage(event.id, text.trim());
      setText("");
      await load();
    } catch (err) {
      toast.error(apiError(err, "The message could not be sent."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-edge-1 bg-surface-0 p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-1"><MessageCircle size={15} aria-hidden="true" />Messages with the host</h2>
      {!isParticipant && <p className="text-sm text-ink-3">RSVP to message the host.</p>}
      {isParticipant && messages === null && <p className="text-sm text-ink-3">Loading…</p>}
      {isParticipant && messages && messages.length === 0 && <p className="text-sm text-ink-3">No messages yet.</p>}
      {isParticipant && messages && messages.length > 0 && (
        <ul className="max-h-80 space-y-2 overflow-y-auto">
          {messages.map((m) => {
            const mine = me && m.sender_vendor_id === me.id;
            return (
              <li key={m.id} className={mine ? "ml-auto max-w-[80%] rounded-2xl bg-brand-600 px-3 py-2 text-sm text-white" : "max-w-[80%] rounded-2xl bg-surface-2 px-3 py-2 text-sm text-ink-1"}>
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className={mine ? "mt-1 text-[10px] text-white/70" : "mt-1 text-[10px] text-ink-4"}>{shortDateTime(m.created_at)}</p>
              </li>
            );
          })}
        </ul>
      )}
      {isParticipant && (
        <form onSubmit={send} className="flex gap-2">
          <input className="min-w-0 flex-1 rounded-md border border-edge-2 bg-surface-0 p-2 text-sm text-ink-1"
            placeholder={isHost ? "Reply to attendees" : "Message the host"} maxLength={1000}
            value={text} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" size="sm" disabled={busy || !text.trim()} aria-label="Send message"><Send size={14} aria-hidden="true" /></Button>
        </form>
      )}
    </section>
  );
}

function GalleryCard({ event, isHost }) {
  const [photos, setPhotos] = useState(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await eventHubAPI.gallery(event.id);
      setPhotos(data.photos);
    } catch {
      setPhotos([]);
    }
  }, [event.id]);

  useEffect(() => { load(); }, [load]);

  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      await eventHubAPI.addPhoto(event.id, file, caption.trim() || undefined);
      setCaption("");
      toast.success("Photo added.");
      await load();
    } catch (err) {
      toast.error(apiError(err, "The photo could not be uploaded."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-edge-1 bg-surface-0 p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-ink-1">From past events</h2>
      {photos === null && <p className="text-sm text-ink-3">Loading…</p>}
      {photos && photos.length === 0 && <p className="text-sm text-ink-3">No photos yet.</p>}
      {photos && photos.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((p) => (
            <figure key={p.id} className="overflow-hidden rounded-xl bg-surface-2">
              <img src={p.image_url} alt={p.caption || event.title} loading="lazy" className="aspect-square w-full object-cover" />
              {p.caption && <figcaption className="p-2 text-xs text-ink-3">{p.caption}</figcaption>}
            </figure>
          ))}
        </div>
      )}
      {isHost && (
        <div className="flex flex-wrap items-end gap-2">
          <input className="min-w-[10rem] flex-1 rounded-md border border-edge-2 bg-surface-0 p-2 text-sm text-ink-1" placeholder="Caption (optional)"
            maxLength={300} value={caption} onChange={(e) => setCaption(e.target.value)} />
          <label className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border border-edge-2 px-3 py-2 text-sm font-medium text-ink-1 ${busy ? "opacity-60" : "hover:bg-surface-1"}`}>
            <ImagePlus size={15} aria-hidden="true" />{busy ? "Uploading…" : "Add photo"}
            <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={upload} />
          </label>
        </div>
      )}
    </section>
  );
}
