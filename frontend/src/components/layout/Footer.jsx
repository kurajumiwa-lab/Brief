import { Link } from "react-router-dom";
import { LogoMark } from "./Logo";
import { SECTION_GROUPS } from "@/config/navigation";

/**
 * A quiet footer that does real work: it is the full sitemap, which keeps
 * every destination crawlable and reachable without the drawer.
 */
export default function Footer() {
  return (
    <footer className="hidden lg:block border-t border-edge-1 bg-surface-1 mt-8">
      <div className="container-app py-10">
        <div className="grid grid-cols-5 gap-8">
          <div className="col-span-1">
            <div className="flex items-center gap-2">
              <LogoMark size={28} />
              <span className="text-base font-extrabold tracking-tight text-ink-1">brief</span>
            </div>
            <p className="mt-3 text-2xs text-ink-4 leading-relaxed">
              The trade network with receipts. Every account is a business — no shoppers, no cart.
            </p>
          </div>
          {SECTION_GROUPS.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h2 className="text-micro uppercase tracking-[0.12em] font-bold text-ink-4">{group.title}</h2>
              <ul className="mt-3 space-y-2">
                {group.items
                  .filter((i) => !i.quiet)
                  .map((item) => (
                    <li key={item.to + item.label}>
                      <Link to={item.to} className="text-2xs text-ink-3 hover:text-ink-1 hover:underline underline-offset-2">
                        {item.label}
                      </Link>
                    </li>
                  ))}
              </ul>
            </nav>
          ))}
        </div>
        <p className="mt-10 pt-5 border-t border-edge-1 text-micro text-ink-4">
          Counts are live rows · prices are vendor-stated and timestamped · place data © OpenStreetMap contributors (ODbL)
        </p>
      </div>
    </footer>
  );
}
