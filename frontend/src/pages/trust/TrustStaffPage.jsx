import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import { PageSpinner } from "@/components/ui/Spinner";
import { trustAPI, apiError } from "@/lib/api";
import { CHECK_METHODS, countryName, errorText } from "./trustCore";

/**
 * CHECK DESK — Brief staff only. Two queues:
 *   1. shops waiting for a check (approve makes a shop public; reject needs a reason the owner can read);
 *   2. reviews held for a check (publish or remove; always needs a reason).
 * The server refuses anyone who is not staff, and refuses anyone checking their own business.
 */

const REASON_LABEL = {
  velocity_day: "Several reviews in one day",
  code_used_too_fast: "Till code used within seconds of being made",
  duplicate_comment: "Same wording as another review of this shop",
};

export default function TrustStaffPage() {
  const [tab, setTab] = useState("shops");
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState(null);

  const guard = useCallback((err) => {
    if (err?.response?.status === 403) setForbidden(true);
    else setError(apiError(err, "Could not load the check desk"));
  }, []);

  if (forbidden) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-4 pb-16">
        <h1 className="text-xl font-semibold text-ink-1">Check desk</h1>
        <p className="text-sm text-ink-2">This page is for Brief staff only.</p>
        <Link to="/trust" className="text-sm font-medium text-brand-700 underline">See checked shops</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-ink-1">Check desk</h1>
        <p className="text-sm text-ink-3">Every decision is recorded with your name and a reason.</p>
      </header>

      <div role="tablist" aria-label="Check desk sections" className="flex gap-2">
        {[["shops", "Shops to check"], ["reviews", "Reviews held"]].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            type="button"
            onClick={() => setTab(key)}
            className={`min-h-[40px] rounded-full border px-4 text-sm ${
              tab === key ? "border-brand-600 bg-brand-50 font-semibold text-brand-700" : "border-edge-2 text-ink-2"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {tab === "shops" ? <ShopQueue onError={guard} /> : <ReviewQueue onError={guard} />}
    </div>
  );
}

function ShopQueue({ onError }) {
  const [shops, setShops] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(() => {
    trustAPI.pendingBranches()
      .then(({ data }) => setShops(data.branches))
      .catch(onError);
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const draft = (id) => drafts[id] || { method: CHECK_METHODS[0].value, note: "" };
  const setDraft = (id, patch) => setDrafts((d) => ({ ...d, [id]: { ...draft(id), ...patch } }));

  async function decide(shop, result) {
    const d = draft(shop.id);
    if (result === "rejected" && d.note.trim().length < 10) {
      setNotice({ id: shop.id, text: "Write a reason of at least 10 characters before rejecting." });
      return;
    }
    setBusy(shop.id);
    setNotice(null);
    try {
      await trustAPI.verify(shop.id, {
        method: d.method,
        result,
        note: result === "rejected" ? d.note.trim() : (d.note.trim() || null),
      });
      setNotice({ id: shop.id, text: result === "approved" ? "Approved. The shop is now public." : "Rejected. The owner can see the reason." });
      load();
    } catch (err) {
      setNotice({ id: shop.id, text: errorText(err, "The decision could not be saved.") });
    } finally {
      setBusy(null);
    }
  }

  if (!shops) return <PageSpinner />;
  if (shops.length === 0) return <p className="text-sm text-ink-4">No shops are waiting for a check.</p>;

  return shops.map((shop) => {
    const d = draft(shop.id);
    return (
      <Card key={shop.id} padding="p-4" className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="gray">Waiting for a check</Badge>
          <Badge variant="gray">{countryName(shop.country_code)}</Badge>
        </div>
        <p className="text-sm font-semibold text-ink-1">{shop.branch_name}</p>
        <p className="text-xs text-ink-3">{shop.address_text}</p>
        <Select label="How did you check it?" value={d.method} onChange={(e) => setDraft(shop.id, { method: e.target.value })} options={CHECK_METHODS} />
        <Textarea label="Note (required to reject; shown to the owner)" value={d.note} onChange={(e) => setDraft(shop.id, { note: e.target.value })} rows={2} />
        {notice?.id === shop.id && <p role="status" className="text-sm text-ink-2">{notice.text}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={busy === shop.id} onClick={() => decide(shop, "approved")}>Approve</Button>
          <Button variant="secondary" disabled={busy === shop.id} onClick={() => decide(shop, "rejected")}>Reject</Button>
        </div>
      </Card>
    );
  });
}

function ReviewQueue({ onError }) {
  const [reviews, setReviews] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(() => {
    trustAPI.flaggedReviews()
      .then(({ data }) => setReviews(data.reviews))
      .catch(onError);
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  async function decide(review, action) {
    const reason = (drafts[review.id] || "").trim();
    if (reason.length < 10) {
      setNotice({ id: review.id, text: "Write a reason of at least 10 characters." });
      return;
    }
    setBusy(review.id);
    setNotice(null);
    try {
      await trustAPI.moderateReview(review.id, { action, reason });
      load();
    } catch (err) {
      setNotice({ id: review.id, text: errorText(err, "The decision could not be saved.") });
    } finally {
      setBusy(null);
    }
  }

  if (!reviews) return <PageSpinner />;
  if (reviews.length === 0) return <p className="text-sm text-ink-4">No reviews are held for a check.</p>;

  return reviews.map((r) => (
    <Card key={r.id} padding="p-4" className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge variant="amber">Held for a check</Badge>
        <Badge variant="gray">{countryName(r.country_code)}</Badge>
      </div>
      <p className="text-sm font-semibold text-ink-1">{r.branch_name}</p>
      <p className="text-xs text-ink-3">
        Overall {r.overall}/5 · Service {r.service}/5 · Product {r.product}/5
      </p>
      {r.comment && <p className="rounded-lg bg-surface-2 p-3 text-sm text-ink-1">“{r.comment}”</p>}
      <ul className="list-disc space-y-1 pl-5 text-xs text-ink-2">
        {r.reasons.map((k) => <li key={k}>{REASON_LABEL[k] || k}</li>)}
      </ul>
      <Textarea
        label="Reason for your decision (kept in the record)"
        value={drafts[r.id] || ""}
        onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value })}
        rows={2}
      />
      {notice?.id === r.id && <p role="status" className="text-sm text-ink-2">{notice.text}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={busy === r.id} onClick={() => decide(r, "publish")}>Publish</Button>
        <Button variant="secondary" disabled={busy === r.id} onClick={() => decide(r, "remove")}>Remove</Button>
      </div>
    </Card>
  ));
}
