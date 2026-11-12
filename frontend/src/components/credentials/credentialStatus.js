/**
 * How a credential is shown. The status comes from the server and is never inferred here.
 *
 * - self_declared: a grey "Self-declared Licence". Never a shield, never green, never "Verified".
 * - verified: a green shield "Verified Credential". Only an operator can set this.
 * - pending_review: a neutral "Awaiting review".
 * - rejected: nothing. A rejected credential is not shown to anyone.
 */
export function credentialBadge(status) {
  switch (status) {
    case "self_declared":
      return { label: "Self-declared Licence", tone: "neutral", verified: false };
    case "verified":
      return { label: "Verified Credential", tone: "verified", verified: true };
    case "pending_review":
      return { label: "Awaiting review", tone: "neutral", verified: false };
    default:
      return null;
  }
}
