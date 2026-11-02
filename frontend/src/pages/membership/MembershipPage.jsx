import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { fieldBase } from "@/components/ui/Input";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { membershipAPI, apiError } from "@/lib/api";

/**
 * MEMBERSHIP — your member profile. Free for now.
 *
 * Privacy: you are not listed in the directory until you switch it on, and your
 * phone number is shown there only if you also switch that on.
 */

const VERIFY_META = {
  unverified: { label: "Not verified", variant: "gray" },
  pending: { label: "Verification requested", variant: "amber" },
  verified: { label: "Verified member", variant: "brand" },
  rejected: { label: "Not approved", variant: "gray" },
};

const when = (iso) => (iso ? new Date(iso).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

export default function MembershipPage() {
  const [profile, setProfile] = useState(null);
  const [categories, setCategories] = useState([]);
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [me, cats, ev] = await Promise.all([
        membershipAPI.me(), membershipAPI.categories(), membershipAPI.events(),
      ]);
      setProfile(me.data);
      setForm({
        display_name: me.data.display_name || "",
        category: me.data.category || "",
        professional_class: me.data.professional_class || "",
        bio: me.data.bio || "",
        directory_visible: !!me.data.directory_visible,
        show_contact: !!me.data.show_contact,
      });
      setCategories(cats.data);
      setEvents(ev.data);
      setError(null);
    } catch (err) {
      setError(apiError(err, "Could not load your membership"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !profile) return <PageSpinner label="Loading your membership…" />;
  if (error && !profile) {
    return (
      <Card>
        <p className="text-sm font-semibold text-ink-1">Membership could not be loaded</p>
        <p className="text-2xs text-ink-3 mt-0.5">{error}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={load}>Try again</Button>
      </Card>
    );
  }

  const set = (key) => (e) => {
    const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = { ...form, category: form.category || null };
      await membershipAPI.update(payload);
      toast.success("Membership saved");
      await load();
    } catch (err) {
      toast.error(apiError(err, "Could not save"));
    } finally {
      setBusy(false);
    }
  };

  const askVerification = async () => {
    setBusy(true);
    try {
      await membershipAPI.requestVerification();
      toast.success("Verification requested. An operator will review it.");
      await load();
    } catch (err) {
      toast.error(apiError(err, "Could not request verification"));
    } finally {
      setBusy(false);
    }
  };

  const verify = VERIFY_META[profile.verification_status] || VERIFY_META.unverified;
  const suspended = profile.membership_status === "suspended";
  const canAsk = !suspended && !["pending", "verified"].includes(profile.verification_status);

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-2xs uppercase tracking-wide text-ink-4">Membership</p>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-1">Your member profile</h1>
          <p className="text-sm text-ink-3 mt-0.5">Free for now. Nothing is charged for membership.</p>
        </div>
        <Link to="/membership/directory" className="text-2xs font-semibold text-brand-600 dark:text-brand-400 underline shrink-0">
          Member directory
        </Link>
      </div>

      {suspended && (
        <Card className="border-amber-200 dark:border-amber-500/30">
          <p className="text-sm font-semibold text-ink-1">Your membership is suspended</p>
          <p className="text-2xs text-ink-3 mt-0.5">You are hidden from the directory and cannot edit your profile. Contact the platform team.</p>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-ink-1">Verification</p>
            <p className="text-2xs text-ink-3 mt-0.5">Verified status is a review by an operator, not a badge you can buy.</p>
          </div>
          <Badge variant={verify.variant}>{verify.label}</Badge>
        </div>
        {profile.verification_status === "verified" && profile.verified_at && (
          <p className="text-micro text-ink-4 mt-2">Verified {when(profile.verified_at)}</p>
        )}
        {canAsk && (
          <Button size="sm" className="mt-3" disabled={busy} onClick={askVerification}>
            {profile.verification_status === "rejected" ? "Ask again" : "Request verification"}
          </Button>
        )}
      </Card>

      <Card>
        <form onSubmit={save} className="space-y-3" aria-label="Edit membership profile">
          <Input label="Display name" value={form.display_name || ""} onChange={set("display_name")}
            maxLength={120} disabled={suspended} />
          <div>
            <label htmlFor="member-category" className="block text-2xs font-semibold text-ink-2 mb-1.5">Membership category</label>
            <select id="member-category" className={`${fieldBase} h-10 px-3`} value={form.category || ""}
              onChange={set("category")} disabled={suspended}>
              <option value="">Choose a category</option>
              {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <Input label="Professional class" hint="For example: plumber, tailor, produce wholesaler"
            value={form.professional_class || ""} onChange={set("professional_class")} maxLength={120} disabled={suspended} />
          <Textarea label="About you or your business" value={form.bio || ""} onChange={set("bio")}
            maxLength={2000} disabled={suspended} />

          <fieldset className="space-y-2 pt-1">
            <legend className="text-2xs font-semibold text-ink-2 mb-1">Privacy</legend>
            <label className="flex items-start gap-2 text-sm text-ink-1">
              <input type="checkbox" className="mt-1" checked={!!form.directory_visible} onChange={set("directory_visible")} disabled={suspended} />
              <span>Show me in the member directory <span className="block text-2xs text-ink-3">Off by default. Other members can find you only when this is on.</span></span>
            </label>
            <label className="flex items-start gap-2 text-sm text-ink-1">
              <input type="checkbox" className="mt-1" checked={!!form.show_contact} onChange={set("show_contact")} disabled={suspended} />
              <span>Show my phone number in the directory <span className="block text-2xs text-ink-3">Only applies if you are listed.</span></span>
            </label>
          </fieldset>

          <Button type="submit" disabled={busy || suspended}>Save profile</Button>
        </form>
      </Card>

      <Card>
        <p className="text-sm font-bold text-ink-1 mb-2">History</p>
        {events.length === 0 ? (
          <p className="text-2xs text-ink-3">No changes yet.</p>
        ) : (
          <ul className="divide-y divide-edge-1">
            {events.map((e, i) => (
              <li key={`${e.at}-${i}`} className="py-2">
                <p className="text-2xs font-semibold text-ink-2">{e.action.replace(/_/g, " ")}</p>
                <p className="text-micro text-ink-4">{when(e.at)} · by @{e.actor}{e.note ? ` · ${e.note}` : ""}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
