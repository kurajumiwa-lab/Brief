import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * ATTENTION IS A ROUTE, NOT A DASHBOARD NUMBER.
 *
 * Home must say separately how many chats and notifications need attention,
 * and each shortcut must land on the Inbox tab that answers it. These are the
 * user journeys behind the UI simplification: a person sees a count, taps it,
 * and arrives at the right list.
 */

vi.mock("@/components/location/LocationIndicator", () => ({
  default: () => <div data-testid="location-indicator" />,
}));

vi.mock("@/components/search/MarketplaceSearch", () => ({
  default: () => <input aria-label="Search everything" />,
}));

import HomeHero from "@/components/home/HomeHero";

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{pathname}{search}</output>;
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/"
          element={(
            <HomeHero
              name="Amina"
              firstName="Amina"
              attention={{ chats: 4, notifications: 2, waiting: 1 }}
              now={new Date("2026-11-26T09:00:00")}
            />
          )}
        />
        <Route path="/inbox" element={<p>Inbox screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Home's communication-first shortcuts", () => {
  it("shows separate unread message and notification counts, plus the trade waiting", () => {
    renderHome();
    const chats = screen.getByTestId("home-chats");
    const notifications = screen.getByTestId("home-notifications");
    expect(chats).toHaveAccessibleName(/4 unread messages/i);
    expect(notifications).toHaveAccessibleName(/2 unread/i);
    expect(chats.textContent).toContain("4");
    expect(notifications.textContent).toContain("2");
    expect(screen.getByText(/1 trade waiting on your confirmation/i)).toBeInTheDocument();
  });

  it("lands each shortcut on the Inbox tab it names", () => {
    const first = renderHome();
    fireEvent.click(screen.getByTestId("home-notifications"));
    expect(screen.getByTestId("location")).toHaveTextContent("/inbox?tab=notifications");
    first.unmount();

    const second = renderHome();
    fireEvent.click(screen.getByTestId("home-chats"));
    expect(screen.getByTestId("location")).toHaveTextContent("/inbox?tab=chats");
    second.unmount();
  });
});
