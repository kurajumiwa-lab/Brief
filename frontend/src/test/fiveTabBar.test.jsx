import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MobileTabBar from "@/components/layout/MobileTabBar";

function renderBar(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MobileTabBar />
    </MemoryRouter>,
  );
}

describe("mobile tab bar", () => {
  it("shows Home, Regions, Create, Inbox and You — and nothing retired", () => {
    renderBar("/regions");
    const nav = screen.getByRole("navigation", { name: "Primary mobile" });
    const links = within(nav).getAllByRole("link").map((a) => a.textContent.trim());
    expect(links).toEqual(["Home", "Regions", "Create", "Inbox", "You"]);
    expect(screen.queryByTestId("tab-mall")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-explore")).not.toBeInTheDocument();
  });

  it("marks only the current tab as the page", () => {
    renderBar("/regions/nyanza");
    const nav = screen.getByRole("navigation", { name: "Primary mobile" });
    const current = within(nav).getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent.trim())).toEqual(["Regions"]);
  });

  it("keeps Create as the one prominent action, in the middle", () => {
    renderBar("/");
    const nav = screen.getByRole("navigation", { name: "Primary mobile" });
    const links = within(nav).getAllByRole("link");
    expect(links[2]).toHaveAttribute("href", "/create");
    expect(links[2]).toHaveAttribute("data-testid", "tab-create");
  });
});
