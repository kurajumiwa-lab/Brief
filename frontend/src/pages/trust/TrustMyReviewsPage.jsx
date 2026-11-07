import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { PageSpinner } from "@/components/ui/Spinner";
import { trustAPI, apiError } from "@/lib/api";
import { countryName, errorText } from "./trustCore";

/**
 * MY REVIEWS — a customer's own review history on this device. No account.
 * Your history grows with each review you publish. You can choose a display name.
 */

const STATUS = {
  published: { label: "Published", variant: "brand" },
  hidden_pending_review: { label: "Being checked", variant: "amber" },
  removed: { label: "Removed", variant: "gray" },
};

export default function TrustMyReviewsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(null);
  const [nameError, setNameError] = useState(null);

  useEffect(() => {
    trustAPI.customerReviews()
      .then(({ data: d }) => { setData(d); setName(d.display_name || ""); })
      .catch((err) => setError(apiError(err, "Could not load your reviews")));
  }, []);

  async function saveName(e) {
    e.preventDefault();
    setNameError(null);
    try {
      await trustAPI.customerProfile(name.trim());
      setSaved(name.trim() ? "Saved. Your reviews now show this name." : "Saved. Your reviews now show as Verified customer.");
    } catch (err) {
      setNameError(errorText(err, "The name could not be saved."));
    }
  }

  if (error) return <p role="alert" className="p-4 text-sm text-red-600">{error}</p>;
  if (!data) return <PageSpinner />;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      <Link to="/trust" className="text-xs font-medium text-brand-700 underline">Checked shops</Link>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-ink-1">My reviews</h1>
        <p className="text-sm text-ink-3">
          Your history on this device. Reviews that are being checked show as held until staff confirm them.
        </p>
      </header>

      {data.reviews.length === 0 && (
        <p className="text-sm text-ink-4">You have not reviewed a shop yet. Rate a shop with the till code from your purchase.</p>
      )}

      {data.reviews.map((r) => {
        const st = STATUS[r.status] || STATUS.published;
        return (
          <Card key={r.id} padding="p-4" className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={st.variant}>{st.label}</Badge>
              <Badge variant="gray">{countryName(r.country_code)}</Badge>
            </div>
            <p className="text-sm font-semibold text-ink-1">{r.branch_name}</p>
            <p className="text-sm text-amber-600">{"★".repeat(r.overall)}<span className="text-ink-4">{"★".repeat(5 - r.overall)}</span></p>
            <p className="text-xs text-ink-3">
              Service {r.service}/5 · Product {r.product}/5 · {new Date(r.created_at).toLocaleDateString("en-KE")}
            </p>
          </Card>
        );
      })}

      <Card padding="p-4" className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-1">Display name (optional)</h2>
        <p className="text-xs text-ink-3">Shown beside your reviews. Leave it empty to stay as Verified customer.</p>
        <form onSubmit={saveName} className="space-y-3">
          <Input label="Name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          {nameError && <p role="alert" className="text-sm text-red-600">{nameError}</p>}
          {saved && <p role="status" className="text-sm text-ink-2">{saved}</p>}
          <Button type="submit" variant="secondary">Save name</Button>
        </form>
      </Card>
    </div>
  );
}
