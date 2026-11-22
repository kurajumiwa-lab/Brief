import { CheckCircle2, Share2, ShieldCheck } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import Modal from "@/components/ui/Modal";
import { agendaCounter, agendaDatePill, agendaMeta } from "@/lib/agenda";

/**
 * THE SHARED TRADE PASS.
 *
 * One pass for an event seat, a confirmed booking and an accepted round. The
 * QR points at the record the pass came from; the large code is the same
 * `HO-84K` shape as a voucher, so a host at a busy counter can read it without
 * a camera. Nothing here is generated on the client: an item without a real
 * registration/booking record never reaches this component with `passable`.
 */
export default function TradePassModal({ pass, memberHandle, onClose }) {
  if (!pass) return null;

  const code = pass.pass_code || "";
  const counter = agendaCounter(pass);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const separator = String(pass.to || "").includes("?") ? "&" : "?";
  const passUrl = `${origin}${pass.to || ""}${separator}pass=${encodeURIComponent(code)}`;

  const share = () => {
    const text = [
      `Brief pass • ${pass.title}`,
      `Code: ${code}`,
      `When: ${agendaDatePill(pass.starts_at)}`,
      agendaMeta(pass),
      passUrl,
    ].filter(Boolean).join("\n");
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <Modal open onClose={onClose} title="Trade pass" size="sm">
      <div data-testid="trade-pass" className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-brand-700 px-4 py-3 text-white">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-brand-200" aria-hidden="true" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-200">
                {pass.kind === "event" ? "Event pass" : "Trade pass"}
              </p>
              <p className="text-micro font-semibold text-brand-100">On record · {pass.status_label}</p>
            </div>
          </div>
          <span className="rounded-full bg-white/15 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em]">
            {pass.kind}
          </span>
        </div>

        <div className="overflow-hidden rounded-2xl border border-edge-1 bg-surface-1">
          <div className="border-b border-dashed border-edge-2 p-4">
            <h3 className="text-base font-extrabold leading-snug text-ink-1">{pass.title}</h3>
            <p className="mt-1 text-micro text-ink-3">
              {agendaDatePill(pass.starts_at)} · {agendaMeta(pass)}
            </p>
            {counter && <p className="mt-1 text-[11px] font-semibold text-ink-2">{counter}</p>}
          </div>

          <div className="relative grid place-items-center bg-surface-0 px-4 py-5 text-center">
            <span className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-edge-1 bg-surface-0" aria-hidden="true" />
            <span className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-edge-1 bg-surface-0" aria-hidden="true" />
            <div className="rounded-xl border border-edge-2 bg-white p-2">
              <QRCodeSVG value={passUrl} size={128} fgColor="#0F3D2E" bgColor="#FFFFFF" level="M" />
            </div>
            <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-4">
              Host / shop code
            </p>
            <p
              className="mt-1 rounded-xl border border-brand-200 bg-brand-50 px-4 py-1.5 font-mono text-xl font-black tracking-[0.18em] text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/15 dark:text-brand-300"
              data-testid="trade-pass-code"
            >
              {code}
            </p>
            <p className="mt-2 max-w-xs text-[10px] leading-relaxed text-ink-4">
              Show this screen at the meeting point or counter. The code works
              without a signal; the host confirms it against your record.
            </p>
          </div>

          <dl className="grid gap-1.5 p-4 text-micro">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-4">Member</dt>
              <dd className="truncate font-semibold text-ink-1">
                {memberHandle ? `/p/${memberHandle}` : "Your page"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-4">Counterparty</dt>
              <dd className="truncate text-right font-semibold text-ink-1">
                {pass.counterparty?.name || "On record"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-4">Reference</dt>
              <dd className="font-mono text-[11px] text-ink-3">{pass.record_id}</dd>
            </div>
          </dl>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={share}
            data-testid="trade-pass-share"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-edge-2 bg-surface-1 px-3 py-2.5 text-micro font-bold text-ink-1 transition-colors hover:bg-surface-2"
          >
            <Share2 size={13} className="text-brand-700 dark:text-brand-300" aria-hidden="true" />
            Share pass
          </button>
          <button
            type="button"
            onClick={onClose}
            data-testid="trade-pass-done"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-700 px-3 py-2.5 text-micro font-bold text-white transition-colors hover:bg-brand-800"
          >
            <CheckCircle2 size={13} aria-hidden="true" />
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
