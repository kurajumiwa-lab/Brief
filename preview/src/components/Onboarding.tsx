import React from 'react';
import { ArrowRight, Check, MapPin, ShieldCheck, Sparkles } from 'lucide-react';
import * as briefApi from '../api/briefApi';
import type { AuthedUser, AuthProviders, OnboardingGoal, OnboardingState } from '../api/briefApi';
import type { ArrivalChannel } from './arrival';
import { isRestrictedWebview } from './arrival';
import { setPrimaryNeighborhood } from '../model/neighborhoods';

// ---------------------------------------------------------------------------
// FIRST RUN
//
// Three screens, one job: get a new person to the first thing worth keeping in
// under a minute.
//
//   1. BE SOMEONE     Google first, because typing a handle and a password is
//                     the slowest possible opening. A password account and a
//                     device-only guest account are both still one tap away.
//                     Telegram is NOT required to be a member.
//   2. WHAT FOR       One segmentation question, four options, skippable. It
//                     orders the feed; it does not fork the product.
//   3. WHERE          Location grant or a city tap. Also skippable — Brief
//                     falls back to the global ranked feed rather than
//                     blocking on a permission dialog.
//
// WHAT THIS SCREEN REFUSES TO DO.
//
// No product tour, no carousel, no five-field profile, no mandatory anything.
// Every step after identity can be skipped, and the flow never re-opens for
// someone who already answered. Advanced surfaces are not explained here at
// all — they are introduced by the ladder, in context, when the rung below
// them has actually been climbed.
//
// It renders as an overlay ON TOP of the running app, not instead of it, so
// the feed is already loading behind the flow and the first screen after it is
// warm.
// ---------------------------------------------------------------------------

export interface OnboardingProps {
  open: boolean;
  /** Null until /api/auth/providers answers; drives what may be offered. */
  providers: AuthProviders | null;
  state: OnboardingState | null;
  user: AuthedUser | null;
  /** Which app's in-app browser we were opened from (TikTok, WhatsApp, ...). */
  channel: ArrivalChannel;
  onSignedIn: (user: AuthedUser) => void;
  /** Device-only account: a real server account, no email attached. */
  onGuest: () => Promise<AuthedUser | null>;
  onStateChange: (state: OnboardingState) => void;
  onUseLocation: () => void;
  onChooseCity: (city: { lat: number; lng: number; label: string }) => void;
  onDone: (skipped: boolean) => void;
  /** Coarse place label once granted/picked, so step 3 can confirm it. */
  placeLabel: string | null;
}

const CITIES = [
  { lat: -1.2921, lng: 36.7865, label: 'Kilimani' },
  { lat: -1.3142, lng: 36.8364, label: 'South B' },
  { lat: -1.3624, lng: 36.7628, label: "Lang'ata" },
  { lat: -1.2683, lng: 36.8044, label: 'Westlands' },
  { lat: -1.2811, lng: 36.7901, label: 'Kileleshwa' },
  { lat: -1.3197, lng: 36.7065, label: 'Karen' },
  { lat: -1.2789, lng: 36.7648, label: 'Lavington' },
  { lat: -1.2235, lng: 36.8967, label: 'Kasarani' },
  { lat: -1.3214, lng: 36.8288, label: 'South C' },
  { lat: -1.2064, lng: 36.7773, label: 'Ruaka' },
  { lat: -1.3967, lng: 36.7592, label: 'Rongai' },
  { lat: -1.4808, lng: 36.9602, label: 'Kitengela' },
  { lat: -1.3619, lng: 36.6566, label: 'Ngong' },
  { lat: -1.2543, lng: 36.6631, label: 'Kikuyu' },
  { lat: -1.1026, lng: 37.0144, label: 'Juja' },
  { lat: -1.4586, lng: 36.9796, label: 'Athi River' },
  { lat: -1.5177, lng: 37.2634, label: 'Machakos' },
  { lat: -0.6780, lng: 34.7725, label: 'Nyamataro' },
  { lat: -1.2921, lng: 36.8219, label: 'Nairobi' },
  { lat: -4.0435, lng: 39.6682, label: 'Mombasa' },
  { lat: -0.0917, lng: 34.768, label: 'Kisumu' }
];

const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client';

/** Load Google Identity Services once. Resolves false if it cannot load. */
function loadGoogleScript(): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  const w = window as any;
  if (w.google?.accounts?.id) return Promise.resolve(true);
  const existing = document.querySelector(`script[src="${GOOGLE_SCRIPT}"]`);
  if (existing) {
    return new Promise((resolve) => {
      existing.addEventListener('load', () => resolve(Boolean((window as any).google?.accounts?.id)));
      existing.addEventListener('error', () => resolve(false));
    });
  }
  return new Promise((resolve) => {
    const tag = document.createElement('script');
    tag.src = GOOGLE_SCRIPT;
    tag.async = true;
    tag.defer = true;
    tag.onload = () => resolve(Boolean((window as any).google?.accounts?.id));
    tag.onerror = () => resolve(false);
    document.head.appendChild(tag);
  });
}

function StepDots({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Step ${step} of 3`}>
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={`h-1.5 rounded-full transition-all ${
            n === step ? 'w-6 bg-[#40916C]' : n < step ? 'w-3 bg-[#40916C]/45' : 'w-3 bg-[color:var(--brief-line)]'
          }`}
        />
      ))}
    </div>
  );
}

export function Onboarding({
  open,
  providers,
  state,
  user,
  channel,
  onSignedIn,
  onGuest,
  onStateChange,
  onUseLocation,
  onChooseCity,
  onDone,
  placeLabel
}: OnboardingProps) {
  const signedIn = Boolean(user);
  const [step, setStep] = React.useState<1 | 2 | 3>(signedIn ? 2 : 1);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [showPasswordForm, setShowPasswordForm] = React.useState(false);
  const [handle, setHandle] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [googleReady, setGoogleReady] = React.useState(false);
  const [creatorRefCode, setCreatorRefCode] = React.useState<string | null>(null);
  const googleSlot = React.useRef<HTMLDivElement | null>(null);

  // Capture Creator Referral Attribution from query string or storage
  React.useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        if (window.location?.search) {
          const params = new URLSearchParams(window.location.search);
          const ref = params.get('ref');
          if (ref) {
            window.localStorage.setItem('brief_creator_ref', ref.trim());
            setCreatorRefCode(ref.trim());
          }
        }
        const stored = window.localStorage.getItem('brief_creator_ref');
        if (stored) setCreatorRefCode(stored);
      }
    } catch {
      // Safe fallback
    }
  }, []);

  // A person who is already signed in never sees the identity step again.
  React.useEffect(() => {
    if (signedIn && step === 1) setStep(2);
  }, [signedIn, step]);

  const goal = state?.profile?.goal ?? null;
  const goals: OnboardingGoal[] = state?.goals ?? [];

  // --- Google Identity Services --------------------------------------------
  const clientId = providers?.google?.configured ? providers.google.clientId ?? null : null;

  React.useEffect(() => {
    if (!open || step !== 1 || signedIn || !clientId) return;
    let cancelled = false;
    void loadGoogleScript().then((ok) => {
      if (cancelled || !ok) return;
      const google = (window as any).google;
      try {
        google.accounts.id.initialize({
          client_id: clientId,
          callback: async (response: { credential?: string }) => {
            if (!response?.credential) return;
            setBusy('google');
            setError(null);
            const res = await briefApi.googleSignIn(response.credential, channel);
            setBusy(null);
            if (res.ok) onSignedIn(res.data);
            else setError(res.error);
          },
          // In a restricted webview a popup is usually blocked, so ask for the
          // redirect-free button flow and say so if it still fails.
          ux_mode: isRestrictedWebview(channel) ? 'redirect' : 'popup',
          auto_select: true,
          itp_support: true
        });
        if (googleSlot.current) {
          google.accounts.id.renderButton(googleSlot.current, {
            theme: 'outline',
            size: 'large',
            width: 320,
            text: 'continue_with',
            shape: 'pill'
          });
        }
        // One Tap: if this browser already holds a Google session, the person
        // is recognised without touching anything.
        google.accounts.id.prompt();
        setGoogleReady(true);
      } catch {
        setGoogleReady(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, step, signedIn, clientId, channel, onSignedIn]);

  if (!open) return null;

  const refreshState = async () => {
    const res = await briefApi.getOnboarding();
    if (res.ok) onStateChange(res.data);
  };

  const submitPassword = async (mode: 'register' | 'login') => {
    setBusy(mode);
    setError(null);
    const res = mode === 'register'
      ? await briefApi.register(handle.trim(), password, handle.trim())
      : await briefApi.login(handle.trim(), password);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSignedIn(res.data);
    void refreshState();
  };

  const chooseGoal = async (id: string) => {
    setBusy(`goal:${id}`);
    const res = await briefApi.setOnboardingGoal(id);
    setBusy(null);
    if (res.ok) {
      onStateChange(res.data);
      setStep(3);
    } else {
      setError(res.error);
    }
  };

  const finish = async (skipped: boolean) => {
    setBusy('finish');
    const res = await briefApi.finishOnboarding(skipped);
    setBusy(null);
    if (res.ok) onStateChange(res.data);
    onDone(skipped);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-[#40916C]/45 backdrop-blur-[2px] px-3 pb-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Brief"
      data-testid="onboarding"
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4">
          <StepDots step={step} />
          <button
            type="button"
            onClick={() => void finish(true)}
            className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--ink-60)] hover:text-[var(--brief-ink)] cursor-pointer"
          >
            {step === 1 ? 'Later' : 'Skip'}
          </button>
        </div>

        {/* ---------------------------------------------------------------- */}
        {step === 1 && (
          <div className="px-5 pb-5 pt-3 space-y-3.5">
            {creatorRefCode && (
              <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-900 text-xs font-bold flex items-center space-x-2">
                <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>Invited via Creator Partner Code: <strong>{creatorRefCode}</strong></span>
              </div>
            )}
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-[var(--ink-60)]">Step 1 of 3</p>
              <h2 className="mt-1 font-display text-[30px] font-semibold leading-tight tracking-tight text-[var(--brief-ink)]">
                What is happening around you, kept in one place.
              </h2>
              <p className="mt-1.5 text-[13px] leading-snug text-[var(--ink-60)]">
                Sign in so the things you keep are still yours on the next device. It takes one tap.
              </p>
            </div>

            {clientId && <div ref={googleSlot} className="flex justify-center" data-testid="google-button" />}

            {clientId && !googleReady && (
              <p className="text-center text-[11px] text-[var(--ink-60)]">Loading Google…</p>
            )}

            {!clientId && (
              <div className="rounded-xl border border-dashed border-[var(--brief-line)] bg-[color:var(--color-well)] px-3.5 py-3">
                <p className="text-[12px] font-extrabold text-[var(--brief-ink)]">Google sign-in is not configured here</p>
                <p className="mt-1 text-[11px] leading-snug text-[var(--ink-55)]">
                  {providers?.google?.reason ?? 'This deployment has no Google client id.'} Use a handle below — it is a
                  real account either way.
                </p>
              </div>
            )}

            {!showPasswordForm && (
              <button
                type="button"
                onClick={() => setShowPasswordForm(true)}
                className="w-full rounded-xl border border-[#0891B2] bg-[#40916C] px-4 py-3 text-[13px] font-extrabold text-[var(--accent-ink)] cursor-pointer"
              >
                Create an account with a handle
              </button>
            )}

            {showPasswordForm && (
              <div className="space-y-2">
                <input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="handle (3+ characters)"
                  aria-label="Handle"
                  autoComplete="username"
                  className="w-full rounded-xl border border-[var(--brief-line)] px-3.5 py-2.5 text-[13px] font-bold text-[var(--brief-ink)] outline-none focus:border-[#0891B2]"
                />
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  placeholder="password (8+ characters)"
                  aria-label="Password"
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-[var(--brief-line)] px-3.5 py-2.5 text-[13px] font-bold text-[var(--brief-ink)] outline-none focus:border-[#0891B2]"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void submitPassword('register')}
                    className="flex-1 rounded-xl bg-[#40916C] px-4 py-2.5 text-[13px] font-extrabold text-[var(--accent-ink)] disabled:opacity-50 cursor-pointer"
                  >
                    {busy === 'register' ? 'Creating…' : 'Create account'}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void submitPassword('login')}
                    className="rounded-xl border border-[var(--brief-line)] px-4 py-2.5 text-[13px] font-extrabold text-[var(--brief-ink)] disabled:opacity-50 cursor-pointer"
                  >
                    {busy === 'login' ? 'Signing in…' : 'I have one'}
                  </button>
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={busy !== null}
              onClick={async () => {
                setBusy('guest');
                setError(null);
                const guest = await onGuest();
                setBusy(null);
                if (guest) void refreshState();
                else setError('Could not start a device account. The API may be unreachable.');
              }}
              className="w-full text-[12px] font-bold text-[var(--ink-55)] hover:text-[var(--brief-ink)] cursor-pointer"
            >
              {busy === 'guest' ? 'Setting up…' : 'Just look around on this device'}
            </button>

            {error && <p className="text-[11px] font-bold text-[#DC2626]">{error}</p>}

            <p className="flex items-start gap-1.5 text-[11px] leading-snug text-[var(--ink-60)]">
              <ShieldCheck className="mt-[1px] h-3 w-3 shrink-0" />
              <span>
                Telegram is not required to be a member. If you open Brief inside Telegram it signs you in there too —
                that is a door, not a gate.
              </span>
            </p>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {step === 2 && (
          <div className="px-5 pb-5 pt-3 space-y-3.5">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-[var(--ink-60)]">Step 2 of 3</p>
              <h2 className="mt-1 font-display text-[32px] font-semibold leading-tight tracking-tight text-[var(--brief-ink)]">
                What brought you here?
              </h2>
              <p className="mt-1 text-[13px] text-[var(--ink-60)]">One tap. It orders your feed, nothing else.</p>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {goals.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void chooseGoal(g.id)}
                  data-goal={g.id}
                  className={`flex items-center justify-between rounded-xl border px-3.5 py-3 text-left transition cursor-pointer ${
                    goal === g.id ? 'border-[#0891B2] bg-[#40916C] text-[var(--accent-ink)]' : 'border-[var(--brief-line)] hover:border-[#0891B2]'
                  }`}
                >
                  <span className="text-[12.5px] font-extrabold">{g.label}</span>
                  {busy === `goal:${g.id}` ? (
                    <span className="text-[11px] font-extrabold uppercase tracking-[0.14em]">Saving…</span>
                  ) : (
                    <ArrowRight className="h-3.5 w-3.5 opacity-45" />
                  )}
                </button>
              ))}
              {goals.length === 0 && (
                <p className="rounded-xl border border-dashed border-[var(--brief-line)] px-3.5 py-3 text-[12px] text-[var(--ink-55)]">
                  The API has not answered yet, so there is nothing to choose from. You can skip this and pick it later
                  from your next step card.
                </p>
              )}
            </div>
            {error && <p className="text-[11px] font-bold text-[#DC2626]">{error}</p>}
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {step === 3 && (
          <div className="px-5 pb-5 pt-3 space-y-3.5">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-[var(--ink-60)]">Step 3 of 3</p>
              <h2 className="mt-1 font-display text-[32px] font-semibold leading-tight tracking-tight text-[var(--brief-ink)]">
                Where should Brief look?
              </h2>
              <p className="mt-1 text-[13px] text-[var(--ink-60)]">
                {placeLabel ? `Using ${placeLabel}.` : 'Skip it and you get the global ranked feed instead.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onUseLocation();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#0891B2] bg-[#40916C] px-4 py-3 text-[13px] font-extrabold text-[var(--accent-ink)] cursor-pointer"
            >
              <MapPin className="h-3.5 w-3.5" /> Use my location
            </button>
            <div className="flex flex-wrap gap-1.5">
              {CITIES.map((city) => (
                <button
                  key={city.label}
                  type="button"
                  onClick={() => {
                    setPrimaryNeighborhood(city.label);
                    onChooseCity(city);
                    void briefApi.setOnboardingPlace(city.label).then((res) => {
                      if (res.ok) onStateChange(res.data);
                    });
                  }}
                  className={`rounded-full border px-3 py-1.5 text-[12px] font-extrabold transition cursor-pointer ${
                    placeLabel === city.label
                      ? 'border-[#0891B2] bg-[#40916C] text-[var(--accent-ink)]'
                      : 'border-[var(--brief-line)] text-[var(--ink-70)] hover:border-[#0891B2]'
                  }`}
                >
                  {city.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void finish(false)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#40916C] px-4 py-3 text-[13px] font-extrabold text-[var(--accent-ink)] disabled:opacity-50 cursor-pointer"
              data-testid="onboarding-finish"
            >
              <Sparkles className="h-3.5 w-3.5" /> Show me what is around
            </button>
            <p className="flex items-start gap-1.5 text-[11px] leading-snug text-[var(--ink-60)]">
              <Check className="mt-[1px] h-3 w-3 shrink-0" />
              <span>
                Hosting, selling, banners and the money desk are not set up now. They open as you go, once there is
                something of yours to carry.
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Onboarding;
