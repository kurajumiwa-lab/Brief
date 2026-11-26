import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { CategoryTiles } from "@/components/search/MarketplaceSearch";
import { resultsHref } from "@/config/searchCategories";

/**
 * THE BROWSE CATEGORIES — the same five, as doors.
 *
 * The brief asks for "a clean two-column image-led category grid", and the
 * categories themselves are now a single vocabulary: All, Goods, Services,
 * Rentals and Events. They are the SAME list the search uses on Explore — one
 * vocabulary, two presentations — so a person who learns "Services is the
 * blue-green one" here is right about it there too.
 *
 * On Home they are doors rather than filters: Home is not a results screen,
 * so a category here goes TO the results, with that category already chosen.
 */
export default function DiscoveryBand({ category = "all" }) {
  return (
    <section aria-labelledby="discovery-heading" data-testid="discovery-band" className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="discovery-heading" className="ds-title">
          What are you after?
        </h2>
        <Link to={resultsHref({ category: "all" })} className="ds-action">
          Browse all
          <ChevronRight size={13} aria-hidden="true" />
        </Link>
      </div>

      <CategoryTiles
        value={category}
        categoryHref={(key) => resultsHref({ category: key })}
      />
    </section>
  );
}
