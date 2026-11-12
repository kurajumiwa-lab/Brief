import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { credentialBadge } from "@/components/credentials/credentialStatus";
import CredentialBadge from "@/components/credentials/CredentialBadge";

// Blueprint rule: a self-declared licence must never look verified.
describe("credential badges", () => {
  it("self_declared is a grey Self-declared Licence, never verified", () => {
    const b = credentialBadge("self_declared");
    expect(b.label).toBe("Self-declared Licence");
    expect(b.verified).toBe(false);
    expect(b.tone).toBe("neutral");
  });

  it("verified is the green Verified Credential", () => {
    const b = credentialBadge("verified");
    expect(b.label).toBe("Verified Credential");
    expect(b.verified).toBe(true);
    expect(b.tone).toBe("verified");
  });

  it("rejected and unknown statuses render nothing", () => {
    expect(credentialBadge("rejected")).toBeNull();
    expect(credentialBadge("anything-else")).toBeNull();
    const { container } = render(<CredentialBadge status="rejected" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("the component shows the self-declared label without the verified styling", () => {
    const { container } = render(<CredentialBadge status="self_declared" />);
    expect(screen.getByText("Self-declared Licence")).toBeInTheDocument();
    expect(screen.queryByText(/verified/i)).toBeNull();
    expect(container.querySelector(".text-tech-700")).toBeNull();
    expect(container.querySelector(".lucide-shield-check")).toBeNull();
  });

  it("the component shows verified with the green shield", () => {
    const { container } = render(<CredentialBadge status="verified" />);
    expect(screen.getByText("Verified Credential")).toBeInTheDocument();
    expect(container.querySelector(".text-tech-700")).not.toBeNull();
    expect(container.querySelector(".lucide-shield-check")).not.toBeNull();
  });
});
