import { ShieldCheck, FileBadge } from "lucide-react";
import { credentialBadge } from "@/components/credentials/credentialStatus";

/** One credential's badge. Renders nothing for rejected or unknown statuses. */
export default function CredentialBadge({ status }) {
  const b = credentialBadge(status);
  if (!b) return null;
  if (b.verified) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-tech-100 px-2 py-0.5 text-xs font-semibold text-tech-700">
        <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
        {b.label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-xs font-medium text-ink-2">
      <FileBadge aria-hidden="true" className="h-3.5 w-3.5" />
      {b.label}
    </span>
  );
}
