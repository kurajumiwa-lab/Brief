import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Textarea from "@/components/ui/Textarea";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { knowledgeAPI, apiError } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

const KIND_LABEL = { seminar: "Seminar", course: "Course", mentor_session: "Mentor session" };

export default function LearnDetailPage() {
  const { id } = useParams();
  const signedIn = useAuthStore((s) => !!s.vendor);
  const [item, setItem] = useState(null);
  const [me, setMe] = useState(null);
  const [attendees, setAttendees] = useState(null);
  const [error, setError] = useState(null);
  const [review, setReview] = useState({ rating: 5, comment: "" });
  const [delivered, setDelivered] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await knowledgeAPI.listing(id);
      setItem(data);
      setError(null);
      if (signedIn) {
        const state = await knowledgeAPI.me(id);
        setMe(state.data);
        if (state.data.is_organiser) {
          const a = await knowledgeAPI.attendees(id);
          setAttendees(a.data.attendees);
        }
      }
    } catch (err) {
      setError(apiError(err, "This listing is not available"));
    }
  }, [id, signedIn]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn, ok) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch (err) {
      toast.error(apiError(err, "That did not work"));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p role="alert" className="p-6 text-sm text-red-600">{error}</p>;
  if (!item) return <PageSpinner />;

  const isOrganiser = !!me?.is_organiser;
  const canDeliver = isOrganiser && item.status === "published" &&
    (!item.starts_at || new Date(item.starts_at) <= new Date());

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      <Link to="/learn" className="text-sm font-medium text-brand-700 underline">← All sessions</Link>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="blue">{KIND_LABEL[item.kind]}</Badge>
          <Badge variant={item.status === "completed" ? "brand" : "gray"}>
            {item.status === "completed" ? "Delivered record" : item.status === "cancelled" ? "Cancelled" : "Promised"}
          </Badge>
          {item.organiser.verified && <Badge variant="blue">Verified host</Badge>}
        </div>
        <h1 className="text-lg font-semibold text-ink-1">{item.title}</h1>
        <p className="text-xs text-ink-3">
          Hosted by {item.organiser.name}
          {item.starts_at ? ` · ${new Date(item.starts_at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}` : ""}
          {item.location ? ` · ${item.location}` : ""}
        </p>
        <p className="text-sm tabular-nums text-ink-1">{item.price_kes != null ? `KSh ${item.price_kes.toLocaleString("en-KE")}` : "Price not set"}</p>

        <section className="space-y-1">
          <h2 className="text-sm font-semibold text-ink-1">What attendees will get</h2>
          <p className="whitespace-pre-line text-sm text-ink-2">{item.promised_outcomes}</p>
        </section>

        <section className="space-y-1 rounded-xl bg-surface-2 p-3">
          <h2 className="text-sm font-semibold text-ink-1">What was delivered</h2>
          {item.delivered_outcomes
            ? <p className="whitespace-pre-line text-sm text-ink-2">{item.delivered_outcomes}</p>
            : <p className="text-sm text-ink-3">{item.record_status}</p>}
        </section>

        <p className="text-xs text-ink-3">
          {item.attendee_count} registered{item.spaces_left != null ? ` · ${item.spaces_left} places left` : ""}
          {item.rating != null ? ` · rated ${item.rating} by ${item.review_count} who attended` : " · no reviews yet"}
        </p>

        {signedIn && me && !isOrganiser && item.status === "published" && (
          <div className="flex gap-2">
            {me.registered
              ? <Button variant="outline" size="sm" disabled={busy || me.checked_in}
                  onClick={() => act(() => knowledgeAPI.unregister(id), "You have left this session")}>
                  {me.checked_in ? "Checked in" : "Leave session"}
                </Button>
              : <Button size="sm" loading={busy} onClick={() => act(() => knowledgeAPI.register(id), "You are registered")}>
                  Register
                </Button>}
          </div>
        )}
        {!signedIn && item.status === "published" && (
          <p className="text-sm text-ink-3"><Link to="/auth" className="font-medium text-brand-700 underline">Sign in</Link> to register.</p>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-1">Reviews from people who attended</h2>
        {item.reviews.length === 0 && <p className="text-sm text-ink-4">No reviews yet. Only people who were checked in can review.</p>}
        {item.reviews.map((r, i) => (
          <div key={i} className="border-t border-edge-2 pt-2">
            <p className="text-sm font-medium text-ink-1">{"★".repeat(r.rating)}<span className="text-ink-4">{"★".repeat(5 - r.rating)}</span> <span className="text-xs font-normal text-ink-3">{r.by}</span></p>
            {r.comment && <p className="text-sm text-ink-2">{r.comment}</p>}
          </div>
        ))}
        {me?.can_review && (
          <form className="space-y-2 border-t border-edge-2 pt-3" onSubmit={(e) => {
            e.preventDefault();
            act(() => knowledgeAPI.review(id, { rating: Number(review.rating), comment: review.comment || null }), "Thank you for the review");
          }}>
            <label className="block text-2xs font-semibold text-ink-2">Your rating
              <select className="ml-2 rounded-lg border border-edge-2 px-2 py-1 text-sm" value={review.rating}
                onChange={(e) => setReview({ ...review, rating: e.target.value })}>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <Textarea label="What did you get from it?" value={review.comment} maxLength={1000}
              onChange={(e) => setReview({ ...review, comment: e.target.value })} />
            <Button type="submit" size="sm" loading={busy}>Post review</Button>
          </form>
        )}
        {me?.reviewed && <p className="text-xs text-ink-3">You have reviewed this session.</p>}
      </Card>

      {isOrganiser && (
        <Card className="space-y-3 border-brand-200">
          <h2 className="text-sm font-semibold text-ink-1">Host panel</h2>
          {item.status === "draft" && (
            <Button size="sm" loading={busy} onClick={() => act(() => knowledgeAPI.publish(id), "Published")}>Publish</Button>
          )}
          {(item.status === "draft" || item.status === "published") && (
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => act(() => knowledgeAPI.cancel(id), "Cancelled")}>Cancel session</Button>
          )}
          {attendees && attendees.length > 0 && (
            <ul className="space-y-1">
              {attendees.map((a) => (
                <li key={a.vendor_id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-ink-1">{a.business}</span>
                  {a.checked_in
                    ? <Badge variant="brand">Checked in</Badge>
                    : <Button size="sm" variant="outline" disabled={busy}
                        onClick={() => act(() => knowledgeAPI.checkIn(id, a.vendor_id), "Checked in")}>Check in</Button>}
                </li>
              ))}
            </ul>
          )}
          {canDeliver && (
            <form className="space-y-2 border-t border-edge-2 pt-3" onSubmit={(e) => {
              e.preventDefault();
              act(() => knowledgeAPI.deliver(id, delivered), "Delivered record published");
            }}>
              <Textarea label="What was actually delivered?" value={delivered} maxLength={4000}
                onChange={(e) => setDelivered(e.target.value)} />
              <p className="text-xs text-ink-3">Write what happened, honestly. Attendees will see this next to what you promised.</p>
              <Button type="submit" size="sm" loading={busy}>Publish delivered record</Button>
            </form>
          )}
          {item.status === "published" && !canDeliver && (
            <p className="text-xs text-ink-3">You can write the delivered record after the session date.</p>
          )}
        </Card>
      )}
    </div>
  );
}
