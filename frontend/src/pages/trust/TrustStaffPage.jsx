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
 * CHECK DESK — Brief staff only. Shops wait here until someone checks them.
 * Approving a shop makes it public. Rejecting needs a reason the shop can read.
 * The server refuses anyone who is not staff, and refuses anyone checking their own shop.
 */
export default function TrustStaffPage() {
  const [shops, setShops] = useState(null);
  const [error, setError] = useState(null);
  const [forbidden, setForbidden] = useState(false);
  const [notice, setNotice] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    trustAPI.pendingBranches()
      .then(({ data }) => { setShops(data.branches); setError(null); })
      .catch((err) => {
        if (err?.response?.status === 403) setForbidden(true);
        else setError(apiError(err, "Could not load the check desk"));
      });
  }, []);

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

  if (forbidden) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-4 pb-16">
        <h1 className="text-xl font-semibold text-ink-1">Check desk</h1>
        <p className="text-sm text-ink-2">This page is for Brief staff only.</p>
        <Link to="/trust" className="text-sm font-medium text-brand-700 underline">See checked shops</Link>
      </div>
    );
  }
  if (error) return <p role="alert" className="p-4 text-sm text-red-600">{error}</p>;
  if (!shops) return <PageSpinner />;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-ink-1">Check desk</h1>
        <p className="text-sm text-ink-3">
          Shops waiting for a check. Approve only what you have seen or confirmed. Your name is recorded.
        </p>
      </header>

      {shops.length === 0 && <p className="text-sm text-ink-4">No shops are waiting for a check.</p>}

      {shops.map((shop) => {
        const d = draft(shop.id);
        return (
          <Card key={shop.id} padding="p-4" className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="gray">Waiting for a check</Badge>
              <Badge variant="gray">{countryName(shop.country_code)}</Badge>
            </div>
            <p className="text-sm font-semibold text-ink-1">{shop.branch_name}</p>
            <p className="text-xs text-ink-3">{shop.address_text}</p>
            <Select
              label="How did you check it?"
              value={d.method}
              onChange={(e) => setDraft(shop.id, { method: e.target.value })}
              options={CHECK_METHODS}
            />
            <Textarea
              label="Note (required to reject; shown to the owner)"
              value={d.note}
              onChange={(e) => setDraft(shop.id, { note: e.target.value })}
              rows={2}
            />
            {notice?.id === shop.id && <p role="status" className="text-sm text-ink-2">{notice.text}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={busy === shop.id} onClick={() => decide(shop, "approved")}>
                Approve
              </Button>
              <Button variant="secondary" disabled={busy === shop.id} onClick={() => decide(shop, "rejected")}>
                Reject
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
