import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import Drawer from "@/components/ui/Drawer";

/**
 * THE SHEET'S TWO CONTRACTUAL BEHAVIOURS.
 *
 * Both were broken and neither had a test, which is why they shipped:
 *
 *   · `role="dialog"` with no accessible name is announced as "dialog" and
 *     nothing else. The workspace drawer sets `hideHeader` because it draws its
 *     own top bar, and the old fallback named the panel *"Panel"*.
 *   · focus went into the sheet and never came back. On close a keyboard user
 *     landed on `<body>` and had to tab from the top of the page again.
 */

function Harness({ label, hideHeader = false }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open it
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        side="left"
        label={label}
        hideHeader={hideHeader}
      >
        <button type="button">Inside the sheet</button>
      </Drawer>
    </div>
  );
}

describe("the Drawer names itself", () => {
  it("carries the caller's label, not a placeholder", () => {
    render(<Harness label="Workspace menu" hideHeader />);
    fireEvent.click(screen.getByRole("button", { name: /open it/i }));

    // The regression was a dialog called "Panel": present in the a11y tree,
    // useless to anyone listening to it.
    expect(screen.getByRole("dialog", { name: "Workspace menu" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Panel" })).not.toBeInTheDocument();
  });

  it("falls back to the visible title when no label is given", () => {
    render(
      <Drawer open onClose={() => {}} title="Review">
        <p>body</p>
      </Drawer>,
    );
    expect(screen.getByRole("dialog", { name: "Review" })).toBeInTheDocument();
  });
});

describe("the Drawer returns focus", () => {
  it("puts focus back on the control that opened it", () => {
    render(<Harness label="Workspace menu" hideHeader />);
    const opener = screen.getByRole("button", { name: /open it/i });

    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    // Without restoration this is `document.body` and the keyboard user has
    // lost their place on the page.
    expect(document.activeElement).toBe(opener);
  });

  it("moves focus into the sheet when it opens", () => {
    render(<Harness label="Workspace menu" hideHeader />);
    fireEvent.click(screen.getByRole("button", { name: /open it/i }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape, which is the only key handling it should own", () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="Review">
        <p>body</p>
      </Drawer>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
