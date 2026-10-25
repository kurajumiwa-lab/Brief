import { useState } from "react";
import { Link } from "react-router-dom";
import { Download, ShieldCheck, Trash2, LifeBuoy } from "lucide-react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";
import { accountAPI, apiError } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

/**
 * TRUST SURFACE (v2.15) — what the platform promises, in plain words, and the
 * two data rights a member can exercise without emailing anyone.
 *
 * Deliberately readable rather than legalistic: the parties that require the
 * formal version (a bank, a county, an app store) will ask for a reviewed
 * document, and this page says so instead of pretending.
 */

const SECTIONS = [
  {
    id: "privacy",
    title: "Privacy",
    body: [
      "We collect what a trade needs: your business or household name, a handle, an email, a phone number if you give one, your location at the level you choose, your stock and the records of what you traded.",
      "We do not sell personal data, and we do not put your papers or your customers' details on the public passport. A public page shows verified facts, never scans.",
      "Your data lives in a Postgres database we control. You can download it from this page at any time, and you can close your account from this page too.",
      "Location is approximate by default. Exact gate or homestead directions are revealed only for an agreed booking window and re-lock afterwards.",
    ],
  },
  {
    id: "terms",
    title: "Terms of use",
    body: [
      "You keep ownership of the content you upload. You grant us permission to store and display it to the people you have chosen to trade with.",
      "You must be authorised to act for the business or household you register, and the documents you claim must be genuine. A false claim is grounds for suspension.",
      "Records of completed trades are append-only. This protects both sides of a deal: we cannot silently rewrite what happened, and neither can you.",
      "This is an early deployment. Where the platform cannot do something — for example take a payment — it says so rather than failing silently.",
    ],
  },
  {
    id: "refunds",
    title: "Payments, refunds and disputes",
    body: [
      "Money moves through a licensed payment provider, not through this application. We never hold your float.",
      "A payment that fails should show a reason and a retry, not a charge with no record. If money left your account and the record does not show it, open a dispute from the order it belongs to.",
      "Refunds for goods are agreed between the two trading parties. The platform records the agreement; it does not adjudicate the quality of a sack of maize.",
      "Subscription fees, once billing is live, are stated before you pay and are cancellable from the business screen.",
    ],
  },
  {
    id: "rights",
    title: "Your data rights",
    body: [
      "Kenya's Data Protection Act 2019 gives you the right to know what is held about you, to a copy of it, and to have it corrected or erased in the cases the Act allows.",
      "Two of those rights are buttons on this page: download everything, or close the account.",
      "Closing an account erases your identity — handle, name, email, phone, location, password — and withdraws your claims. It keeps the trade and ledger records, because the other side of every trade needs a valid history. Ask us to review full erasure if your circumstances require it.",
    ],
  },
];

export default function LegalPage() {
  const { vendor, logout } = useAuthStore();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");

  const download = async () => {
    setBusy(true);
    try {
      const { data } = await accountAPI.export();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `brief-export-${vendor?.vendor_handle || "account"}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Your records were exported");
    } catch (err) {
      toast.error(apiError(err, "Could not export your records"));
    } finally {
      setBusy(false);
    }
  };

  const closeAccount = async () => {
    setBusy(true);
    try {
      await accountAPI.close(confirm.trim(), reason.trim() || undefined);
      toast.success("Your account is closed");
      logout();
    } catch (err) {
      toast.error(apiError(err, "Could not close the account"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-ink-1">Trust &amp; data</h1>
        <p className="text-sm text-ink-3 mt-0.5">
          What we hold, what you can take with you, and how to leave.
        </p>
      </div>

      {SECTIONS.map((section) => (
        <Card key={section.id} as="section">
          <h2 className="text-sm font-bold text-ink-1 mb-2">{section.title}</h2>
          <ul className="space-y-2">
            {section.body.map((line) => (
              <li key={line.slice(0, 40)} className="text-2xs text-ink-3 leading-relaxed">
                {line}
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <Card as="section" className="border-brand-200 dark:border-brand-500/30">
        <h2 className="text-sm font-bold text-ink-1 flex items-center gap-2">
          <ShieldCheck size={16} className="text-brand-600 dark:text-brand-400" /> Take your data
        </h2>
        <p className="text-2xs text-ink-3 mt-1 mb-3 leading-relaxed">
          One JSON file with your account, stock, movements, requests, offers, claims and
          the messages you sent. Other people's notes and files are not included — they
          are not yours to take.
        </p>
        <Button onClick={download} disabled={busy}>
          <Download size={15} /> Download my records
        </Button>
      </Card>

      <Card as="section" className="border-rose-200 dark:border-rose-500/30">
        <h2 className="text-sm font-bold text-ink-1 flex items-center gap-2">
          <Trash2 size={16} className="text-rose-600 dark:text-rose-400" /> Close my account
        </h2>
        <p className="text-2xs text-ink-3 mt-1 mb-3 leading-relaxed">
          This cannot be undone. Your handle, name, email, phone, location and password are
          erased and your claims are withdrawn. Trade records are kept so the people you
          traded with still have a valid history.
        </p>
        <div className="space-y-2 max-w-sm">
          <label className="text-2xs font-semibold text-ink-2" htmlFor="close-confirm">
            Type <span className="font-mono">@{vendor?.vendor_handle}</span> to confirm
          </label>
          <Input
            id="close-confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={vendor?.vendor_handle || "your handle"}
            autoComplete="off"
          />
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you leaving? (optional)"
          />
          <Button variant="danger" onClick={closeAccount} disabled={busy || !confirm.trim()}>
            Close account permanently
          </Button>
        </div>
      </Card>

      <Card as="section">
        <h2 className="text-sm font-bold text-ink-1 flex items-center gap-2">
          <LifeBuoy size={16} className="text-ink-3" /> Support
        </h2>
        <p className="text-2xs text-ink-3 mt-1 leading-relaxed">
          Something broken, a payment that does not match its record, or a document that
          should have been verified: open the order or claim it belongs to and raise it
          there, so the record stays with the evidence. For anything else, contact the
          operator of this deployment.
        </p>
        <p className="text-micro text-ink-4 mt-2">
          Formal, counsel-reviewed versions of these pages are required before taking
          payments at scale; this deployment states the intent plainly, not the legal text.
        </p>
      </Card>

      <p className="text-micro text-ink-4">
        <Link to="/" className="underline">Back to the market</Link>
      </p>
    </div>
  );
}
