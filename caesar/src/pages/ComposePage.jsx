import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Image as ImageIcon, Mic, Send, WifiOff, X } from "lucide-react";
import { useApp } from "@/store/appStore.js";
import { useSession } from "@/store/session.js";
import { useLive } from "@/store/live.js";
import { IMAGERY } from "@/data/imagery.js";
import { dataSize } from "@/lib/format.js";
import { LOCALES } from "@/lib/i18n.js";

const LIMIT = 480;

/** A small, real estimate: text bytes + the image/voice the author attached. */
function estimateKb(text, image, voice) {
  const textKb = (new Blob([text]).size || 0) / 1024;
  return Math.round((textKb + (image ? 140 : 0) + (voice ? voice.kb : 0)) * 10) / 10;
}

const ATTACHABLE = [
  { key: "market", label: "Market" },
  { key: "farm", label: "Farm" },
  { key: "coast", label: "Coast" },
];

/**
 * COMPOSE — write, attach, and know what it costs before you send.
 *
 * The data estimate is not decoration: on a metered bundle, "how much will
 * this cost me" is the question that decides whether someone posts at all. The
 * number updates as they type and as they attach.
 */
export default function ComposePage() {
  const navigate = useNavigate();
  const state = useApp();
  const addPost = useApp((store) => store.addPost);
  const mode = useSession((store) => store.mode);
  const liveCircles = useLive((store) => store.circles);
  const live = mode === "live";

  // Live mode posts against the server's circles (Brief groups); demo mode
  // against the seeded ones. Same composer, same estimate, different destination.
  const circles = useMemo(
    () => (live ? liveCircles.map((circle) => ({ id: circle.id, name: circle.name, place: circle.region || "" })) : state.circles),
    [live, liveCircles, state.circles]
  );
  const memberships = useMemo(
    () => (live ? liveCircles.filter((circle) => circle.following).map((circle) => circle.id) : state.memberships),
    [live, liveCircles, state.memberships]
  );

  const joined = circles.filter((circle) => memberships.includes(circle.id));
  const [circleId, setCircleId] = useState(joined[0]?.id || circles[0]?.id || "");
  const [body, setBody] = useState("");
  const [image, setImage] = useState(null);
  const [voice, setVoice] = useState(null);
  const [lang, setLang] = useState(state.preferences.locale);
  const [error, setError] = useState("");

  const trimmed = body.trim();
  const kb = useMemo(() => estimateKb(body, image, voice), [body, image, voice]);
  const remaining = LIMIT - body.length;
  const offline = state.preferences.offline;

  const publish = async () => {
    if (!trimmed) {
      setError("Write something first. A post is a claim someone can answer.");
      return;
    }
    if (trimmed.length < 8) {
      setError("Give people enough to answer — eight characters at least.");
      return;
    }
    if (!circleId && !live) {
      setError("Choose a circle. Every post belongs to one.");
      return;
    }

    if (live) {
      // Attachments are prototype samples (inline SVG), not uploads; the live
      // API takes text today and media arrives with the capture work. Saying so
      // is better than silently dropping what someone attached.
      const created = await useLive.getState().createPost({
        body: trimmed,
        circle_id: circleId || null,
        lang,
        data_kb: Math.max(1, Math.round(kb)),
      });
      if (!created) {
        setError(useLive.getState().error === "offline"
          ? "The network is unreachable. Nothing was posted — try again when you have signal."
          : useLive.getState().error || "The post did not go through.");
        return;
      }
      navigate("/");
      return;
    }

    addPost({ circleId, body: trimmed, image, voice, lang });
    navigate(`/circles/${circleId}`);
  };

  return (
    <>
      <div className="section-head" style={{ marginTop: 18 }}>
        <div>
          <div className="eyebrow">New post</div>
          <h1 className="title-lg">Write it plainly</h1>
          <p className="muted" style={{ fontSize: 13, marginTop: 4, maxWidth: "54ch" }}>
            State what you know, where you saw it, and what you want people to do. A post the community can check
            is a post that travels.
          </p>
        </div>
      </div>

      {offline && (
        <div className="notice notice--gold" style={{ marginBottom: 12 }}>
          <WifiOff size={16} className="notice__icon" aria-hidden="true" />
          <span>
            <strong>Offline.</strong> This post is saved here and appears in your feed immediately; it is marked as
            queued until you reconnect.
          </span>
        </div>
      )}

      <div className="card card--pad stack">
        <div className="field">
          <label className="label" htmlFor="circle">
            Circle
          </label>
          <select id="circle" className="select" value={circleId} onChange={(event) => setCircleId(event.target.value)}>
            {circles.map((circle) => (
              <option key={circle.id} value={circle.id}>
                {circle.name} — {circle.place}
                {memberships.includes(circle.id) ? "" : " (not joined)"}
              </option>
            ))}
          </select>
          {circleId && !memberships.includes(circleId) && (
            <p className="hint">
              You are not a member of this circle yet. You can still post — joining adds it to your feed.
            </p>
          )}
        </div>

        <div className="field">
          <label className="label" htmlFor="body">
            Your post
          </label>
          <textarea
            id="body"
            className="textarea"
            value={body}
            maxLength={LIMIT}
            placeholder="What should your community know?"
            onChange={(event) => {
              setBody(event.target.value);
              setError("");
            }}
            aria-describedby="body-help"
          />
          <div className="row row--between" id="body-help">
            <span className="hint">
              {remaining < 40 ? `${remaining} characters left` : "Plain text, images, or a voice note."}
            </span>
            <span className="hint mono">
              {body.length}/{LIMIT}
            </span>
          </div>
        </div>

        <div className="field">
          <span className="label">Attach</span>
          {live ? (
            <p className="hint" data-testid="attach-unavailable">
              Photos and voice notes are sample illustrations in this prototype, not uploads, and the live API takes
              text today. Nothing is attached without saying so — media capture arrives as its own piece of work.
            </p>
          ) : (
          <div className="scroll-row">
            {ATTACHABLE.map((option) => {
              const src = IMAGERY[option.key];
              const active = image === src;
              return (
                <button
                  key={option.key}
                  type="button"
                  className={`chip ${active ? "chip--green" : ""}`}
                  style={{ height: 30, padding: "0 11px", cursor: "pointer" }}
                  aria-pressed={active}
                  onClick={() => setImage(active ? null : src)}
                >
                  <ImageIcon size={13} aria-hidden="true" />
                  {option.label}
                </button>
              );
            })}
            <button
              type="button"
              className={`chip ${voice ? "chip--green" : ""}`}
              style={{ height: 30, padding: "0 11px", cursor: "pointer" }}
              aria-pressed={Boolean(voice)}
              onClick={() => setVoice(voice ? null : { seconds: 24, kb: 108 })}
            >
              <Mic size={13} aria-hidden="true" />
              {voice ? "24 s sample attached" : "Voice note (sample)"}
            </button>
          </div>
          )}
          {!live && (
          <p className="hint" style={{ marginTop: 8 }}>
            Photos and the voice note are samples from a fixed set. This prototype does not open your camera or
            microphone — say so plainly rather than promising what it cannot do.
          </p>
          )}
          {image && (
            <div className="post__media" style={{ margin: "8px 0 0", position: "relative" }}>
              <img src={image} alt="Attached" />
            </div>
          )}
          {(image || voice) && (
            <button
              type="button"
              className="btn btn--quiet"
              style={{ alignSelf: "start", marginLeft: -8 }}
              onClick={() => {
                setImage(null);
                setVoice(null);
              }}
            >
              <X size={13} aria-hidden="true" /> Remove attachments
            </button>
          )}
        </div>

        <div className="field">
          <label className="label" htmlFor="lang">
            Language
          </label>
          <select id="lang" className="select" value={lang} onChange={(event) => setLang(event.target.value)}>
            {LOCALES.map((locale) => (
              <option key={locale.code} value={locale.code}>
                {locale.native}
              </option>
            ))}
          </select>
          <p className="hint">
            Post in the language you think in. Readers see the tag; Caesar does not machine-translate you.
          </p>
        </div>

        <div className="card card--flat" style={{ padding: 12 }}>
          <div className="row row--between">
            <span className="tiny muted">Estimated data for this post</span>
            <span className="title-sm mono">{dataSize(kb)}</span>
          </div>
          <div className="meter" style={{ marginTop: 8 }}>
            <div className="meter__track">
              <div className="meter__fill meter__fill--gold" style={{ width: `${Math.min(100, (kb / 400) * 100)}%` }} />
            </div>
          </div>
          <p className="micro muted" style={{ marginTop: 6 }}>
            Text is a few KB; a photo is usually the expensive part. On a metered bundle that is the number worth
            knowing before you send.
          </p>
        </div>

        {error && (
          <div className="notice notice--terra" role="alert">
            <span>{error}</span>
          </div>
        )}

        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn--gold" onClick={publish} disabled={!trimmed}>
            <Send size={15} aria-hidden="true" />
            {live ? "Post to the network" : offline ? "Save and queue" : "Post to circle"}
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => navigate(-1)}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
