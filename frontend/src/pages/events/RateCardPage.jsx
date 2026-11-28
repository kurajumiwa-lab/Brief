import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, ExternalLink, Eye, Plus, Trash2, Wallet } from "lucide-react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Select from "@/components/ui/Select";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { useAuthStore } from "@/stores/authStore";
import { EVENT_VENDOR_CATEGORIES } from "@/config/constants";
import { apiError } from "@/lib/api";
import { eventDeskAPI } from "@/lib/eventDeskApi";
import { formatKes } from "@/lib/receipts";
import { cn } from "@/lib/utils";

const UNITS = [
  { value: "per_event", label: "per event" },
  { value: "per_day", label: "per day" },
  { value: "per_person", label: "per person" },
  { value: "per_hour", label: "per hour" },
  { value: "per_item", label: "per item" },
  { value: "custom", label: "custom" },
];

const emptyPackage = () => ({
  name: "", description: "", price_kes: "", price_unit: "per_event",
  inclusions: "", is_active: true,
});

const splitList = (value) => String(value || "").split(",").map((v) => v.trim()).filter(Boolean);

/**
 * Build a rate card in three steps. Every price here is the vendor's own; reach
 * claims are labelled self-reported because no verification flow exists yet.
 */
export default function RateCardPage() {
  const me = useAuthStore((s) => s.vendor);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [headline, setHeadline] = useState("");
  const [summary, setSummary] = useState("");
  const [categories, setCategories] = useState([]);
  const [proofLinks, setProofLinks] = useState([]);
  const [reachClaims, setReachClaims] = useState([]);
  const [isPublic, setIsPublic] = useState(true);
  const [packages, setPackages] = useState([]);
  const [publicUrl, setPublicUrl] = useState(me?.vendor_handle ? `/rate-card/${me.vendor_handle}` : null);
  const [rateCardBookings, setRateCardBookings] = useState(0);

  useEffect(() => {
    let live = true;
    eventDeskAPI.myRateCard()
      .then(({ data }) => {
        if (!live) return;
        const card = data.rate_card;
        setHeadline(card?.headline || "");
        setSummary(card?.summary || "");
        setCategories(card?.event_categories || []);
        setProofLinks((card?.proof_links || []).map((x) => ({ label: x.label || "", url: x.url || "" })));
        setReachClaims((card?.reach_claims || []).map((x) => ({
          platform: x.platform || "", metric: x.metric || "", value: x.value || "", note: x.note || "",
        })));
        setIsPublic(card?.is_public !== false);
        setPackages((card?.packages || []).map((p) => ({
          ...p, price_kes: String(p.price_kes ?? ""), inclusions: (p.inclusions || []).join(", "),
        })));
        if (card?.public_url) setPublicUrl(card.public_url);
        setRateCardBookings(card?.accepted_bookings || 0);
      })
      .catch((error) => toast.error(apiError(error, "Could not load your rate card")))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, []);

  const toggleCategory = (value) =>
    setCategories((current) => current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]);

  const setProof = (index, key, value) =>
    setProofLinks((rows) => rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  const setReach = (index, key, value) =>
    setReachClaims((rows) => rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  const setPackage = (index, key, value) =>
    setPackages((rows) => rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

  const save = async () => {
    if (!headline.trim()) {
      toast.error("Give the card a headline first");
      return;
    }
    if (packages.some((p) => !p.name.trim() || p.name.trim().length < 2 || p.price_kes === "" || !Number.isInteger(Number(p.price_kes)) || Number(p.price_kes) < 0 || Number(p.price_kes) > 100000000)) {
      toast.error("Give each package a name and a whole KES price. Enter 0 only if it is free.");
      return;
    }
    setSaving(true);
    let cardSaved = false;
    try {
      const card = await eventDeskAPI.saveRateCard({
        headline: headline.trim(),
        summary: summary.trim(),
        event_categories: categories,
        proof_links: proofLinks.filter((x) => x.label.trim() && x.url.trim()).map((x) => ({
          label: x.label.trim(), url: x.url.trim(), kind: "portfolio",
        })),
        reach_claims: reachClaims.filter((x) => x.platform.trim() && x.metric.trim() && x.value.trim()).map((x) => ({
          platform: x.platform.trim(), metric: x.metric.trim(), value: x.value.trim(), note: x.note.trim(),
        })),
        is_public: isPublic,
      });
      cardSaved = true;
      const saved = await eventDeskAPI.savePackages(packages
        .filter((p) => p.name.trim())
        .map((p, index) => ({
          id: p.id || undefined,
          name: p.name.trim(),
          description: p.description.trim(),
          price_kes: Number(p.price_kes),
          price_unit: p.price_unit,
          inclusions: splitList(p.inclusions),
          is_active: p.is_active !== false,
          sort_order: index,
        })));
      const next = saved.data.rate_card || card.data.rate_card;
      if (Array.isArray(next?.packages)) setPackages(next.packages.map((p) => ({ ...p, price_kes: String(p.price_kes ?? ""), inclusions: (p.inclusions || []).join(", ") })));
      if (next?.public_url) setPublicUrl(next.public_url);
      if (next?.accepted_bookings !== undefined) setRateCardBookings(next.accepted_bookings);
      toast.success(isPublic ? "Rate card published" : "Private rate card saved");
    } catch (error) {
      toast.error(cardSaved ? "Card details saved, but packages did not. Check your connection and save again." : apiError(error, "Could not save the rate card"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageSpinner />;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wider text-brand-600">The event desk</p>
          <h2 className="text-xl font-semibold text-ink-1 tracking-tight">Build your rate card in 3 steps</h2>
          <p className="text-xs text-ink-4 mt-1">A shareable price list for services, creators and event suppliers. Show your work and the prices you set.</p>
          <Link className="text-xs underline" to="/campaigns">Browse marketing campaigns</Link>
          {Number(rateCardBookings) > 0 && <p className="text-2xs text-brand-700 dark:text-brand-300 mt-1">{rateCardBookings} accepted booking{rateCardBookings === 1 ? "" : "s"} on the desk</p>}
        </div>
        <div className="flex items-center gap-2">
          {me?.vendor_handle && isPublic && (
            <Button as={Link} to={`/rate-card/${me.vendor_handle}`} target="_blank" rel="noreferrer"
                    size="sm" variant="secondary" icon={Eye}>
              Preview
            </Button>
          )}
          <Button size="sm" onClick={save} loading={saving} icon={CheckCircle2}>{isPublic ? "Publish" : "Save privately"}</Button>
        </div>
      </div>

      <Card className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wider text-ink-4">Step 1</p>
            <h3 className="text-sm font-semibold text-ink-1">What you do, in one line</h3>
          </div>
          <Badge variant={isPublic ? "brand" : "gray"} size="xs">{isPublic ? "Public" : "Private"}</Badge>
        </div>
        <Input label="Headline" value={headline} onChange={(e) => setHeadline(e.target.value)}
               placeholder="e.g. Food creator in Nairobi or event decorator" maxLength={200} />
        <Textarea label="What is included in a typical job" rows={3} value={summary}
                  onChange={(e) => setSummary(e.target.value)} maxLength={4000}
                  placeholder="Full decor, tables and lighting for 120 guests in Kisumu and Kisii." />
        <div>
          <p className="text-2xs font-semibold text-ink-2 mb-1.5">Event request categories (optional)</p>
          <div className="flex flex-wrap gap-1.5">
            {EVENT_VENDOR_CATEGORIES.map((category) => (
              <button key={category.value} type="button" onClick={() => toggleCategory(category.value)}
                      className={cn("rounded-full border px-2.5 py-1 text-2xs font-semibold transition-colors",
                        categories.includes(category.value)
                          ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                          : "border-edge-2 bg-surface-0 text-ink-3 hover:text-ink-1")}>
                {category.label}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-3">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          Publish this card at a shareable link
        </label>
      </Card>

      <Card className="space-y-3">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wider text-ink-4">Step 2</p>
          <h3 className="text-sm font-semibold text-ink-1">Show the work</h3>
          <p className="text-2xs text-ink-4 mt-0.5">Links and reach numbers are shown as self-reported. Do not type what you cannot show.</p>
        </div>
        <div className="space-y-2">
          {proofLinks.map((row, index) => (
            <div key={index} className="grid sm:grid-cols-[1fr_1.4fr_auto] gap-2 items-end">
              <Input label={index === 0 ? "Label" : undefined} value={row.label}
                     onChange={(e) => setProof(index, "label", e.target.value)} placeholder="e.g. Campaign reel or portfolio" />
              <Input label={index === 0 ? "https link" : undefined} value={row.url}
                     onChange={(e) => setProof(index, "url", e.target.value)} placeholder="https://..." />
              <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove link"
                      onClick={() => setProofLinks((rows) => rows.filter((_, i) => i !== index))} />
            </div>
          ))}
          {proofLinks.length < 6 && (
            <Button size="xs" variant="secondary" icon={Plus}
                    onClick={() => setProofLinks((rows) => [...rows, { label: "", url: "" }])}>
              Add a link
            </Button>
          )}
        </div>
        <div className="space-y-2 pt-1">
          {reachClaims.map((row, index) => (
            <div key={index} className="grid sm:grid-cols-[0.8fr_1.3fr_0.6fr_auto] gap-2 items-end">
              <Input label={index === 0 ? "Platform" : undefined} value={row.platform}
                     onChange={(e) => setReach(index, "platform", e.target.value)} placeholder="TikTok" />
              <Input label={index === 0 ? "What the number means" : undefined} value={row.metric}
                     onChange={(e) => setReach(index, "metric", e.target.value)} placeholder="Followers or average views" />
              <Input label={index === 0 ? "Number" : undefined} value={row.value}
                     onChange={(e) => setReach(index, "value", e.target.value)} placeholder="48K" />
              <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove reach claim"
                      onClick={() => setReachClaims((rows) => rows.filter((_, i) => i !== index))} />
              <Input label={`Context or date for reach claim ${index + 1} (optional)`} value={row.note} maxLength={200} onChange={(e) => setReach(index, "note", e.target.value)} placeholder="e.g. November 2026, last 30 days" />
            </div>
          ))}
          {reachClaims.length < 8 && (
            <Button size="xs" variant="secondary" icon={Plus}
                    onClick={() => setReachClaims((rows) => [...rows, { platform: "", metric: "", value: "", note: "" }])}>
              Add a reach claim
            </Button>
          )}
          <p className="text-micro text-ink-4">Reach claims are self-reported. They are never presented as verified.</p>
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wider text-ink-4">Step 3</p>
            <h3 className="text-sm font-semibold text-ink-1">Packages and prices</h3>
          </div>
          <Badge variant="gray" size="xs">{packages.length} package{packages.length === 1 ? "" : "s"}</Badge>
        </div>
        {packages.map((pack, index) => (
          <div key={index} className="rounded-xl border border-edge-1 p-3 space-y-2 bg-surface-0">
            <div className="grid sm:grid-cols-[1.5fr_0.8fr_0.9fr_auto] gap-2 items-end">
              <Input label="Package name" value={pack.name} maxLength={160}
                     onChange={(e) => setPackage(index, "name", e.target.value)} placeholder="e.g. One TikTok video" />
              <Input label="Price (KES)" type="number" min="0" value={pack.price_kes}
                     onChange={(e) => setPackage(index, "price_kes", e.target.value)} placeholder="85000" />
              <Select label="Unit" value={pack.price_unit} options={UNITS}
                      onChange={(e) => setPackage(index, "price_unit", e.target.value)} />
              <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove package"
                      onClick={() => setPackages((rows) => rows.filter((_, i) => i !== index))} />
            </div>
            <Input label="What is included" value={pack.inclusions}
                   onChange={(e) => setPackage(index, "inclusions", e.target.value)}
                   placeholder="e.g. One video, one revision" hint="Separate items with commas." />
            <Textarea label="Notes" rows={2} value={pack.description} maxLength={1000}
                      onChange={(e) => setPackage(index, "description", e.target.value)}
                      placeholder="Scope, usage rights, turnaround or terms to agree." />
            <label className="flex items-center gap-2 text-2xs text-ink-3">
              <input type="checkbox" checked={pack.is_active !== false}
                     onChange={(e) => setPackage(index, "is_active", e.target.checked)} />
              Offer this package publicly
            </label>
            {Number(pack.price_kes) > 0 && (
              <p className="text-2xs text-ink-4 inline-flex items-center gap-1">
                <Wallet size={11} /> {formatKes(Number(pack.price_kes))} {UNITS.find((u) => u.value === pack.price_unit)?.label}
              </p>
            )}
          </div>
        ))}
        {packages.length < 12 && (
          <Button size="sm" variant="secondary" icon={Plus}
                  onClick={() => setPackages((rows) => [...rows, emptyPackage()])}>
            Add a package
          </Button>
        )}
      </Card>

      <p className="text-xs text-ink-3">Campaigns outside events are not yet supported as a dedicated marketplace. Share your card directly with a business and agree terms together.</p>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-edge-1 bg-surface-1 p-4">
        <div className="text-xs text-ink-3">
          <p className="font-semibold text-ink-1">Payment stays direct.</p>
          <p className="mt-0.5">The desk records the booking and opens contact details after you accept a quote. It never holds the money.</p>
        </div>
        <Button onClick={save} loading={saving} icon={CheckCircle2}>{isPublic ? "Save and publish" : "Save privately"}</Button>
      </div>

      {publicUrl && (
        <p className="text-xs text-ink-4 text-center">
          <Link to={publicUrl} className="inline-flex items-center gap-1 text-brand-600 hover:underline" target="_blank" rel="noreferrer">
            Open your public card <ExternalLink size={11} />
          </Link>
          <span className="mx-1">·</span>
          <Link to="/events/desk" className="inline-flex items-center gap-1 hover:underline">
            Go to the event desk <ArrowRight size={11} />
          </Link>
        </p>
      )}
    </div>
  );
}
