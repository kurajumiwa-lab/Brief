/**
 * Kiswahili for the public trust surfaces and the Home trust card.
 *
 * Scope is deliberate. Only the screens customers and shop owners see first are
 * translated here: the Brief Trust browse and shop pages, the free-listing note,
 * and the Home trust card. Everywhere else the app stays in English until it has
 * its own translation pass.
 *
 * Register:
 *   · Kenyan Swahili for rules, money, reviews and form labels, so meaning is exact.
 *   · Sheng only in brand lines and short calls to action ("Duka ni poa? Cheki…").
 *     Never in rules about points, till codes, verification or what a review means.
 *
 * These strings were written without a native-speaker review. Have a Kenyan
 * Swahili speaker check them before a public launch.
 *
 * English is the default and the fallback for any missing key.
 */

import { useSyncExternalStore } from "react";

export const LANGS = { en: "English", sw: "Kiswahili" };

export const STRINGS = {
  "browse.title": {
    en: "Shops you can trust",
    sw: "Maduka unayoweza kuamini",
  },
  "browse.intro": {
    en: "Real shops in Kenya, Ethiopia and Uganda. Brief checks each one before it appears here.",
    sw: "Maduka halisi Kenya, Ethiopia na Uganda. Brief inaangalia kila duka kabla halijaonekana hapa.",
  },
  "browse.listLink": {
    en: "List your shop free, or see your points",
    sw: "Weka duka lako bure, au angalia pointi zako",
  },
  "browse.chooseCountry": {
    en: "Choose a country",
    sw: "Chagua nchi",
  },
  "browse.all": {
    en: "All",
    sw: "Zote",
  },
  "browse.language": {
    en: "Language",
    sw: "Lugha",
  },
  "shop.allShops": {
    en: "All checked shops",
    sw: "Maduka yote yaliyokaguliwa",
  },
  "shop.checked": {
    en: "Checked by Brief",
    sw: "Imekaguliwa na Brief",
  },
  "shop.rateTitle": {
    en: "Rate this shop",
    sw: "Kadiria duka hili",
  },
  "shop.rateIntro": {
    en: "No account needed. Use the till code from your purchase. One review per purchase.",
    sw: "Huhitaji akaunti. Tumia msimbo wa till wa manunuzi yako. Ukaguzi mmoja kwa kila manunuzi.",
  },
  "shop.tillLabel": {
    en: "Till code from your receipt",
    sw: "Msimbo wa till kutoka risiti yako",
  },
  "shop.tillHint": {
    en: "The shop shows this code after your purchase. It works once.",
    sw: "Duka linaonyesha msimbo huu baada ya manunuzi. Unafanya kazi mara moja tu.",
  },
  "shop.service": {
    en: "Service",
    sw: "Huduma",
  },
  "shop.product": {
    en: "Product quality",
    sw: "Ubora wa bidhaa",
  },
  "shop.overall": {
    en: "Overall experience",
    sw: "Uzoefu kwa jumla",
  },
  "shop.publish": {
    en: "Publish my review",
    sw: "Chapisha ukaguzi wangu",
  },
  "shop.checkedByPhoto": {
    en: "Checked by Brief staff: storefront photo or in-person visit.",
    sw: "Wafanyakazi wa Brief wameliangalia: picha ya duka au ziara ya ana kwa ana.",
  },
  "shop.checkedByPapers": {
    en: "Checked by Brief staff: business papers or confirmation from other businesses.",
    sw: "Wafanyakazi wa Brief wameliangalia: karatasi za biashara au uthibitisho kutoka biashara nyingine.",
  },
  "shop.checkedByDefault": {
    en: "Checked by Brief staff.",
    sw: "Wafanyakazi wa Brief wameliangalia.",
  },
  "listing.free": {
    en: "Listing your shop on MarketTrust is free. Brief checks it before it appears to customers.",
    sw: "Kuweka duka lako MarketTrust ni bure. Brief inaliangalia kabla halijaonekana kwa wateja.",
  },
  "home.trustTitle": {
    en: "Shops you can check before you buy",
    sw: "Duka ni poa? Cheki kabla hujanunua",
  },
  "home.trustBody": {
    en: "Approved by Brief staff in Kenya, Ethiopia and Uganda. Reviews come from real till codes.",
    sw: "Brief imeidhinisha maduka Kenya, Ethiopia na Uganda. Ukaguzi unatoka kwa misimbo halisi ya till.",
  },
  "home.trustCta": {
    en: "Open Brief Trust",
    sw: "Fungua Brief Trust",
  },
  "home.trustChip": {
    en: "Checked shops",
    sw: "Maduka poa",
  },
  "delivery.title": {
    en: "How orders reach buyers",
    sw: "Jinsi bidhaa zinavyomfikia mteja",
  },
  "delivery.pickup": {
    en: "Buyer collects at the shop",
    sw: "Mteja achukue dukani",
  },
  "delivery.pickupAlways": {
    en: "Always available",
    sw: "Daima inapatikana",
  },
  "delivery.rider": {
    en: "A rider the buyer already knows",
    sw: "Rider anayemjua mteja",
  },
  "delivery.area": {
    en: "Where does this rider work? (town or estate)",
    sw: "Rider huyu anafanya kazi wapi? (mji au mtaa)",
  },
  "delivery.riderName": {
    en: "Rider's name",
    sw: "Jina la rider",
  },
  "delivery.riderPhone": {
    en: "Rider's phone number",
    sw: "Namba ya simu ya rider",
  },
  "delivery.feeNote": {
    en: "The rider and the buyer agree the fee between them. Brief does not set or hold any money.",
    sw: "Rider na mteja wanakubaliana bei yao wenyewe. Brief haiweki wala kushika pesa yoyote.",
  },
  "delivery.notChecked": {
    en: "Brief has not checked this rider.",
    sw: "Brief haijamhakiki rider huyu.",
  },
  "delivery.save": {
    en: "Save delivery",
    sw: "Hifadhi usafirishaji",
  },
  "delivery.shopLine": {
    en: "Delivery",
    sw: "Usafirishaji",
  },
  "delivery.shopPickup": {
    en: "Collect at the shop",
    sw: "Chukua dukani",
  },
  "delivery.shopRider": {
    en: "Rider you know, in {area}",
    sw: "Rider unayemjua, {area}",
  },
};

/** Look up a string in a language. Falls back to English, then to the key. */
export function t(key, lang = "en") {
  const entry = STRINGS[key];
  if (!entry) return key;
  return entry[lang] || entry.en || key;
}

const STORAGE_KEY = "brief-lang";
const listeners = new Set();

export function getLang() {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    return saved && LANGS[saved] ? saved : "en";
  } catch {
    return "en";
  }
}

export function setLang(lang) {
  if (!LANGS[lang]) return;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, lang);
  } catch {
    // private browsing or storage disabled: keep the choice for this page only
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The current language; components re-render when it changes. */
export function useLang() {
  return useSyncExternalStore(subscribe, getLang, () => "en");
}
