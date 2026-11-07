import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { PageSpinner } from "@/components/ui/Spinner";
import { trustAPI, apiError } from "@/lib/api";
import { COUNTRIES, POINTS_NOTE, STATUS_LABEL, newIdempotencyKey, errorText } from "./trustCore";

/**
 * MY SHOPS & POINTS — for a signed-in business.
 * Add a shop (it waits for a Brief check), get a till code for a checked shop,
 * see points, and exchange them for listed help. Points are never money.
 */
const EMPTY_FORM = { branch_name: "", country: "KE", address_text: "" };

export default function TrustMePage() {
  const [points, setPoints] = useState(null);
  const [services, setServices] = useState([]);
  const [shops, setShops] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [codes, setCodes] = useState({});
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    Promise.all([trustAPI.points(), trustAPI.services(), trustAPI.mine()])
      .then(([p, s, m]) => {
        setPoints(p.data);
        setServices(s.data.services || []);
        setShops(m.data.branches || []);
        setError(null);
      })
      .catch((err) => setError(apiError(err, "Could not load your shops and points")));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addShop(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await trustAPI.addBranch(form);
      setForm(EMPTY_FORM);
      setNotice("Shop added. It will show here once Brief has checked it.");
      load();
    } catch (err) {
      setFormError(errorText(err, "The shop could not be added."));
    } finally {
      setSaving(false);
    }
  }

  async function getCode(shop) {
    setBusy(shop.id);
    setNotice(null);
    try {
      const { data } = await trustAPI.issueToken(shop.id);
      setCodes((c) => ({ ...c, [shop.id]: data }));
    } catch (err) {
      setNotice(errorText(err, "A till code could not be made. Try again."));
    } finally {
      setBusy(null);
    }
  }

  async function redeem(service) {
    setBusy(service.service_key);
    setNotice(null);
    // One key per click: a double tap or a retry cannot spend points twice.
    const key = newIdempotencyKey();
    try {
      const { data } = await trustAPI.redeem({ service_key: service.service_key, country: "KE" }, key);
      setNotice(data.status === "already_redeemed"
        ? "You already exchanged points for this."
        : "Done. The Brief team will be in touch to set this up.");
      load();
    } catch (err) {
      setNotice(errorText(err, "The exchange could not be made."));
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p role="alert" className="p-4 text-sm text-red-600">{error}</p>;
  if (!points || shops === null) return <PageSpinner />;

  const checked = shops.filter((s) => s.status === "active");

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-ink-1">My shops and points</h1>
        <p className="text-xs text-ink-3">
          <Link to="/trust" className="font-medium text-brand-700 underline">See all checked shops</Link>
        </p>
      </header>

      {notice && <p role="status" className="text-sm text-ink-2">{notice}</p>}

      <Card padding="p-4" className="space-y-1">
        <p className="text-xs text-ink-3">Your points</p>
        <p className="text-2xl font-semibold tabular-nums text-ink-1">{points.balance_points}</p>
        <p className="text-xs text-ink-3">{POINTS_NOTE}</p>
        <p className="text-xs text-ink-3">You earn 20 points for each rating you publish on a checked shop.</p>
      </Card>

      {services.length > 0 && (
        <section aria-label="Exchange points" className="space-y-2">
          <h2 className="text-sm font-semibold text-ink-1">Exchange points for help</h2>
          {services.map((s) => (
            <Card key={s.service_key} padding="p-3" className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm text-ink-1">{s.title}</p>
                <p className="text-xs text-ink-3">{s.points_cost} points</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                loading={busy === s.service_key}
                disabled={points.balance_points < s.points_cost}
                onClick={() => redeem(s)}
              >
                {points.balance_points < s.points_cost ? "Not enough points" : "Exchange"}
              </Button>
            </Card>
          ))}
        </section>
      )}

      {shops.length > 0 && (
        <section aria-label="My shops" className="space-y-2">
          <h2 className="text-sm font-semibold text-ink-1">My shops</h2>
          {shops.map((s) => (
            <Card key={s.id} padding="p-3" className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={s.status === "active" ? "brand" : "gray"}>{STATUS_LABEL[s.status] || s.status}</Badge>
                <span className="text-xs text-ink-3">{s.country_code}</span>
              </div>
              <p className="text-sm font-semibold text-ink-1">{s.branch_name}</p>
              {s.status === "active" && (
                <>
                  <Button size="sm" variant="secondary" loading={busy === s.id} onClick={() => getCode(s)}>
                    Get a till code
                  </Button>
                  {codes[s.id] && (
                    <p className="text-sm text-ink-1">
                      Code: <strong className="tabular-nums">{codes[s.id].token}</strong>
                      <span className="block text-xs text-ink-3">{codes[s.id].detail}</span>
                    </p>
                  )}
                </>
              )}
            </Card>
          ))}
          {checked.length === 0 && <p className="text-xs text-ink-3">A shop appears on Brief once it is checked.</p>}
        </section>
      )}

      <Card padding="p-4" className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-1">Add a shop</h2>
        <form onSubmit={addShop} className="space-y-3">
          <Input
            label="Shop name"
            value={form.branch_name}
            onChange={(e) => setForm({ ...form, branch_name: e.target.value })}
            required
          />
          <Select
            label="Country"
            value={form.country}
            onChange={(e) => setForm({ ...form, country: e.target.value })}
            options={COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
          />
          <Input
            label="Where is it? (street, town)"
            value={form.address_text}
            onChange={(e) => setForm({ ...form, address_text: e.target.value })}
            required
          />
          {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
          <Button type="submit" variant="primary" loading={saving}>Add my shop</Button>
        </form>
      </Card>
    </div>
  );
}
