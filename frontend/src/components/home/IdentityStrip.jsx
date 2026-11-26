import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight, Building2, Check, Copy, MessageCircle, PenLine,
} from "lucide-react";
import { pageUrl, shareLinks } from "@/lib/pageShare";
import { initials } from "@/lib/utils";

/**
 * ONE IDENTITY STRIP, NOT TWO BOXES.
 *
 * "Your page" and "Home office" were the same question asked twice at the
 * bottom of the screen: who am I here, and what do I send to somebody? The
 * answer now sits under the greeting, with the one action that matters — pass
 * the page into a WhatsApp thread.
 *
 * They are NOT the same identity. The Page is the public front door a customer
 * opens; the office is the private workroom only members see. The labels say
 * so, because the old copy let the two read as one thing.
 */
export default function IdentityStrip({ name, page = {}, institution = null }) {
  const [copied, setCopied] = useState(false);
  const published = page.published !== false && Boolean(page.href);
  const handle = String(page.href || "").replace(/^\/p\//, "") || null;
  const url = handle ? pageUrl(handle) : "";
  const links = shareLinks({ handle, title: name });

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked; the WhatsApp link still works.
    }
  };

  if (!published && !institution) {
    return (
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-edge-2 bg-surface-0 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-ink-1">Your page is not published yet</p>
          <p className="mt-0.5 text-micro text-ink-4">
            A page is the card you send when somebody asks what you do.
          </p>
        </div>
        <Link
          to="/you/page"
          className="inline-flex items-center gap-1 text-micro font-bold text-brand-700 hover:underline dark:text-brand-400"
        >
          <PenLine size={12} aria-hidden="true" /> Create it
        </Link>
      </section>
    );
  }

  return (
    <section className="soft-card overflow-hidden rounded-2xl bg-surface-1" data-testid="identity-strip">
      <div className="flex items-start gap-3 p-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-700 text-sm font-extrabold text-white">
          {initials(name || "You")}
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Public page</p>
          <p className="truncate text-sm font-extrabold text-ink-1">{name}</p>
          <p className="mt-0.5 truncate text-micro text-ink-4">
            {published ? url.replace(/^https?:\/\//, "") : "Not published yet"}
          </p>
          {/* Page statistics belong on Profile, not in Home's first screen.
              The public address and the one share action are what a person
              needs here; the numbers were a dashboard in miniature. */}
        </div>
        <div className="flex shrink-0 gap-1.5">
          {published && (
            <a
              href={links.whatsapp}
              target="_blank"
              rel="noreferrer"
              aria-label="Share your page on WhatsApp"
              className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-700 transition-colors hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300"
              data-testid="identity-share"
            >
              <MessageCircle size={16} aria-hidden="true" />
            </a>
          )}
          {published && (
            <button
              type="button"
              onClick={copy}
              aria-label="Copy your page address"
              className="grid h-9 w-9 place-items-center rounded-xl border border-edge-2 bg-surface-0 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1"
              data-testid="identity-copy"
            >
              {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            </button>
          )}
          <Link
            to="/you/page"
            aria-label={published ? "Edit your page" : "Create your page"}
            className="grid h-9 w-9 place-items-center rounded-xl border border-edge-2 bg-surface-0 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1"
          >
            <PenLine size={16} aria-hidden="true" />
          </Link>
        </div>
      </div>

      {institution && (
        <div className="flex items-center gap-2.5 border-t border-edge-1 bg-surface-0 px-4 py-3">
          <Building2 size={15} className="shrink-0 text-ink-4" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-micro text-ink-4">Private office</p>
            <p className="truncate text-xs font-bold text-ink-1">{institution.name}</p>
          </div>
          <span className="hidden truncate text-micro text-ink-4 sm:block">
            {institution.line} · only your team sees this
          </span>
          <Link
            to="/office"
            className="inline-flex shrink-0 items-center gap-1 text-micro font-bold text-brand-700 hover:underline dark:text-brand-400"
          >
            Open <ArrowUpRight size={11} aria-hidden="true" />
          </Link>
        </div>
      )}
    </section>
  );
}
