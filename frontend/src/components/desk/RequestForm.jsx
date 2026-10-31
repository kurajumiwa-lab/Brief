import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, X } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { num } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * THE THIRD STEP — requirements, not checkout.
 *
 * The desk ends in a written request, because nothing on it may take a card:
 * the catalogue's prices are ranges, a pilot is a contract, and a scoped
 * deployment has no published price at all. What the customer gets back is a
 * human, a quotation and an invoice on a channel that already exists.
 *
 * Two fields are asked because two fields are used. Everything else is optional
 * — a form that demands a procurement department's worth of detail before a
 * callback is a form nobody finishes.
 */
const KIND_LABEL = {
  purchase: "Purchase",
  quotation: "Quotation",
  pilot: "Pilot participation",
  requirements: "Requirements",
  interest: "Register interest",
  trial: "Business trial request",
  discovery_call: "Discovery call",
};

export default function RequestForm({
  kind = "quotation",
  offer,
  desk,
  trial,
  signedIn,
  busy,
  onSubmit,
  onCancel,
  className,
}) {
  const [form, setForm] = useState({
    organisation_name: "",
    contact_phone: "",
    notes: "",
    acknowledged_first_charge: false,
  });

  useEffect(() => {
    setForm({ organisation_name: "", contact_phone: "", notes: "", acknowledged_first_charge: false });
  }, [kind, offer?.key]);

  const isTrial = kind === "trial";
  const title = offer ? `${KIND_LABEL[kind] || "Enquiry"} — ${offer.name}` : `${KIND_LABEL[kind] || "Enquiry"} — ${desk?.title || "Business desk"}`;

  return (
    <form
      data-testid="desk-request-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...form, kind });
      }}
      className={cn("space-y-3 rounded-xl border border-edge-1 bg-surface-0 p-3", className)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-ink-1">{title}</h2>
          <p className="mt-0.5 text-2xs text-ink-3">
            {isTrial
              ? "This records a trial request. No card is asked for and no charge is made."
              : "A human replies with scope and a written quotation. No payment is taken here."}
          </p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close the request"
            className="shrink-0 rounded-full p-1 text-ink-4 hover:bg-surface-2 hover:text-ink-1"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          label="Organisation"
          value={form.organisation_name}
          onChange={(e) => setForm((f) => ({ ...f, organisation_name: e.target.value }))}
          placeholder="Kisumu Boda SACCO"
          data-testid="desk-organisation"
        />
        <Input
          label="Phone for the callback"
          value={form.contact_phone}
          onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))}
          placeholder="2547…"
          data-testid="desk-phone"
        />
      </div>

      <Textarea
        label={offer ? "Anything that decides the quotation" : "What do you need?"}
        value={form.notes}
        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        placeholder="Team size, locations, systems you already use — whatever decides the price."
        data-testid="desk-notes"
      />

      {isTrial && trial?.example && (
        <label className="flex items-start gap-2 text-2xs text-ink-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.acknowledged_first_charge}
            onChange={(e) => setForm((f) => ({ ...f, acknowledged_first_charge: e.target.checked }))}
            data-testid="desk-acknowledge-charge"
          />
          <span>
            I have seen the example first charge (KSh {num(trial.example.first_charge_amount_kes)}{" "}
            on {trial.example.first_charge_date}) and understand the trial is not yet live: this
            records a request, takes no card and makes no charge.
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {signedIn ? (
          <Button type="submit" size="sm" loading={busy} data-testid="desk-submit">
            Send request
          </Button>
        ) : (
          <Link to="/auth" state={{ from: "/storefront" }}>
            <Button type="button" size="sm" data-testid="desk-signin">
              Sign in to send
            </Button>
          </Link>
        )}
        <Badge variant="gray" size="sm">
          <ShieldCheck size={10} aria-hidden="true" /> No card, no charge
        </Badge>
      </div>

      <p className="text-micro leading-relaxed text-ink-4">
        Prices on the desk are test ranges, not commitments — confirmed in writing per contract
        before payment. Invoicing runs on an existing verified channel (M-Pesa/bank) until
        subscription billing is verified.
      </p>
    </form>
  );
}
