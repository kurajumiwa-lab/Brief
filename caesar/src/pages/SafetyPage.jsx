import { useMemo, useState } from "react";
import { Ban, Check, Clock, EyeOff, Gauge, Languages, RotateCcw, ShieldCheck, WifiOff } from "lucide-react";
import Avatar from "@/components/Avatar.jsx";
import { useApp } from "@/store/appStore.js";
import { safetySummary } from "@/lib/selectors.js";
import { LOCALES, COMING_SOON, makeT } from "@/lib/i18n.js";
import { count, relativeTime } from "@/lib/format.js";
import { RANKING } from "@/lib/ranking.js";

const REASON_LABEL = {
  harassment: "Harassment or a personal attack",
  hate: "Hate against a group of people",
  misinformation: "A claim that could cause harm",
  spam: "Spam or a scam",
  other: "Something else",
};

/**
 * SAFETY CENTRE — the four controls a person actually reaches for, and the one
 * rule the whole product rests on: **disagreement is not abuse.**
 *
 * Reporting, blocking and muting live here, apart from the reaction buttons.
 * A downvote changes a ranking; none of these three do. Keeping them on
 * separate screens is not tidiness — it is the difference between "I think you
 * are wrong" and "I want you removed", and the product must never blur it.
 */
export default function SafetyPage() {
  const state = useApp();
  const unblock = useApp((store) => store.unblock);
  const unmute = useApp((store) => store.unmute);
  const setPreference = useApp((store) => store.setPreference);
  const resetPrototype = useApp((store) => store.resetPrototype);
  const toast = useApp((store) => store.toast);
  const t = makeT(state.preferences.locale);
  const summary = useMemo(() => safetySummary(state), [state]);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <>
      <div className="section-head" style={{ marginTop: 18 }}>
        <div>
          <div className="eyebrow">Control</div>
          <h1 className="title-lg">{t("safety.title")}</h1>
          <p className="muted" style={{ fontSize: 13, marginTop: 4, maxWidth: "54ch" }}>
            What happens when you disagree, what happens when you report, and what happens when someone reports
            you. All three are different, on purpose.
          </p>
        </div>
      </div>

      <div className="notice notice--green">
        <ShieldCheck size={16} className="notice__icon" aria-hidden="true" />
        <span>
          <strong>Disagreement is never treated as abuse.</strong> A downvote lowers a post's reach and does nothing
          else: it does not report the author, it does not hide the post, and it does not appear on their profile.
          {` A post needs ${RANKING.contestedMinReactions} reactions and a third of them against it before it is even called contested — and contested posts stay up.`}
        </span>
      </div>

      {/* ── reports ──────────────────────────────────────────────────────── */}
      <div className="section-head">
        <div className="eyebrow">Your reports · {summary.reports.length}</div>
      </div>
      {summary.reports.length === 0 ? (
        <div className="empty">
          <p style={{ fontSize: 13 }}>You have not reported anything. That is normal.</p>
        </div>
      ) : (
        <div className="list">
          {summary.reports.map((report) => (
            <div key={report.id} className="list__row">
              <Clock size={15} aria-hidden="true" style={{ color: "var(--text-3)" }} />
              <div className="grow">
                <div className="list__title">{REASON_LABEL[report.reason] || report.reason}</div>
                <div className="list__sub">
                  Case {report.id.replace("rep-", "#")} · sent {relativeTime(report.at)} · status: {report.status}
                </div>
              </div>
              <span className="chip chip--quiet">Received</span>
            </div>
          ))}
        </div>
      )}
      <p className="micro muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
        A report opens a case for the circle's moderators. It does not hide the post, and it does not notify the
        author that you filed it. You can appeal any decision that comes back — against you or against someone
        else.
      </p>

      {/* ── blocks ───────────────────────────────────────────────────────── */}
      <div className="section-head">
        <div className="eyebrow">Blocked · {summary.blocked.length}</div>
        <span className="micro muted">Their posts are hidden from you</span>
      </div>
      {summary.blocked.length === 0 ? (
        <div className="empty">
          <Ban size={18} aria-hidden="true" />
          <p style={{ fontSize: 13 }}>Nobody is blocked. Blocking is personal — it changes your view, not the network's.</p>
        </div>
      ) : (
        <div className="list">
          {summary.blocked.map((user) => (
            <div key={user.id} className="list__row">
              <Avatar name={user.name} id={user.id} size="sm" />
              <div className="grow">
                <div className="list__title">{user.name}</div>
                <div className="list__sub">@{user.handle}</div>
              </div>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => unblock(user.id)}>
                Unblock
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── mutes ────────────────────────────────────────────────────────── */}
      <div className="section-head">
        <div className="eyebrow">Muted · {summary.muted.length}</div>
        <span className="micro muted">Hidden from your feed, still in the conversation</span>
      </div>
      {summary.muted.length === 0 ? (
        <div className="empty">
          <EyeOff size={18} aria-hidden="true" />
          <p style={{ fontSize: 13 }}>Nobody is muted. Muting is quieter than blocking and easier to undo.</p>
        </div>
      ) : (
        <div className="list">
          {summary.muted.map((user) => (
            <div key={user.id} className="list__row">
              <Avatar name={user.name} id={user.id} size="sm" />
              <div className="grow">
                <div className="list__title">{user.name}</div>
                <div className="list__sub">@{user.handle}</div>
              </div>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => unmute(user.id)}>
                Unmute
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── the queue ────────────────────────────────────────────────────── */}
      <div className="section-head">
        <div className="eyebrow">Waiting to send · {summary.queue.length}</div>
      </div>
      {summary.queue.length === 0 ? (
        <div className="notice">
          <Check size={16} className="notice__icon" aria-hidden="true" />
          <span>Nothing is waiting. Everything you have done here has been applied.</span>
        </div>
      ) : (
        <div className="list">
          {summary.queue.map((item) => (
            <div key={item.key} className="list__row">
              <WifiOff size={15} aria-hidden="true" style={{ color: "var(--gold-700)" }} />
              <div className="grow">
                <div className="list__title">
                  {item.type === "reaction" ? "Reaction" : "Post"} · {item.postId}
                </div>
                <div className="list__sub">Queued {relativeTime(new Date(item.at).toISOString())} — sends when you reconnect</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── preferences ──────────────────────────────────────────────────── */}
      <div className="section-head">
        <div className="eyebrow">Data and language</div>
      </div>
      <div className="list">
        <div className="list__row">
          <Gauge size={16} aria-hidden="true" style={{ color: "var(--text-3)" }} />
          <div className="grow">
            <div className="list__title">{t("data.saver")}</div>
            <div className="list__sub">Hide images until you ask, and show what each post costs.</div>
          </div>
          <button
            type="button"
            className="switch"
            aria-pressed={state.preferences.dataSaver}
            onClick={() => setPreference("dataSaver", !state.preferences.dataSaver)}
          >
            <span className="switch__track">
              <span className="switch__thumb" />
            </span>
          </button>
        </div>

        <div className="list__row">
          <WifiOff size={16} aria-hidden="true" style={{ color: "var(--text-3)" }} />
          <div className="grow">
            <div className="list__title">Connection</div>
            <div className="list__sub">
              {state.preferences.offline
                ? "Offline — reading works, actions are queued on this device."
                : "Online — actions apply immediately."}
            </div>
          </div>
          <button
            type="button"
            className="switch"
            aria-pressed={state.preferences.offline}
            onClick={() => setPreference("offline", !state.preferences.offline)}
          >
            <span className="switch__track">
              <span className="switch__thumb" />
            </span>
          </button>
        </div>

        <div className="list__row" style={{ alignItems: "flex-start" }}>
          <Languages size={16} aria-hidden="true" style={{ color: "var(--text-3)", marginTop: 2 }} />
          <div className="grow">
            <div className="list__title">Language</div>
            <div className="list__sub" style={{ marginTop: 6 }}>
              <div className="row row--wrap" style={{ gap: 6 }}>
                {LOCALES.map((locale) => (
                  <button
                    key={locale.code}
                    type="button"
                    className={`chip ${state.preferences.locale === locale.code ? "chip--green" : ""}`}
                    style={{ height: 28, padding: "0 11px", cursor: "pointer" }}
                    aria-pressed={state.preferences.locale === locale.code}
                    onClick={() => setPreference("locale", locale.code)}
                  >
                    {locale.native}
                  </button>
                ))}
              </div>
              <p className="micro muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
                {count(LOCALES.length, "interface language")} built. Not built yet, and not pretended:{" "}
                {COMING_SOON.join(" · ")}.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── what this prototype does not do ──────────────────────────────── */}
      <div className="section-head">
        <div className="eyebrow">Not built here</div>
        <span className="micro muted">Said plainly rather than stubbed</span>
      </div>
      <div className="card card--pad">
        <ul className="tiny muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>
            <strong>Appeals.</strong> The path is stated — a moderator replies to the case number above and you can
            answer it — but there is no appeal form or queue in this prototype.
          </li>
          <li>
            <strong>Privacy controls.</strong> Who can see a profile, a post's audience, and account deletion are
            not modelled. Nothing here leaves this browser, so there is nothing yet to make private.
          </li>
          <li>
            <strong>A moderator console.</strong> Reports are filed and stored; no one is shown them in this build.
          </li>
          <li>
            <strong>Real media capture.</strong> Photos come from a fixed set of illustrations and the voice note
            is a 24-second sample. The composer never opens your camera or microphone.
          </li>
          <li>
            <strong>Money.</strong> Tips and subscriptions through M-Pesa, MoMo or Airtel Money are out of scope
            until the core experience is validated — and any future payment would require a person to confirm it.
          </li>
        </ul>
      </div>

      {/* ── prototype housekeeping ───────────────────────────────────────── */}
      <div className="section-head">
        <div className="eyebrow">This prototype</div>
      </div>
      <div className="card card--pad">
        <p className="tiny muted" style={{ lineHeight: 1.55 }}>
          Everything here is stored in this browser. Nothing is sent anywhere, no account exists, and no data
          leaves the device. Resetting restores the starting network exactly as it was written.
        </p>
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          {confirmReset ? (
            <>
              <button
                type="button"
                className="btn btn--sm btn--danger"
                onClick={() => {
                  resetPrototype();
                  setConfirmReset(false);
                }}
              >
                Yes, reset everything
              </button>
              <button type="button" className="btn btn--sm btn--quiet" onClick={() => setConfirmReset(false)}>
                Keep my data
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirmReset(true)}>
              <RotateCcw size={13} aria-hidden="true" /> Reset the prototype
            </button>
          )}
          <button type="button" className="btn btn--sm btn--quiet" onClick={() => toast("Nothing leaves this browser.", "gold")}>
            What is stored?
          </button>
        </div>
      </div>
    </>
  );
}
