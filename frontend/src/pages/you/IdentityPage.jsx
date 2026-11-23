import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, BadgeCheck, Building2, Check, Mail, Phone, ShieldCheck,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import { ClaimBadge, RankChip } from "@/components/identity/Rank";
import { useAuthStore } from "@/stores/authStore";
import { useIdentityStore } from "@/stores/identityStore";
import {
  AFFILIATION_METHODS, CAPABILITIES, CLAIM_STATUS, INSTITUTION_KINDS,
  INTENTS, REGULATORS, rankFor,
} from "@/config/identity";

/**
 * IDENTITY — the screen that keeps "I say so" and "somebody checked" apart.
 *
 * Two claims live here: an institution and a professional licence. Both start
 * at `pending`, both require a route the institution or regulator actually
 * controls, and neither can be confirmed by the account holder alone. A typed
 * name is never a badge.
 */
export default function IdentityPage() {
  const vendor = useAuthStore((s) => s.vendor);
  const identity = useIdentityStore();
  const loadIdentity = useIdentityStore((s) => s.load);
  const setIntent = useIdentityStore((s) => s.setIntent);
  const setContact = useIdentityStore((s) => s.setContact);
  const claimAffiliation = useIdentityStore((s) => s.claimAffiliation);
  const confirmAffiliation = useIdentityStore((s) => s.confirmAffiliation);
  const claimLicence = useIdentityStore((s) => s.claimLicence);

  const [aff, setAff] = useState({});
  const [lic, setLic] = useState({});
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    loadIdentity();
  }, [loadIdentity]);

  const rank = rankFor({ vendor, identity });
  const affiliation = identity.affiliation;
  const licence = identity.licence;

  async function submitAffiliation(event) {
    event.preventDefault();
    setNotice(null);
    const result = await claimAffiliation(aff);
    setNotice(
      result || identity.affiliation
        ? "Claim saved. It stays waiting until the institution answers the connection test."
        : null,
    );
  }

  async function submitCode(event) {
    event.preventDefault();
    setNotice(null);
    const result = await confirmAffiliation(code.trim());
    if (result) {
      setCode("");
      setNotice(
        result.status === CLAIM_STATUS.VERIFIED
          ? "Confirmed. The badge is now on your page."
          : "The check is still waiting.",
      );
    }
  }

  async function submitLicence(event) {
    event.preventDefault();
    setNotice(null);
    await claimLicence(lic);
    setNotice("Licence submitted. It is not a badge until our staff check the regulator's record.");
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <Link to="/you" className="inline-flex items-center gap-1.5 text-2xs font-bold text-ink-3 hover:text-ink-1">
        <ArrowLeft size={13} aria-hidden="true" />
        You
      </Link>

      <header>
        <p className="eyebrow">Identity</p>
        <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-ink-1">What has been checked</h1>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-ink-3">
          Rank measures what you expose and what the network records. These two
          claims are the only things that need somebody else to say yes.
        </p>
        <div className="mt-2">
          <RankChip rank={rank} />
        </div>
      </header>

      {identity.status === "local" && (
        <p className="rounded-xl border border-accent-200 bg-accent-50 px-3 py-2 text-2xs leading-relaxed text-accent-900 dark:border-accent-500/30 dark:bg-accent-600/10 dark:text-accent-200">
          The check service did not answer, so changes are saved on this device
          only. Nothing below is shown as confirmed.
        </p>
      )}
      {identity.error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-2xs font-medium text-danger">
          {identity.error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-xl bg-surface-2 px-3 py-2 text-2xs text-ink-2">
          {notice}
        </p>
      )}

      {/* Why you joined */}
      <section className="rounded-2xl border border-edge-1 bg-surface-1 p-4 sm:p-5">
        <h2 className="text-base font-extrabold tracking-tight text-ink-1">Why you joined</h2>
        <p className="mt-0.5 text-2xs text-ink-3">
          Not a category. Change it when your work changes.
        </p>
        <div className="mt-3 grid gap-1.5">
          {INTENTS.map((item) => {
            const active = identity.intent === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setIntent(item.value)}
                aria-pressed={active}
                className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  active
                    ? "border-brand-300 bg-brand-50/60 dark:border-brand-500/40 dark:bg-brand-500/10"
                    : "border-edge-1 hover:bg-surface-2"
                }`}
              >
                <span
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                    active ? "border-brand-700 bg-brand-700 text-white" : "border-edge-2 text-transparent"
                  }`}
                  aria-hidden="true"
                >
                  <Check size={12} strokeWidth={3} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold text-ink-1">{item.label}</span>
                  <span className="block text-2xs text-ink-3">{item.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {CAPABILITIES.map((capability) => {
            const active = identity.capabilities?.includes(capability.value);
            return (
              <span
                key={capability.value}
                className={`rounded-full border px-2.5 py-1 text-micro font-semibold ${
                  active
                    ? "border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/15 dark:text-brand-300"
                    : "border-edge-1 bg-surface-0 text-ink-4"
                }`}
              >
                {capability.short}
              </span>
            );
          })}
        </div>
        <p className="mt-2 text-micro text-ink-4">
          Switch capabilities on the You screen. They decide which tools appear.
        </p>
      </section>

      {/* Contact exposure */}
      <section className="rounded-2xl border border-edge-1 bg-surface-1 p-4 sm:p-5">
        <h2 className="text-base font-extrabold tracking-tight text-ink-1">How people reach you</h2>
        <p className="mt-0.5 text-2xs text-ink-3">
          Publishing a route is what moves you to Reachable. Nothing is shown
          until you turn it on.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="contact-phone" className="mb-1 flex items-center gap-1 text-2xs font-bold text-ink-2">
              <Phone size={12} aria-hidden="true" /> Phone
            </label>
            <Input
              id="contact-phone"
              type="tel"
              value={identity.contact?.phone || ""}
              onChange={(event) => setContact({ phone: event.target.value })}
              placeholder="+254 …"
            />
            <label className="mt-1.5 flex items-center gap-2 text-micro text-ink-3">
              <input
                type="checkbox"
                checked={Boolean(identity.contact?.show_phone)}
                onChange={(event) => setContact({ show_phone: event.target.checked })}
                className="h-3.5 w-3.5 rounded border-edge-2"
              />
              Show this number on my page
            </label>
          </div>
          <div>
            <label htmlFor="contact-email" className="mb-1 flex items-center gap-1 text-2xs font-bold text-ink-2">
              <Mail size={12} aria-hidden="true" /> Email
            </label>
            <Input
              id="contact-email"
              type="email"
              value={identity.contact?.email || ""}
              onChange={(event) => setContact({ email: event.target.value })}
              placeholder="name@example.com"
            />
            <label className="mt-1.5 flex items-center gap-2 text-micro text-ink-3">
              <input
                type="checkbox"
                checked={Boolean(identity.contact?.show_email)}
                onChange={(event) => setContact({ show_email: event.target.checked })}
                className="h-3.5 w-3.5 rounded border-edge-2"
              />
              Show this address on my page
            </label>
          </div>
        </div>
      </section>

      {/* Institution */}
      <section className="rounded-2xl border border-edge-1 bg-surface-1 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-2">
            <Building2 size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-extrabold tracking-tight text-ink-1">Institution</h2>
            <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">
              A school, clinic, SACCO, company or association. Confirmed only when
              the institution answers a test on a route it controls.
            </p>
          </div>
          <ClaimBadge claim={affiliation} />
        </div>

        {affiliation ? (
          <div className="mt-3 rounded-xl border border-edge-1 bg-surface-0 p-3">
            <p className="text-xs font-bold text-ink-1">{affiliation.name}</p>
            <p className="mt-0.5 text-2xs text-ink-3">
              {[affiliation.kind, affiliation.role, affiliation.official_email]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="mt-1 text-micro text-ink-4">
              Test: {AFFILIATION_METHODS.find((m) => m.value === affiliation.method)?.label || "Official contact"}
            </p>

            {affiliation.status === CLAIM_STATUS.PENDING && (
              <form onSubmit={submitCode} className="mt-3 flex flex-wrap items-end gap-2">
                <div className="min-w-[8rem] flex-1">
                  <label htmlFor="aff-code" className="mb-1 block text-micro font-bold text-ink-2">
                    Code from the test
                  </label>
                  <Input
                    id="aff-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="6 digits"
                    inputMode="numeric"
                  />
                </div>
                <Button type="submit" size="sm" disabled={code.trim().length < 4}>
                  Confirm
                </Button>
              </form>
            )}

            {affiliation.status !== CLAIM_STATUS.VERIFIED && (
              <button
                type="button"
                onClick={() => claimAffiliation({ ...affiliation, status: CLAIM_STATUS.PENDING })}
                className="mt-2 text-micro font-semibold text-ink-3 hover:text-ink-1"
              >
                Resend the test
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={submitAffiliation} className="mt-3 space-y-3">
            <div>
              <label htmlFor="id-aff-name" className="mb-1 block text-2xs font-bold text-ink-2">
                Institution name
              </label>
              <Input
                id="id-aff-name"
                value={aff.name || ""}
                onChange={(event) => setAff({ ...aff, name: event.target.value })}
                required
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="id-aff-kind" className="mb-1 block text-2xs font-bold text-ink-2">Kind</label>
                <Select
                  id="id-aff-kind"
                  value={aff.kind || ""}
                  onChange={(event) => setAff({ ...aff, kind: event.target.value })}
                >
                  <option value="">Choose one</option>
                  {INSTITUTION_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{kind}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label htmlFor="id-aff-role" className="mb-1 block text-2xs font-bold text-ink-2">Your role</label>
                <Input
                  id="id-aff-role"
                  value={aff.role || ""}
                  onChange={(event) => setAff({ ...aff, role: event.target.value })}
                  placeholder="e.g. Administrator"
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="id-aff-email" className="mb-1 block text-2xs font-bold text-ink-2">Official email</label>
                <Input
                  id="id-aff-email"
                  type="email"
                  value={aff.official_email || ""}
                  onChange={(event) => setAff({ ...aff, official_email: event.target.value })}
                  required
                />
              </div>
              <div>
                <label htmlFor="id-aff-phone" className="mb-1 block text-2xs font-bold text-ink-2">Official phone</label>
                <Input
                  id="id-aff-phone"
                  type="tel"
                  value={aff.official_phone || ""}
                  onChange={(event) => setAff({ ...aff, official_phone: event.target.value })}
                />
              </div>
            </div>
            <div>
              <label htmlFor="id-aff-method" className="mb-1 block text-2xs font-bold text-ink-2">Connection test</label>
              <Select
                id="id-aff-method"
                value={aff.method || "domain_email"}
                onChange={(event) => setAff({ ...aff, method: event.target.value })}
              >
                {AFFILIATION_METHODS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="id-aff-note" className="mb-1 block text-2xs font-bold text-ink-2">
                Note for the reviewer <span className="font-normal text-ink-4">(optional)</span>
              </label>
              <Textarea
                id="id-aff-note"
                rows={2}
                value={aff.note || ""}
                onChange={(event) => setAff({ ...aff, note: event.target.value })}
              />
            </div>
            <Button type="submit" size="sm" disabled={!aff.name || !aff.official_email}>
              Send the claim
            </Button>
          </form>
        )}
      </section>

      {/* Licence */}
      <section className="rounded-2xl border border-edge-1 bg-surface-1 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-2">
            <ShieldCheck size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-extrabold tracking-tight text-ink-1">Professional licence</h2>
            <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">
              For regulated practice. Everyone may offer a service; only a checked
              licence may claim the protected title.
            </p>
          </div>
          <ClaimBadge claim={licence} />
        </div>

        {licence ? (
          <div className="mt-3 rounded-xl border border-edge-1 bg-surface-0 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold text-ink-1">
              <BadgeCheck size={14} className="text-brand-600" aria-hidden="true" />
              {licence.title || "Licensed professional"}
            </p>
            <p className="mt-0.5 text-2xs text-ink-3">
              {licence.regulator} · {licence.number}
              {licence.expires_on ? ` · expires ${licence.expires_on}` : ""}
            </p>
            {licence.status === CLAIM_STATUS.PENDING && (
              <p className="mt-1.5 text-micro leading-relaxed text-ink-4">
                Waiting for a staff check against the regulator's register. This
                is a person reading a record, not an automatic approval.
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={submitLicence} className="mt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="lic-reg" className="mb-1 block text-2xs font-bold text-ink-2">Regulator</label>
                <Select
                  id="lic-reg"
                  value={lic.regulator || ""}
                  onChange={(event) => setLic({ ...lic, regulator: event.target.value })}
                  required
                >
                  <option value="">Choose one</option>
                  {REGULATORS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label htmlFor="lic-title" className="mb-1 block text-2xs font-bold text-ink-2">Protected title</label>
                <Input
                  id="lic-title"
                  value={lic.title || ""}
                  onChange={(event) => setLic({ ...lic, title: event.target.value })}
                  placeholder="e.g. Registered Nurse"
                  required
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="lic-number" className="mb-1 block text-2xs font-bold text-ink-2">Licence number</label>
                <Input
                  id="lic-number"
                  value={lic.number || ""}
                  onChange={(event) => setLic({ ...lic, number: event.target.value })}
                  required
                />
              </div>
              <div>
                <label htmlFor="lic-expiry" className="mb-1 block text-2xs font-bold text-ink-2">Expires</label>
                <Input
                  id="lic-expiry"
                  type="date"
                  value={lic.expires_on || ""}
                  onChange={(event) => setLic({ ...lic, expires_on: event.target.value })}
                />
              </div>
            </div>
            <Button type="submit" size="sm" disabled={!lic.regulator || !lic.number || !lic.title}>
              Submit for a check
            </Button>
          </form>
        )}
      </section>

      <p className="rounded-2xl border border-edge-1 bg-surface-0 px-4 py-3 text-micro leading-relaxed text-ink-3">
        A confirmed claim is a record that somebody checked a fact on a date. It
        is not a guarantee of work, a payment promise, or a substitute for your
        own judgement about who you trade with.
      </p>
    </div>
  );
}
