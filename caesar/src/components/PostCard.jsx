import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  EyeOff,
  ImageOff,
  Mic,
  MoreHorizontal,
  ShieldAlert,
  ThumbsDown,
  ThumbsUp,
  VolumeX,
} from "lucide-react";
import Avatar from "./Avatar.jsx";
import { useApp } from "@/store/appStore.js";
import { useSocial } from "@/lib/useSocial.js";
import { whyThisAppears } from "@/lib/ranking.js";
import { dataSize, percent, relativeTime } from "@/lib/format.js";
import { makeT } from "@/lib/i18n.js";

const LANG_LABEL = { en: "English", sw: "Kiswahili", fr: "Français" };

/**
 * ONE POST.
 *
 * The card is the whole product in miniature: who said it, which circle it
 * belongs to, what it cost you to read, the two reactions, and — one tap away —
 * exactly why it is where it is.
 *
 * The two buttons are peers. Neither is styled as the "correct" answer; support
 * is gold and disagreement is terracotta, which is warmer than red because
 * disagreement is not an alarm.
 */
export default function PostCard({ entry, onOpenVerdict, compact = false }) {
  const { post, verdict } = entry;
  const preferences = useApp((state) => state.preferences);
  const queue = useApp((state) => state.queue);
  // One hook decides whether this press goes to the seeded network or to the
  // server; the card does not need to know which.
  const social = useSocial();

  const [showImage, setShowImage] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  const t = makeT(preferences.locale);

  const author = social.authorOf(entry);
  const circle = social.circleOf(post.circleId);
  const mine = social.reactionOf(entry);
  const joined = social.joined(post.circleId);
  const viewerId = social.viewerId;
  const queued = !social.live && queue.some((item) => item.key === `reaction:${post.id}`);
  const why = whyThisAppears(entry, new Set(joined ? [post.circleId] : []));

  useEffect(() => {
    if (!menu) return undefined;
    const close = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const imageHidden = post.image && preferences.dataSaver && !showImage;
  // A voice note is the most expensive thing on a card — 190 KB for 42 seconds
  // in the seed — so the data saver has to gate it too, not just photographs.
  const voiceHidden = post.voice && preferences.dataSaver && !showVoice;

  return (
    <article className="card post" data-testid={`post-${post.id}`}>
      <div className="post__head">
        <Avatar name={author?.name} id={author?.id || ""} />
        <div className="post__who">
          <div className="post__name">
            <span>{author?.name || "Member"}</span>
            {author?.id === viewerId && <span className="chip chip--quiet">You</span>}
            {!joined && <span className="chip chip--quiet">Outside your circles</span>}
          </div>
          <div className="post__meta">
            <span>@{author?.handle || "member"}</span>
            <span className="dot">{relativeTime(post.createdAt)}</span>
            {circle && <span className="dot">{circle.name}</span>}
            {post.lang !== preferences.locale && <span className="dot">{LANG_LABEL[post.lang] || post.lang}</span>}
          </div>
        </div>

        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            type="button"
            className="iconbtn"
            aria-label="Post actions"
            aria-expanded={menu}
            onClick={() => setMenu((open) => !open)}
          >
            <MoreHorizontal size={17} aria-hidden="true" />
          </button>
          {menu && (
            <div
              className="card"
              style={{ position: "absolute", right: 0, top: 40, width: 210, padding: 6, zIndex: 20, boxShadow: "var(--shadow-md)" }}
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                className="list__row"
                style={{ borderRadius: 10, padding: "9px 10px" }}
                onClick={() => {
                  setMenu(false);
                  onOpenVerdict?.(entry, "report");
                }}
              >
                <ShieldAlert size={15} aria-hidden="true" />
                <span>
                  <span className="list__title">Report this post</span>
                  <span className="list__sub">Opens a case. Changes nothing by itself.</span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="list__row"
                style={{ borderRadius: 10, padding: "9px 10px" }}
                onClick={() => {
                  setMenu(false);
                  social.mute(post.authorId);
                }}
              >
                <EyeOff size={15} aria-hidden="true" />
                <span>
                  <span className="list__title">Mute {author?.name?.split(" ")[0]}</span>
                  <span className="list__sub">You stop seeing their posts.</span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="list__row"
                style={{ borderRadius: 10, padding: "9px 10px", color: "var(--terra-700)" }}
                onClick={() => {
                  setMenu(false);
                  social.block(post.authorId);
                }}
              >
                <AlertTriangle size={15} aria-hidden="true" />
                <span>
                  <span className="list__title">Block</span>
                  <span className="list__sub">They disappear from your feed entirely.</span>
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="post__body">{post.body}</p>

      {post.image && !imageHidden && (
        <figure className="post__media" style={{ margin: "12px 16px 0" }}>
          <img src={post.image} alt={post.imageAlt || ""} loading="lazy" />
        </figure>
      )}

      {imageHidden && (
        <div className="post__media">
          <div className="post__media-placeholder">
            <ImageOff size={16} aria-hidden="true" />
            <span className="grow">
              Image not loaded — data saver is on. {dataSize(post.dataKb)} for this post.
            </span>
            <button type="button" className="btn btn--quiet" onClick={() => setShowImage(true)}>
              Load it
            </button>
          </div>
        </div>
      )}

      {voiceHidden && (
        <div className="post__media">
          <div className="post__media-placeholder">
            <VolumeX size={16} aria-hidden="true" />
            <span className="grow">
              Voice note not loaded — data saver is on. {dataSize(post.voice.kb)} for{" "}
              {post.voice.seconds} seconds.
            </span>
            <button type="button" className="btn btn--quiet" onClick={() => setShowVoice(true)}>
              Play it
            </button>
          </div>
        </div>
      )}

      {post.voice && !voiceHidden && (
        <div className="post__voice">
          <span className="chip chip--green">
            <Mic size={12} aria-hidden="true" /> Voice
          </span>
          <div className="post__voice-bar" aria-hidden="true" />
          <span className="micro muted mono">
            0:{String(post.voice.seconds).padStart(2, "0")} · {dataSize(post.voice.kb)}
          </span>
        </div>
      )}

      {!compact && (
        <button
          type="button"
          className="post__why"
          onClick={() => onOpenVerdict?.(entry)}
          style={{ cursor: "pointer", textAlign: "left", width: "calc(100% - 32px)" }}
        >
          {verdict.contested ? (
            <AlertTriangle size={13} aria-hidden="true" style={{ flex: "none", marginTop: 1, color: "var(--terra-600)" }} />
          ) : verdict.needsMoreVoices ? (
            <EyeOff size={13} aria-hidden="true" style={{ flex: "none", marginTop: 1 }} />
          ) : (
            <Check size={13} aria-hidden="true" style={{ flex: "none", marginTop: 1, color: "var(--green-600)" }} />
          )}
          <span className="grow">{why.text}</span>
          <ChevronRight size={13} aria-hidden="true" style={{ flex: "none", marginTop: 1 }} />
        </button>
      )}

      <div className="post__actions">
        <div className="reactions">
          <button
            type="button"
            className="reaction reaction--up"
            aria-pressed={mine === "up"}
            aria-label={`${t("reaction.support")} — ${verdict.up} so far`}
            onClick={() => social.react(post.id, "up")}
          >
            <ThumbsUp size={15} aria-hidden="true" />
            <span className="reaction__count">{verdict.up}</span>
          </button>
          <button
            type="button"
            className="reaction reaction--down"
            aria-pressed={mine === "down"}
            aria-label={`${t("reaction.disagree")} — ${verdict.down} so far`}
            onClick={() => social.react(post.id, "down")}
          >
            <ThumbsDown size={15} aria-hidden="true" />
            <span className="reaction__count">{verdict.down}</span>
          </button>
          {queued && <span className="chip chip--gold">Queued</span>}
        </div>

        <button type="button" className="btn btn--quiet" onClick={() => onOpenVerdict?.(entry)}>
          {percent(verdict.confidence)} confident
          <ChevronRight size={13} aria-hidden="true" />
        </button>
      </div>

      <div
        className="verdict"
        style={{ margin: "0 16px 14px", height: 6 }}
        role="img"
        aria-label={`${verdict.up} support, ${verdict.down} disagree of ${verdict.participation} reactions`}
      >
        <span
          className="verdict__up"
          style={{ width: `${verdict.participation ? (verdict.up / verdict.participation) * 100 : 0}%` }}
        />
        <span className="verdict__down grow" />
      </div>

      {preferences.dataSaver && (
        <div className="micro muted" style={{ margin: "0 16px 12px" }}>
          {dataSize(post.dataKb)} for this post
          {post.image ? " · image hidden" : ""}
        </div>
      )}
    </article>
  );
}
