import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Check, Receipt, ShieldCheck, UserPlus } from "lucide-react";
import Button from "@/components/ui/Button";
import Logo from "@/components/layout/Logo";
import { PageSpinner } from "@/components/ui/Spinner";
import { referralAPI, apiError } from "@/lib/api";
import { priceLabel } from "@/lib/categoryArt";
import { useAuthStore } from "@/stores/authStore";

const STORAGE_KEY = "brief-referral-code";

export default function ReferralLandingPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await referralAPI.publicCode(code);
        if (cancelled) return;
        setInvite(data);
        if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, data.code);
      } catch (err) {
        if (!cancelled) setError(apiError(err, "This invitation could not be opened."));
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  const continueToInvite = () => {
    const next = `/referrals?code=${encodeURIComponent(invite.code)}`;
    if (token) {
      navigate(next, { replace: true });
      return;
    }
    navigate("/auth?mode=register", { state: { from: next } });
  };

  const signIn = () => {
    const next = `/referrals?code=${encodeURIComponent(invite.code)}`;
    navigate("/auth?mode=login", { state: { from: next } });
  };

  if (!invite && !error) {
    return <div className="min-h-dvh bg-surface-1"><PageSpinner label="Opening the invitation…" /></div>;
  }

  return (
    <div className="min-h-dvh bg-surface-1">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <Logo />
        <Link to="/" className="text-2xs font-semibold text-ink-3 hover:text-ink-1">Browse Brief</Link>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-10 pt-2">
        {error ? (
          <section className="mx-auto max-w-md rounded-2xl border border-edge-2 bg-surface-0 p-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300">
              <ShieldCheck size={22} />
            </div>
            <h1 className="mt-3 text-lg font-bold text-ink-1">This invitation is not active</h1>
            <p className="mt-1 text-2xs text-ink-3">{error}</p>
            <Button className="mt-4" variant="secondary" as={Link} to="/">Go to Brief</Button>
          </section>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <section className="overflow-hidden rounded-3xl border border-edge-2 bg-surface-0 shadow-sm">
              <div className="bg-ink-1 px-5 py-6 text-surface-0">
                <span className="inline-flex items-center rounded-full bg-white/15 px-2 py-0.5 text-micro font-semibold text-white">
                  A verified referral invitation
                </span>
                <h1 className="mt-3 text-2xl font-extrabold leading-tight tracking-tight">
                  {invite.campaign.title}
                </h1>
                <p className="mt-2 text-sm text-surface-0/75">
                  {invite.referrer.name} invited you to shop at {invite.merchant.name}.
                </p>
              </div>

              <div className="space-y-4 p-5">
                {invite.campaign.description && (
                  <p className="text-sm leading-relaxed text-ink-2">{invite.campaign.description}</p>
                )}

                <div className="grid gap-2 sm:grid-cols-2">
                  {invite.campaign.reward_points > 0 && (
                    <div className="rounded-2xl bg-brand-50 p-3 dark:bg-brand-500/10">
                      <p className="text-micro font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">You earn</p>
                      <p className="mt-1 text-lg font-bold text-ink-1">{invite.campaign.reward_points} points</p>
                      <p className="text-micro text-ink-3">Rewards, not money.</p>
                    </div>
                  )}
                  {invite.campaign.reward_kes > 0 && (
                    <div className="rounded-2xl bg-surface-2 p-3">
                      <p className="text-micro font-semibold uppercase tracking-wide text-ink-3">The shop pays</p>
                      <p className="mt-1 text-lg font-bold text-ink-1">{priceLabel(invite.campaign.reward_kes)}</p>
                      <p className="text-micro text-ink-4">Directly, after your receipt verifies.</p>
                    </div>
                  )}
                </div>

                <Button size="lg" fullWidth icon={UserPlus} onClick={continueToInvite}>
                  Continue with this invitation
                </Button>
                <p className="text-center text-micro text-ink-4">
                  Already on Brief? <button type="button" onClick={signIn} className="font-semibold text-brand-700 underline dark:text-brand-300">Sign in</button>
                </p>
              </div>
            </section>

            <aside className="space-y-3">
              <div className="rounded-2xl border border-edge-2 bg-surface-0 p-4">
                <div className="flex items-center gap-2">
                  <Receipt size={16} className="text-tech-600" />
                  <h2 className="text-sm font-bold text-ink-1">How you qualify</h2>
                </div>
                <ol className="mt-2 space-y-2 text-2xs text-ink-2">
                  <li className="flex gap-2"><span className="font-bold text-brand-700 dark:text-brand-300">1</span> Join or sign in before you shop.</li>
                  <li className="flex gap-2"><span className="font-bold text-brand-700 dark:text-brand-300">2</span> Buy something at {invite.merchant.name}.</li>
                  <li className="flex gap-2"><span className="font-bold text-brand-700 dark:text-brand-300">3</span> Submit the receipt in Brief.</li>
                  <li className="flex gap-2"><span className="font-bold text-brand-700 dark:text-brand-300">4</span> The receipt engine verifies it and releases the reward.</li>
                </ol>
                <p className="mt-3 rounded-xl bg-surface-2 p-2 text-micro text-ink-3">
                  {invite.verification}
                </p>
              </div>

              <div className="rounded-2xl border border-edge-2 bg-surface-0 p-4">
                <div className="flex items-center gap-2 text-2xs font-semibold text-ink-1">
                  <Check size={15} className="text-tech-600" />
                  One person, one real purchase
                </div>
                <p className="mt-1 text-micro text-ink-4">
                  Existing customers do not count, duplicate receipts do not count, and no one can refer themselves.
                </p>
              </div>

              <Link to="/" className="flex items-center justify-between rounded-2xl border border-edge-2 bg-surface-0 p-3 text-2xs font-semibold text-ink-2 hover:bg-surface-2">
                See what else is happening around {invite.merchant.region || "you"}
                <ArrowRight size={14} />
              </Link>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
