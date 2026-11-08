import { useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { trustAPI, apiError } from "@/lib/api";
import { t, useLang } from "@/lib/i18n";

/**
 * Owner's delivery choice for one shop. Pick-up is always on. A rider the buyer already
 * knows is optional. Brief never sets or holds the rider's fee.
 */
export default function DeliverySettings({ shop, onSaved }) {
  const lang = useLang();
  const current = shop.delivery || { options: ["pickup"], rider: null };
  const [known, setKnown] = useState(current.options.includes("known_rider"));
  const [area, setArea] = useState(current.rider?.area || "");
  const [name, setName] = useState(current.rider?.name || "");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(null);
    const body = known
      ? { options: ["pickup", "known_rider"], area, rider_name: name, rider_phone: phone }
      : { options: ["pickup"] };
    try {
      const { data } = await trustAPI.setDelivery(shop.id, body);
      setSaved(data.detail);
      setPhone("");
      onSaved?.();
    } catch (err) {
      setError(apiError(err, "Delivery could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-lg bg-surface-2 p-3" aria-label={t("delivery.title", lang)}>
      <p className="text-xs font-semibold text-ink-1">{t("delivery.title", lang)}</p>
      <label className="flex items-start gap-2 text-sm text-ink-1">
        <input type="checkbox" checked readOnly disabled className="mt-1" />
        <span>
          {t("delivery.pickup", lang)}{" "}
          <span className="text-xs text-ink-3">· {t("delivery.pickupAlways", lang)}</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm text-ink-1">
        <input
          type="checkbox"
          checked={known}
          onChange={(e) => setKnown(e.target.checked)}
          className="mt-1"
          data-testid={`known-rider-${shop.id}`}
        />
        <span>{t("delivery.rider", lang)}</span>
      </label>
      {known && (
        <div className="space-y-2">
          <Input label={t("delivery.area", lang)} value={area} onChange={(e) => setArea(e.target.value)} required />
          <Input label={t("delivery.riderName", lang)} value={name} onChange={(e) => setName(e.target.value)} required />
          <Input
            label={t("delivery.riderPhone", lang)}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            hint={current.rider?.phone ? `${current.rider.phone}` : undefined}
            required
          />
        </div>
      )}
      <p className="text-xs text-ink-3">{t("delivery.feeNote", lang)}</p>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {saved && <p className="text-xs text-ink-2">{saved}</p>}
      <Button type="submit" size="sm" variant="secondary" loading={busy}>
        {t("delivery.save", lang)}
      </Button>
    </form>
  );
}
