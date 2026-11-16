import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { addDays, format } from "date-fns";
import { describe, expect, it, vi } from "vitest";

vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }) => <div data-testid="qr-value">{value}</div>,
}));

import InboxTimeline from "@/components/inbox/InboxTimeline";
import TradePassModal from "@/components/inbox/TradePassModal";

const at = (date, hour = 10) => {
  const copy = new Date(date);
  copy.setHours(hour, 0, 0, 0);
  return copy.toISOString();
};

const today = new Date();
const tomorrow = addDays(today, 1);

const confirmed = {
  id: "booking:1", kind: "booking", record_id: "b1",
  title: "Bulk maize delivery", starts_at: at(today),
  place: "Kisumu", price_kes: 500, capacity: 10, joined: 4,
  state: "confirmed", status_label: "Booking confirmed",
  counterparty: { name: "Kisumu Growers", handle: "growers" },
  to: "/activities/1", passable: true, pass_code: "HO-84K",
};

const waiting = {
  id: "round:2", kind: "round", record_id: "r2",
  title: "Boda ride to Ahero", starts_at: at(tomorrow),
  place: "Kisumu", price_kes: null, capacity: null, joined: 3,
  state: "waiting", status_label: "Waiting confirmation",
  counterparty: { name: "Ahero Riders", handle: "riders" },
  to: "/activities/2", passable: false, pass_code: null,
};

function renderTimeline(props = {}) {
  return render(
    <MemoryRouter>
      <InboxTimeline items={[confirmed, waiting]} {...props} />
    </MemoryRouter>,
  );
}

describe("Inbox agenda", () => {
  it("puts real rounds on real dates with their actual counters and states", () => {
    renderTimeline();
    const rows = screen.getAllByTestId("agenda-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Bulk maize delivery")).toBeInTheDocument();
    expect(within(rows[0]).getByText("4/10 joined")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Booking confirmed")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Waiting confirmation")).toBeInTheDocument();
    expect(within(rows[1]).getByText("3 joined")).toBeInTheDocument();
    // No capacity means no invented denominator.
    expect(within(rows[1]).queryByText(/\/\d+ joined/)).not.toBeInTheDocument();
  });

  it("only gives a pass to a record that is actually confirmed", () => {
    const onOpenPass = vi.fn();
    renderTimeline({ onOpenPass });
    const rows = screen.getAllByTestId("agenda-row");
    fireEvent.click(within(rows[0]).getByRole("button", { name: /pass/i }));
    expect(onOpenPass).toHaveBeenCalledWith(confirmed);
    expect(within(rows[1]).queryByRole("button", { name: /pass/i })).not.toBeInTheDocument();
    expect(within(rows[1]).getByRole("link", { name: /view/i })).toHaveAttribute("href", "/activities/2");
  });

  it("marks the days that have a real round and filters to that day", () => {
    renderTimeline();
    const marked = screen.getByRole("button", { name: /today .*has rounds/i });
    expect(marked).toBeInTheDocument();
    const tomorrowButton = screen.getByRole("button", {
      name: new RegExp(`${format(tomorrow, "EEE")} ${format(tomorrow, "d")}.*has rounds`, "i"),
    });
    fireEvent.click(tomorrowButton);
    expect(screen.queryByText("Bulk maize delivery")).not.toBeInTheDocument();
    expect(screen.getByText("Boda ride to Ahero")).toBeInTheDocument();
  });

  it("offers a real confirm action for a booking that is waiting on the member", () => {
    const onConfirmTrade = vi.fn();
    const pending = {
      ...confirmed,
      id: "booking:3", record_id: "b3", title: "Fundi visit",
      state: "waiting", status_label: "Waiting on you",
    };
    render(
      <MemoryRouter>
        <InboxTimeline items={[pending]} onConfirmTrade={onConfirmTrade} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onConfirmTrade).toHaveBeenCalledWith(pending);
  });

  it("shows an honest empty state and a way to find a round", () => {
    render(
      <MemoryRouter>
        <InboxTimeline items={[]} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/nothing on your calendar yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /find a round near you/i })).toHaveAttribute("href", "/regions");
  });
});

describe("Shared trade pass", () => {
  it("shows the same code the record carries, a QR payload, and a WhatsApp share", () => {
    const onClose = vi.fn();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<TradePassModal pass={confirmed} memberHandle="ogallo" onClose={onClose} />);

    expect(screen.getByTestId("trade-pass-code")).toHaveTextContent("HO-84K");
    expect(screen.getByTestId("qr-value")).toHaveTextContent("/activities/1?pass=HO-84K");
    expect(screen.getByText("/p/ogallo")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("trade-pass-share"));
    const url = open.mock.calls[0][0];
    expect(url).toMatch(/^https:\/\/wa\.me\/\?text=/);
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("HO-84K");
    expect(text).toContain("Bulk maize delivery");
    expect(text).toContain("/activities/1?pass=HO-84K");

    fireEvent.click(screen.getByTestId("trade-pass-done"));
    expect(onClose).toHaveBeenCalled();
    open.mockRestore();
  });
});
