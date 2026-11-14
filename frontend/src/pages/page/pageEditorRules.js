// Pure rules for the Public Page editor. Limits mirror backend/app/modules/professional_card/page_settings.py.

export const TAGLINE_MAX = 140;
export const ABOUT_MAX = 1000;

export const SECTION_OPTIONS = [
  { key: "show_offers", label: "Offers", hint: "Your services and the price for each way." },
  { key: "show_hours", label: "Hours and area", hint: "Your opening hours and location." },
  { key: "show_credentials", label: "Credentials", hint: "Only registrations that are verified." },
];

/** A form value into what the backend takes. Blank text is sent as blank; the server stores it as none. */
export function toPayload(form) {
  return {
    tagline: (form.tagline || "").trim(),
    about: (form.about || "").trim(),
    show_offers: !!form.show_offers,
    show_hours: !!form.show_hours,
    show_credentials: !!form.show_credentials,
  };
}

/** Returns a message for the first problem, or null. */
export function validatePage(form) {
  if ((form.tagline || "").trim().length > TAGLINE_MAX) return `The tagline is longer than ${TAGLINE_MAX} characters.`;
  if ((form.about || "").trim().length > ABOUT_MAX) return `About is longer than ${ABOUT_MAX} characters.`;
  return null;
}

/** Where a blank About is shown from: the business description on your profile. */
export function aboutSource(form, businessDescription) {
  return (form.about || "").trim() ? "your About text" : businessDescription ? "your business description" : "nothing yet";
}
