// Pure rules for Ecosystem integrations (P4). Mirrors backend/app/modules/integrations/service.py.

export const STATE_LABEL = {
  declared: "Declared (your own record, not verified)",
  verified: "Verified by an operator",
  failed: "Attempt failed",
};

export const STATE_VARIANT = { declared: "gray", verified: "brand", failed: "red" };

export const METHOD_LABEL = {
  api: "Connected API",
  export: "Export from the system",
  attested_upload: "Attested upload (you upload and attest)",
  manual: "Entered by hand",
};

/** The methods a business can use today: the API rung only appears once an adapter exists. */
export const usableMethods = (methods = []) => methods.filter((m) => m !== "api");

/** What to do next when an attempt failed: the next rung on the ladder. */
export function fallbackText(rung) {
  return rung ? `Next: try ${METHOD_LABEL[rung].toLowerCase()}.` : "No further method is available.";
}

/** Checks a form before it is sent. The backend checks again. */
export function validateRecord({ fact_kind, method, outcome, note }) {
  if (!fact_kind) return "Choose a fact to record.";
  if (!method) return "Choose how the fact was obtained.";
  if (outcome === "failed" && !String(note || "").trim()) return "Say what went wrong.";
  return null;
}
