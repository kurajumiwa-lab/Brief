import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import OfficePage from "@/pages/office/OfficePage";

const mocks = vi.hoisted(() => ({
  mine: vi.fn(),
  detail: vi.fn(),
  saved: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  officeAPI: {
    mine: mocks.mine,
    detail: mocks.detail,
    saved: mocks.saved,
    calendar: vi.fn(),
    create: vi.fn(),
    saveItem: vi.fn(),
    updateSaved: vi.fn(),
    deleteSaved: vi.fn(),
    inviteAccount: vi.fn(),
    inviteLink: vi.fn(),
    removeMember: vi.fn(),
    addEvent: vi.fn(),
  },
  apiError: (_e, fallback) => fallback,
}));

const renderOffice = () =>
  render(
    <MemoryRouter>
      <OfficePage />
    </MemoryRouter>,
  );

describe("the office screen never shows a blank page", () => {
  it("names the screen while it loads instead of showing bare white", () => {
    mocks.mine.mockReturnValue(new Promise(() => {}));
    renderOffice();
    expect(screen.getByRole("heading", { name: "Home office" })).toBeInTheDocument();
    expect(screen.getByTestId("office-loading")).toBeInTheDocument();
  });

  it("explains a failed load, reassures about data, and offers a retry", async () => {
    mocks.mine.mockRejectedValueOnce(new Error("network"));
    renderOffice();
    expect(await screen.findByText(/Your office did not open/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was lost/i)).toBeInTheDocument();

    mocks.mine.mockResolvedValueOnce({ data: { offices: [] } });
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /create office/i })).toBeInTheDocument());
  });

  it("says so when the network has answered nothing for ten seconds", async () => {
    vi.useFakeTimers();
    mocks.mine.mockReturnValue(new Promise(() => {}));
    renderOffice();
    await vi.advanceTimersByTimeAsync(10000);
    expect(screen.getByText(/taking longer than usual/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    vi.useRealTimers();
  });
});
