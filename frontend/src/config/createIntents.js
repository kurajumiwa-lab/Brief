import {
  CalendarDays, ClipboardList, Package, Truck, Users, Wrench,
} from "lucide-react";

/**
 * WHAT A PERSON IS ACTUALLY TRYING TO DO — six purposes, one form.
 *
 * The redesign's complaint about Create was precise: the central tab opened a
 * *generic form*, and the form's first question was "which of these nine
 * internal content types is this?" — a question no person has ever had. The
 * person has "I want to sell this", "I need a hand with this", "we are
 * meeting on Saturday".
 *
 * So Create opens on a sheet of PURPOSES, and the internal type is decided
 * behind the curtain. Each purpose maps to a real publishing path that the
 * server already understands — nothing here is a new endpoint, a new field or
 * a new status:
 *
 *   Sell goods      → an Available offer anchored to a good
 *   Offer a service  → an Available offer anchored to a service
 *   Post a rental    → an Available offer anchored to a rental
 *   Publish an event → an event with a date and a place
 *   Local request    → a Wanted request in the Local Activity Ledger
 *   Community meetup → a Scheduled round in the Local Activity Ledger
 *
 * The three trade purposes are the same record with a different anchor
 * (`primary_category` = goods · service · rental) because that is how the
 * product's own browse side classifies them: one offer, one anchor, and the
 * browse sections read that anchor. See
 * `backend/app/modules/outside/feed.py` → `PRIMARY_CATEGORY_TO_KIND`.
 *
 * `to` is the deep link, so a purpose can be shared, bookmarked and opened
 * from anywhere: /create?type=available&ledger=1&primary=goods
 */

export const CREATE_INTENTS = [
  {
    id: "goods",
    label: "Sell goods",
    hint: "Produce, stock, or something to give away",
    icon: Package,
    content_type: "available",
    use_ledger: true,
    primary_category: "goods",
    to: "/create?type=available&ledger=1&primary=goods",
  },
  {
    id: "service",
    label: "Offer a service",
    hint: "A repair, a skill, or professional help",
    icon: Wrench,
    content_type: "available",
    use_ledger: true,
    primary_category: "service",
    to: "/create?type=available&ledger=1&primary=service",
  },
  {
    id: "rental",
    label: "Post a rental",
    hint: "Tools, space, or transport by the day",
    icon: Truck,
    content_type: "available",
    use_ledger: true,
    primary_category: "rental",
    to: "/create?type=available&ledger=1&primary=rental",
  },
  {
    id: "event",
    label: "Publish an event",
    hint: "A party, a workshop, a trip or a market day",
    icon: CalendarDays,
    content_type: "event",
    use_ledger: false,
    to: "/create?type=event",
  },
  {
    id: "request",
    label: "Create a local request",
    hint: "Ask for a repair, a group buy, or a hand",
    icon: ClipboardList,
    content_type: "wanted",
    use_ledger: true,
    to: "/create?type=wanted&ledger=1",
  },
  {
    id: "meetup",
    label: "Start a community meetup",
    hint: "A round, a session, or a collection window",
    icon: Users,
    content_type: "scheduled",
    use_ledger: true,
    to: "/create?type=scheduled&ledger=1",
  },
];

/** The intent a given draft belongs to, if any. */
export function intentForDraft(draft) {
  if (!draft) return null;
  // The three trade purposes are one record with three anchors, so an
  // Available offer is matched by the anchor it carries.
  if (draft.content_type === "available") {
    return (
      CREATE_INTENTS.find(
        (intent) => intent.primary_category && intent.primary_category === draft.primary_category,
      ) || null
    );
  }
  return CREATE_INTENTS.find((intent) => !intent.primary_category && intent.content_type === draft.content_type) || null;
}

/**
 * The plain-language name of the thing being published. The publish button
 * keeps its internal name (tests and muscle memory), but the person reading
 * the form is told what they are making.
 */
export const CREATE_TYPE_NOUNS = {
  available: "offer",
  wanted: "request",
  scheduled: "round",
  opportunity: "opportunity",
  listing: "listing",
  post: "post",
  event: "event",
  community: "group",
  collection: "collection",
};

/** A one-line description of what the chosen purpose will publish. */
export const INTENT_CONFIRMATIONS = {
  goods: "You are publishing a good for sale — quantity, price and where it is.",
  service: "You are publishing a service — what you do, and what you charge.",
  rental: "You are publishing a rental — what is available, and by the day.",
  event: "You are publishing an event — where it is, and when it starts.",
  request: "You are publishing a request — what you need, and who may answer.",
  meetup: "You are publishing a round — when it happens, and how many places.",
};
