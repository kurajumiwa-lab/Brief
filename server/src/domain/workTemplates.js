// ---------------------------------------------------------------------------
// WORK TEMPLATES — the closed set of workflows a Work Program can run.
//
// A template is what turns "onboard 50 retailers" into steps a person can do
// from a phone and a reviewer can check. Each step says:
//
//   mode       'home' (remote: calls, research, data) or 'field' (physically
//              present: visit, photograph, collect). A template with both is
//              HYBRID — one unit of work moves between a caller at home and a
//              visitor in the field.
//   fields     what the worker must record. `dedupe` fields are checked
//              against the rest of the program so one shop cannot be
//              registered twice; `subjectKey` names the subject in lists.
//   photosMin  how many photos of the subject are required (0 = none).
//   gps        whether the worker's location must accompany the proof.
//   consent    whether the subject's recorded consent is required.
//   gate       an outcome check: when the step's answer does not match, the
//              unit closes as `not_converted` instead of moving on. A merchant
//              who is not interested is an honest answer, not a failure.
//   share      the step's percentage of the per-unit worker pool. Shares in a
//              template sum to 100.
//   hours      how long an assignment is held before it returns to the pool.
//
// Why a closed set in code, not rows a client can type: the evidence rules
// ARE the quality contract. A client inventing "no photo, no location" for a
// field visit would be buying unverifiable work. New templates are a code
// change, reviewed like any other rule. (A custom-template editor is a later,
// deliberate decision — see docs/WORKFORCE.md.)
// ---------------------------------------------------------------------------

export const WORK_MODES = ['home', 'field'];

// The versioned independent-work terms a worker accepts before any task.
// Changing the text means bumping the version: every worker re-accepts.
export const WORK_TERMS_VERSION = 'work-terms-2026-09';
export const WORK_TERMS = [
  'You are an independent worker, not an employee of Brief or of the organisation posting the work.',
  'You choose which tasks to accept. Nobody can assign you work you did not accept.',
  'Each task shows its fee before you accept it. The fee is flat: no bonus, no volume tier, no speed incentive.',
  'You are paid for work that is approved. Rejected work, or a unit whose outcome does not happen, pays nothing.',
  'Evidence you submit (answers, photos, location) must be real and captured by you at the time of the task.',
  'Money moves only through a settlement that finance confirms. Brief does not hold a balance for you.',
  'You may stop working at any time. Tasks you hold but have not submitted return to the pool.'
];

const text = (key, label, extra = {}) => ({ key, label, kind: 'text', required: true, ...extra });
const phone = (key, label, extra = {}) => ({ key, label, kind: 'phone', required: true, ...extra });
const yesno = (key, label, extra = {}) => ({ key, label, kind: 'yesno', required: true, ...extra });
const number = (key, label, extra = {}) => ({ key, label, kind: 'number', required: true, ...extra });
const optional = (field) => ({ ...field, required: false });

export const TEMPLATES = {
  merchant_onboarding: {
    key: 'merchant_onboarding',
    label: 'Merchant onboarding',
    subjectKind: 'merchant',
    unitNoun: 'merchant',
    summary: 'Find a shop, qualify the owner by phone, then visit to capture photos, location and consent.',
    steps: [
      {
        key: 'qualify_call', label: 'Call and qualify the merchant', mode: 'home', share: 25, hours: 48,
        brief: 'Call the business. Explain the offer in plain words. Record who you spoke to and whether the owner is interested. Do not pressure anyone.',
        fields: [
          text('businessName', 'Business name', { subjectKey: true }),
          text('ownerName', 'Owner or person you spoke to'),
          phone('phone', 'Business phone', { dedupe: true }),
          text('category', 'What the business sells'),
          text('area', 'Area or street'),
          yesno('interested', 'Is the owner interested?')
        ],
        photosMin: 0, gps: false, consent: false,
        gate: { field: 'interested', equals: 'yes', closedAs: 'Owner was not interested' }
      },
      {
        key: 'visit_capture', label: 'Visit, photograph and register', mode: 'field', share: 75, hours: 72,
        brief: 'Visit the shop in person. Photograph the shop front and the inside. Record the owner\'s consent in their own words. Capture your location while at the shop.',
        fields: [
          text('locationNote', 'How to find the shop (landmark)'),
          optional(text('documentsSeen', 'Documents seen (e.g. business permit)'))
        ],
        photosMin: 2, gps: true, consent: true
      }
    ]
  },

  merchant_verification: {
    key: 'merchant_verification',
    label: 'Merchant verification',
    subjectKind: 'merchant',
    unitNoun: 'shop',
    summary: 'Visit a named business and confirm it exists, trades, and is where it says it is.',
    steps: [
      {
        key: 'verify_visit', label: 'Visit and confirm the business', mode: 'field', share: 100, hours: 72,
        brief: 'Go to the business. Confirm it is open and trading. Photograph the front. Capture your location at the door.',
        fields: [
          text('businessName', 'Business name', { subjectKey: true }),
          optional(phone('phone', 'Business phone', { dedupe: true })),
          yesno('trading', 'Is the business open and trading?'),
          text('observed', 'What you saw (one or two sentences)')
        ],
        photosMin: 1, gps: true, consent: false
      }
    ]
  },

  supplier_sourcing: {
    key: 'supplier_sourcing',
    label: 'Supplier sourcing',
    subjectKind: 'supplier',
    unitNoun: 'supplier quotation',
    summary: 'Find a supplier remotely, confirm they can supply, then collect a written quotation in person.',
    steps: [
      {
        key: 'find_supplier', label: 'Find and confirm a supplier', mode: 'home', share: 40, hours: 48,
        brief: 'Find a supplier for the requested item. Call them. Confirm they can supply the quantity. Record their contact.',
        fields: [
          text('supplierName', 'Supplier name', { subjectKey: true }),
          phone('phone', 'Supplier phone', { dedupe: true }),
          text('item', 'Item they can supply'),
          yesno('canSupply', 'Can they supply the requested quantity?')
        ],
        photosMin: 0, gps: false, consent: false,
        gate: { field: 'canSupply', equals: 'yes', closedAs: 'Supplier could not supply' }
      },
      {
        key: 'collect_quote', label: 'Visit and collect the quotation', mode: 'field', share: 60, hours: 72,
        brief: 'Visit the supplier. Photograph the written quotation and the premises. Record the quoted unit price.',
        fields: [
          number('unitPriceKes', 'Quoted unit price (KES)'),
          text('leadTime', 'Lead time they quoted')
        ],
        photosMin: 2, gps: true, consent: false
      }
    ]
  },

  market_survey: {
    key: 'market_survey',
    label: 'Market survey',
    subjectKind: 'business',
    unitNoun: 'interview',
    summary: 'Interview a business owner in person and record their answers with consent.',
    steps: [
      {
        key: 'interview', label: 'Interview the owner', mode: 'field', share: 100, hours: 48,
        brief: 'Introduce yourself and the survey. Ask for consent first. Record the answers as the owner gives them.',
        fields: [
          text('businessName', 'Business name', { subjectKey: true }),
          optional(phone('phone', 'Owner phone', { dedupe: true })),
          text('answers', 'Answers (as the owner said them)')
        ],
        photosMin: 1, gps: true, consent: true
      }
    ]
  },

  lead_calling: {
    key: 'lead_calling',
    label: 'Lead calling',
    subjectKind: 'business',
    unitNoun: 'qualified call',
    summary: 'Call a business from home and record the conversation outcome.',
    steps: [
      {
        key: 'call', label: 'Call and record the outcome', mode: 'home', share: 100, hours: 24,
        brief: 'Call the business. Record who answered and what they said. A clear "no" is a valid outcome — record it honestly.',
        fields: [
          text('businessName', 'Business name', { subjectKey: true }),
          phone('phone', 'Phone called', { dedupe: true }),
          text('outcome', 'What they said')
        ],
        photosMin: 0, gps: false, consent: false
      }
    ]
  },

  document_errand: {
    key: 'document_errand',
    label: 'Document errand',
    subjectKind: 'document',
    unitNoun: 'delivery',
    summary: 'Collect a document from one place and deliver it to another, with the recipient\'s confirmation.',
    steps: [
      {
        key: 'pickup_deliver', label: 'Collect and deliver the document', mode: 'field', share: 100, hours: 24,
        brief: 'Collect the document. Deliver it. Photograph it in the recipient\'s hands and record their name.',
        fields: [
          text('documentName', 'Document', { subjectKey: true }),
          text('recipientName', 'Recipient name')
        ],
        photosMin: 1, gps: true, consent: true
      }
    ]
  }
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATES);

export function getTemplate(key) {
  return TEMPLATES[key] ?? null;
}

/** The template's overall mode: home, field or hybrid (both). */
export function templateMode(template) {
  const modes = new Set(template.steps.map((s) => s.mode));
  return modes.size > 1 ? 'hybrid' : [...modes][0];
}

/** The public shape the client renders (briefing + evidence contract). */
export function templateView(template) {
  return {
    key: template.key,
    label: template.label,
    summary: template.summary,
    subjectKind: template.subjectKind,
    unitNoun: template.unitNoun,
    mode: templateMode(template),
    steps: template.steps.map((s, index) => ({
      index,
      key: s.key,
      label: s.label,
      mode: s.mode,
      share: s.share,
      hours: s.hours,
      brief: s.brief,
      fields: s.fields.map((f) => ({ key: f.key, label: f.label, kind: f.kind, required: f.required })),
      photosMin: s.photosMin,
      gps: s.gps,
      consent: s.consent,
      gate: s.gate ? { field: s.gate.field, equals: s.gate.equals, closedAs: s.gate.closedAs } : null
    }))
  };
}

// Self-check at import: a template whose shares do not sum to 100 would
// silently mint or lose money in every settlement. Refuse to start instead.
for (const t of Object.values(TEMPLATES)) {
  const sum = t.steps.reduce((s, x) => s + x.share, 0);
  if (sum !== 100) throw new Error(`work template ${t.key}: step shares sum to ${sum}, not 100`);
  for (const s of t.steps) {
    if (!WORK_MODES.includes(s.mode)) throw new Error(`work template ${t.key}.${s.key}: unknown mode ${s.mode}`);
  }
}
