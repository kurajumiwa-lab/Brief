import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, BadgeCheck, Coins, ShieldCheck, Sparkles } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { useAuthStore } from "@/stores/authStore";
import { apiError } from "@/lib/api";
import { townAPI } from "@/lib/townApi";
import { formatKes } from "@/lib/receipts";

export default function ReferralShareLandingPage() {
  const { code } = useParams();
  const token = useAuthStore((s) => s.token);
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    townAPI.publicVisit(code)
      .then(({ data }) => { if (active) setPayload(data); })
      .catch((err) => { if (active) setError(apiError(err, "This referral link is not available")); });
    return () => { active = false; };
  }, [code]);

  if (error) {
    return <EmptyState icon={Coins} tone="danger" title="This link is closed" description={error} action={<Button as={Link} to="/referral-index" size="sm">Browse the index</Button>} />;
  }
  if (!payload) return <PageSpinner label="Opening the referral…" />;

  const listing = payload.listing;
  const target = `/referral-index?claim=${listing.id}&share=${code}`;

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 py-6">
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={listing.verification_status === "verified" ? "brand" : "outline"}>
            {listing.verification_status === "verified" && <BadgeCheck size={10} />}
            {listing.verification_status}
          </Badge>
          {listing.sponsored && <Badge variant="amber" dot><Sparkles size={10} /> Sponsored</Badge>}
          <span className="text-micro text-ink-4">{listing.provider}</span>
        </div>
        <div>
          <p className="eyebrow">A referral from a person, not an advert</p>
          <h1 className="mt-1 text-xl font-extrabold tracking-tight text-ink-1">{listing.title}</h1>
          <p className="mt-2 text-xs leading-relaxed text-ink-3">{listing.description || listing.offer_terms || "Open the listing to see the conditions."}</p>
        </div>
        {Number(listing.bounty_kes) > 0 && (
          <div className="rounded-2xl border border-edge-1 bg-surface-0 px-4 py-3">
            <p className="text-micro font-bold uppercase tracking-wide text-ink-4">Possible bounty to the referrer</p>
            <p className="digital mt-1 text-xl font-extrabold text-brand-700 dark:text-brand-300">{formatKes(listing.bounty_kes)}</p>
            <p className="mt-1 text-2xs leading-relaxed text-ink-3">
              This goes to the person who shared the link, not to you. It is paid directly by
              the funder after an operator verifies the qualifying action; the platform never
              holds it.
            </p>
          </div>
        )}
        <div className="flex items-center gap-2 text-2xs text-ink-3">
          <ShieldCheck size={13} /> Needs trust Level {listing.trust_level_required}. Verify your phone before claiming.
        </div>
        <Button as={Link} to={token ? target : `/auth?mode=register&next=${encodeURIComponent(target)}`} fullWidth>
          {token ? "Open and claim the provider's offer" : "Create an account to claim the offer"} <ArrowRight size={15} />
        </Button>
        <p className="text-center text-[10px] leading-relaxed text-ink-4">
          {payload.disclosure}
        </p>
      </Card>
      <Link to="/referral-index" className="block text-center text-2xs font-semibold text-brand-700 dark:text-brand-300">
        Browse all referral listings
      </Link>
    </div>
  );
}
