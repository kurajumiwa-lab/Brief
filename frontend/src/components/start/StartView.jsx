import { useState } from "react";
import {
  ArrowLeft, ArrowRight, Building2, Check, Circle, Compass, Mail, Phone,
  ShieldCheck, UserRound,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import { CAPABILITIES, INTENT, INTENTS, INSTITUTION_KINDS, AFFILIATION_METHODS } from "@/config/identity";
import { cn } from "@/lib/utils";

const INTENT_ICON = { compass: Compass, user: UserRound, building: Building2 };

/**
 * START — the only onboarding question, and the only place the old model has to
 * be actively undone.
 *
 * The old sign-up asked for a business category before the person had seen the
 * product. That is a preselected list wearing a form: it tells a nurse, a
 * boda rider and a school that they are all "vendors", then asks them to pick a
 * shelf that may be wrong by next month.
 *
 * Here the first question is *why you joined*, and "just looking" is a complete
 * answer. Capabilities come second and are switchable for ever. An institution
 * claim is a claim, not a badge: it starts waiting, and it stays waiting until
 * the institution answers the connection test.
 *
 * Nothing is pre-ticked. Nothing is required except one choice.
 */
export default function StartView({
  initialIntent = null,
  initialCapabilities = [],
  initialAffiliation = null,
  saving = false,
  error = null,
  onSave,
  onSkip,
  heading = "Welcome in",
  name = "",
}) {
  const [step, setStep] = useState(0);
  const [intent, setIntent] = useState(initialIntent);
  const [capabilities, setCapabilities] = useState(initialCapabilities);
  const [affiliation, setAffiliation] = useState(initialAffiliation || {});
  const [method, setMethod] = useState("domain_email");

  const representing = intent === INTENT.REPRESENT;
  const canContinue =
    step === 0
      ? Boolean(intent)
      : step === 1
        ? !representing ||
          (affiliation.name?.trim() &&
            (method === "domain_email" ? affiliation.official_email?.trim() : affiliation.official_phone?.trim()))
        : true;

  function toggle(value) {
    setCapabilities((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  function finish() {
    onSave?.({
      intent,
      capabilities,
      affiliation: representing
        ? {
            ...affiliation,
            method,
          }
        : null,
    });
  }

  return (
    <div className="mx-auto w-full max-w-lg">
      <header className="text-center">
        <p className="eyebrow">Wasta</p>
        <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-ink-1">
          {step === 0 ? (name ? `${heading}, ${name}` : heading) : step === 1 ? "What can you do today?" : "Before you start"}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-3">
          {step === 0
            ? "There is no list to pick from. Tell us why you are here and change it whenever you like."
            : step === 1
              ? representing
                ? "The institution you represent, and the route we can use to check it."
                : "Pick only what is true right now. Nothing is pre-selected, and you can turn any of it on later."
              : "This is what other people will be able to see."}
        </p>
      </header>

      <div className="mt-5 flex items-center justify-center gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className={cn(
              "h-1.5 rounded-full transition-all",
              index === step ? "w-6 bg-brand-700" : index < step ? "w-1.5 bg-brand-400" : "w-1.5 bg-edge-2",
            )}
          />
        ))}
      </div>

      <div className="mt-5 rounded-2xl border border-edge-1 bg-surface-1 p-4 sm:p-5">
        {step === 0 && (
          <ul className="space-y-2">
            {INTENTS.map((option) => {
              const Icon = INTENT_ICON[option.icon] || Compass;
              const active = intent === option.value;
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    onClick={() => setIntent(option.value)}
                    aria-pressed={active}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-brand-500",
                      active
                        ? "border-brand-300 bg-brand-50/70 dark:border-brand-500/40 dark:bg-brand-500/10"
                        : "border-edge-1 hover:border-edge-2 hover:bg-surface-2",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                        active
                          ? "bg-brand-700 text-white"
                          : "bg-surface-2 text-ink-2",
                      )}
                    >
                      <Icon size={18} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-ink-1">{option.label}</span>
                      <span className="mt-0.5 block text-2xs leading-relaxed text-ink-3">{option.blurb}</span>
                      {active && (
                        <span className="mt-1 block text-2xs leading-relaxed text-brand-800 dark:text-brand-300">
                          {option.detail}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border",
                        active ? "border-brand-700 bg-brand-700 text-white" : "border-edge-2",
                      )}
                      aria-hidden="true"
                    >
                      {active && <Check size={12} strokeWidth={3} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {step === 1 && !representing && (
          <>
            <ul className="space-y-1.5">
              {CAPABILITIES.map((capability) => {
                const active = capabilities.includes(capability.value);
                return (
                  <li key={capability.value}>
                    <button
                      type="button"
                      onClick={() => toggle(capability.value)}
                      aria-pressed={active}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-brand-500",
                        active
                          ? "border-brand-200 bg-brand-50/60 dark:border-brand-500/30 dark:bg-brand-500/10"
                          : "border-edge-1 hover:bg-surface-2",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border",
                          active ? "border-brand-700 bg-brand-700 text-white" : "border-edge-2 text-transparent",
                        )}
                        aria-hidden="true"
                      >
                        <Check size={12} strokeWidth={3} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-bold text-ink-1">{capability.label}</span>
                        <span className="block text-2xs leading-snug text-ink-3">{capability.blurb}</span>
                        {active && (
                          <span className="mt-0.5 block text-micro font-medium text-brand-700 dark:text-brand-400">
                            Unlocks: {capability.unlocks}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-micro leading-relaxed text-ink-4">
              Nothing here is permanent. A capability is a switch, not a label.
            </p>
          </>
        )}

        {step === 1 && representing && (
          <div className="space-y-3">
            <div>
              <label htmlFor="aff-name" className="mb-1 block text-2xs font-bold text-ink-2">
                Institution name
              </label>
              <Input
                id="aff-name"
                value={affiliation.name || ""}
                onChange={(event) => setAffiliation({ ...affiliation, name: event.target.value })}
                placeholder="e.g. Ahero Community Clinic"
                autoComplete="organization"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="aff-kind" className="mb-1 block text-2xs font-bold text-ink-2">
                  Kind
                </label>
                <Select
                  id="aff-kind"
                  value={affiliation.kind || ""}
                  onChange={(event) => setAffiliation({ ...affiliation, kind: event.target.value })}
                >
                  <option value="">Choose one</option>
                  {INSTITUTION_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{kind}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label htmlFor="aff-role" className="mb-1 block text-2xs font-bold text-ink-2">
                  Your role
                </label>
                <Input
                  id="aff-role"
                  value={affiliation.role || ""}
                  onChange={(event) => setAffiliation({ ...affiliation, role: event.target.value })}
                  placeholder="e.g. Administrator"
                />
              </div>
            </div>

            <div>
              <label htmlFor="aff-reg" className="mb-1 block text-2xs font-bold text-ink-2">
                Registration or permit number <span className="font-normal text-ink-4">(if any)</span>
              </label>
              <Input
                id="aff-reg"
                value={affiliation.registration_no || ""}
                onChange={(event) => setAffiliation({ ...affiliation, registration_no: event.target.value })}
                placeholder="Optional"
              />
            </div>

            <fieldset className="rounded-2xl border border-edge-1 bg-surface-0 p-3">
              <legend className="px-1 text-2xs font-bold text-ink-2">Connection test</legend>
              <p className="mb-2 text-micro leading-relaxed text-ink-4">
                We do not take a typed name as proof. Choose how the institution can confirm you.
              </p>
              <div className="space-y-1.5">
                {AFFILIATION_METHODS.map((option) => {
                  const Icon = option.icon === "phone" ? Phone : option.icon === "file" ? ShieldCheck : Mail;
                  const active = method === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setMethod(option.value)}
                      aria-pressed={active}
                      className={cn(
                        "flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left",
                        active
                          ? "border-brand-300 bg-surface-1 dark:border-brand-500/40"
                          : "border-transparent hover:bg-surface-2",
                      )}
                    >
                      <Icon size={15} className="mt-0.5 shrink-0 text-ink-3" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-2xs font-bold text-ink-1">{option.label}</span>
                        <span className="block text-micro text-ink-4">{option.blurb}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="aff-email" className="mb-1 block text-2xs font-bold text-ink-2">
                  Official email
                </label>
                <Input
                  id="aff-email"
                  type="email"
                  value={affiliation.official_email || ""}
                  onChange={(event) => setAffiliation({ ...affiliation, official_email: event.target.value })}
                  placeholder="name@institution.org"
                  autoComplete="email"
                />
              </div>
              <div>
                <label htmlFor="aff-phone" className="mb-1 block text-2xs font-bold text-ink-2">
                  Official phone
                </label>
                <Input
                  id="aff-phone"
                  type="tel"
                  value={affiliation.official_phone || ""}
                  onChange={(event) => setAffiliation({ ...affiliation, official_phone: event.target.value })}
                  placeholder="+254 …"
                  autoComplete="tel"
                />
              </div>
            </div>

            <div>
              <label htmlFor="aff-note" className="mb-1 block text-2xs font-bold text-ink-2">
                Anything the reviewer should know <span className="font-normal text-ink-4">(optional)</span>
              </label>
              <Textarea
                id="aff-note"
                rows={2}
                value={affiliation.note || ""}
                onChange={(event) => setAffiliation({ ...affiliation, note: event.target.value })}
                placeholder="A branch, a department, or who will answer the test."
              />
            </div>

            <p className="rounded-xl bg-accent-50 px-3 py-2 text-micro leading-relaxed text-accent-900 dark:bg-accent-600/10 dark:text-accent-200">
              The claim starts as <strong>waiting</strong>. It becomes a badge only
              when the institution answers the test. Until then your page says so.
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-surface-0 p-3">
              <p className="eyebrow">Why you joined</p>
              <p className="mt-1 text-sm font-bold text-ink-1">
                {INTENTS.find((item) => item.value === intent)?.label}
              </p>
              <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">
                {INTENTS.find((item) => item.value === intent)?.detail}
              </p>
            </div>

            {capabilities.length > 0 ? (
              <div>
                <p className="eyebrow">Turned on</p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {capabilities.map((value) => {
                    const capability = CAPABILITIES.find((item) => item.value === value);
                    return (
                      <li key={value} className="rounded-full border border-edge-1 bg-surface-0 px-2.5 py-1 text-2xs font-semibold text-ink-2">
                        {capability?.short}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <p className="text-2xs text-ink-3">
                Nothing turned on. That is a complete answer — you can add a
                capability from You whenever you need it.
              </p>
            )}

            {representing && (
              <div>
                <p className="eyebrow">Institution claim</p>
                <p className="mt-1 text-xs font-bold text-ink-1">{affiliation.name}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-2xs text-ink-3">
                  <Circle size={8} className="text-accent-700" aria-hidden="true" />
                  Waiting for the institution to answer the connection test
                </p>
              </div>
            )}

            {error && <p role="alert" className="text-2xs font-medium text-danger">{error}</p>}

            <p className="rounded-xl border border-edge-1 bg-surface-0 px-3 py-2 text-micro leading-relaxed text-ink-3">
              Your page starts private. Publish it from You when you are ready —
              a page nobody has seen yet is not a missing profile, it is a draft.
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2">
        {step > 0 && (
          <Button variant="ghost" size="md" icon={ArrowLeft} onClick={() => setStep((value) => value - 1)}>
            Back
          </Button>
        )}
        <div className="flex-1" />
        {step < 2 ? (
          <Button
            size="md"
            iconRight={ArrowRight}
            disabled={!canContinue}
            onClick={() => setStep((value) => value + 1)}
          >
            Continue
          </Button>
        ) : (
          <Button size="md" loading={saving} onClick={finish}>
            {representing ? "Send the claim" : "Open my page"}
          </Button>
        )}
      </div>

      <div className="mt-3 text-center">
        <button
          type="button"
          onClick={onSkip}
          className="text-micro font-semibold text-ink-4 hover:text-ink-2"
        >
          {step === 2 ? "Not now" : "Skip for now"}
        </button>
      </div>
    </div>
  );
}
