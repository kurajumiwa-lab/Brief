import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { LogoMark } from "./Logo";

/** A quiet brand footer, not a second sitemap. */
export default function Footer() {
  return (
    <footer className="hidden lg:block border-t border-edge-1 bg-surface-1 mt-10">
      <div className="container-app py-7 flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-3">
          <LogoMark size={30} />
          <div>
            <p className="text-sm font-extrabold tracking-tight text-ink-1">ogallo</p>
            <p className="text-2xs text-ink-4">A trading network built on real records.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="inline-flex items-center gap-1.5 text-2xs text-ink-3">
            <CheckCircle2 size={14} className="text-brand-700 dark:text-brand-400" aria-hidden="true" />
            Prices are vendor-stated
          </span>
          <span className="inline-flex items-center gap-1.5 text-2xs text-ink-3">
            <ShieldCheck size={14} className="text-orchid-600 dark:text-orchid-300" aria-hidden="true" />
            Trust is earned through fulfilment
          </span>
          <Link to="/browse" className="inline-flex items-center gap-1 text-2xs font-semibold text-brand-800 hover:text-brand-700 dark:text-brand-300">
            Browse the network <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </footer>
  );
}
