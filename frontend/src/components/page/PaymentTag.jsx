import { useState } from "react";
import { Copy, Wallet } from "lucide-react";

/**
 * The owner's own Till or Paybill, published on the Page.
 *
 * It is the same rail for a shop, a service provider and an event host: the
 * customer pays the owner directly. Nothing here says the platform verified
 * the number, and nothing here takes a payment.
 */
export default function PaymentTag({ tag, className = "" }) {
  const [copied, setCopied] = useState(false);
  if (!tag?.number) return null;
  const kind = tag.type === "till" ? "Till" : "Paybill";
  const text = `${kind}: ${tag.number}${tag.account ? ` · Account: ${tag.account}` : ""}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // The number is on screen and can be selected.
    }
  };
  return (
    <section
      data-testid="page-payment-tag"
      className={`rounded-xl border border-edge-1 bg-surface-1 p-3 text-sm ${className}`}
    >
      <p className="flex items-center gap-1.5 font-bold text-ink-1">
        <Wallet size={14} className="text-brand-700 dark:text-brand-300" aria-hidden="true" />
        M-Pesa {kind}: {tag.number}
        {tag.account ? <span className="font-normal text-ink-3">· Account: {tag.account}</span> : null}
      </p>
      <p className="mt-1 text-xs text-ink-4">
        The owner published this number themselves. Check the recipient before paying;
        Home Office does not hold the money or confirm the payment.
      </p>
      <button
        type="button"
        onClick={copy}
        className="mt-2 inline-flex h-9 items-center gap-1 rounded-lg border border-edge-1 px-2.5 text-micro font-bold text-ink-2 hover:border-edge-2"
      >
        <Copy size={12} aria-hidden="true" /> {copied ? "Copied" : "Copy payment details"}
      </button>
    </section>
  );
}
