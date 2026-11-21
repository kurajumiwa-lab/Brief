import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Camera, Info, MapPin, PiggyBank, Search, TrendingDown } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { priceClaimsAPI, apiError } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

const SOURCES = [
  { value: "customer", label: "I am a customer" },
  { value: "employee", label: "I work there" },
  { value: "rival", label: "I run a competing business" },
  { value: "owner", label: "This is my business" },
];

/**
 * SAVINGS — the price truth of a town, in one sentence per item.
 *
 * "The same bale is KSh 168 cheaper forty metres away." That is the product.
 * Four rules keep it honest, and the screen shows all four rather than trusting
 * the reader to believe them:
 *
 *   · a saving needs at least five confirmed prices, or it is not shown at all;
 *   · a price older than 45 days drops out of the headline;
 *   · it is never a verdict about a shop — only a price, a place and a date;
 *   · the person who collected it is named by capacity, not by name, and is paid
 *     for the work (see the day rates on the same page).
 *
 * Reporting is open to anyone: a customer, an employee in their own time, or a
 * rival. The one thing we will not take is an internal document.
 */
export default function SavingsPage() {
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [town, setTown] = useState("");
  const [product, setProduct] = useState("");
  const [reportOpen, setReportOpen] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const { data: body } = await priceClaimsAPI.savings({ town, product });
      setData(body);
    } catch (err) {
      setError(apiError(err, "Could not load the savings"));
    }
  }, [town, product]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      <header className="space-y-1.5">
        <p className="inline-flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
          <TrendingDown size={13} aria-hidden="true" /> Price check
        </p>
        <h1 className="text-xl font-semibold text-ink-1">What the next shop charges</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-3">
          In most Kenyan towns the same bale, crate or carton is sold a few hundred
          metres apart at two prices, and nobody compares them. This is the comparison.
        </p>
      </header>

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Input
          label="Town or market"
          value={town}
          onChange={(e) => setTown(e.target.value)}
          placeholder="e.g. Kisii"
        />
        <Input
          label="Item"
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          placeholder="e.g. sugar"
        />
        <div className="flex items-end">
          <Button type="button" variant="secondary" onClick={load} className="w-full sm:w-auto">
            <Search size={14} aria-hidden="true" /> Check
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {!data && !error && <PageSpinner />}

      {data && data.items.length === 0 && (
        <Card padding="p-5" className="space-y-2 text-center">
          <PiggyBank size={22} className="mx-auto text-ink-4" aria-hidden="true" />
          <p className="text-sm font-semibold text-ink-1">No saving we can prove yet</p>
          <p className="mx-auto max-w-md text-xs leading-relaxed text-ink-3">
            A saving appears only where at least {data.min_samples} confirmed prices agree
            and the cheapest was seen in the last {data.stale_after_days} days. If a shop is
            cheaper but nobody has photographed the shelf, we say nothing rather than guess.
          </p>
          <Button type="button" size="sm" variant="subtle" onClick={() => setReportOpen((v) => !v)}>
            <Camera size={13} aria-hidden="true" /> Add a price you can see
          </Button>
        </Card>
      )}

      <div className="space-y-2">
        {(data?.items || []).map((item) => (
          <Card key={`${item.town}-${item.product}-${item.unit}`} padding="p-3.5" className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink-1">{item.product}</p>
                <p className="mt-0.5 flex items-center gap-1 text-micro text-ink-4">
                  <MapPin size={11} aria-hidden="true" />
                  {item.town || "Town not stated"} · {item.unit || "unit"}
                </p>
              </div>
              <Badge variant="brand">
                Save KSh {item.saving_kes.toLocaleString("en-KE")}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-surface-2 px-2.5 py-2">
                <p className="text-micro font-bold uppercase tracking-wide text-ink-4">Usual</p>
                <p className="text-sm font-bold text-ink-2">
                  KSh {item.typical_kes.toLocaleString("en-KE")}
                </p>
              </div>
              <div className="rounded-lg bg-brand-50 px-2.5 py-2 dark:bg-brand-500/10">
                <p className="text-micro font-bold uppercase tracking-wide text-brand-800 dark:text-brand-200">
                  Cheaper
                </p>
                <p className="text-sm font-bold text-brand-900 dark:text-brand-100">
                  KSh {item.cheapest_kes.toLocaleString("en-KE")}
                </p>
              </div>
            </div>

            <p className="text-xs font-semibold text-ink-1">
              {item.sentence}{" "}
              <span className="font-normal text-ink-3">
                ({item.saving_pct}% less than usual)
              </span>
            </p>
            <p className="text-micro text-ink-4">
              {item.sample_count} confirmed prices · last seen {item.observed_on} ·{" "}
              <Link to="/price-work" className="font-bold text-brand-700 hover:underline dark:text-brand-300">
                prices collected by hand
              </Link>
            </p>
          </Card>
        ))}
      </div>

      {data && (
        <p className="flex items-start gap-1.5 rounded-card border border-edge-1 bg-surface-1 p-3 text-micro leading-relaxed text-ink-3">
          <Info size={12} className="mt-0.5 shrink-0 text-ink-4" aria-hidden="true" />
          {data.note}
        </p>
      )}

      <button
        type="button"
        onClick={() => setReportOpen((v) => !v)}
        className="text-xs font-bold text-brand-700 hover:underline dark:text-brand-300"
      >
        {reportOpen ? "Hide the form" : "Know a price? Add it →"}
      </button>

      {reportOpen && <ReportForm onDone={() => { setReportOpen(false); load(); }} hasToken={!!token} />}

      <section className="rounded-card border border-dashed border-edge-2 p-4">
        <p className="text-sm font-semibold text-ink-1">Get paid for the gap</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-3">
          A confirmed price earns a task reward. A full walking day — twelve accepted
          observations in one town — pays KSh 200, and every rejected line must come with a
          reason. It is a paid task, not a job.
        </p>
        <Link
          to="/price-work"
          className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:underline dark:text-brand-300"
        >
          See the day rate for your town <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}

function ReportForm({ onDone, hasToken }) {
  const [form, setForm] = useState({
    product: "", price_kes: "", seller_label: "", market: "", unit: "", source: "customer",
  });
  const [saving, setSaving] = useState(false);
  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }));

  if (!hasToken) {
    return (
      <Card padding="p-4" className="space-y-2">
        <p className="text-xs text-ink-3">
          Sign in to add a price. It takes one field and a photo link, and you can see what
          happens to it afterwards.
        </p>
        <Link to="/auth" className="text-xs font-bold text-brand-700 hover:underline dark:text-brand-300">
          Sign in →
        </Link>
      </Card>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    const price = Number(form.price_kes);
    if (!form.product.trim() || !form.seller_label.trim() || !Number.isInteger(price) || price < 1) {
      toast.error("Give the item, the shop and a whole-shilling price.");
      return;
    }
    setSaving(true);
    try {
      await priceClaimsAPI.report({
        product: form.product.trim(),
        price_kes: price,
        seller_label: form.seller_label.trim(),
        market: form.market.trim() || null,
        unit: form.unit.trim() || null,
        source: form.source,
      });
      toast.success("Added as a suggestion. It becomes a fact when a second report agrees.");
      onDone();
    } catch (err) {
      toast.error(apiError(err, "Couldn't add that price."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card as="form" padding="p-4" className="space-y-3" onSubmit={submit}>
      <p className="text-sm font-semibold text-ink-1">Add a price you can see</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input label="Item" value={form.product} onChange={set("product")} required />
        <Input label="Price (KES)" type="number" min="1" inputMode="numeric" value={form.price_kes} onChange={set("price_kes")} required />
        <Input label="Which shop" value={form.seller_label} onChange={set("seller_label")} required />
        <Input label="Town or market" value={form.market} onChange={set("market")} />
        <Input label="Per (optional)" placeholder="bale, kg, crate" value={form.unit} onChange={set("unit")} />
        <Select label="How do you know?" value={form.source} onChange={set("source")} options={SOURCES} />
      </div>
      <p className="text-micro leading-relaxed text-ink-4">
        Allowed: a shelf label, a quoted price, a printed wholesale list, your own receipt.
        Not allowed: a costing sheet or anything shared with you in confidence — and a
        business may always reply to or dispute a claim about itself.
      </p>
      <Button type="submit" disabled={saving}>
        {saving ? "Adding…" : "Add this price"}
      </Button>
    </Card>
  );
}
