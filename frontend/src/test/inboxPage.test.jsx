/**
 * THE WEEK BAND — agenda and routine sharing, on Home.
 *
 * These two specs used to render `InboxPage` and assert that the week's
 * bookings and the routine share prompts appeared above the message list. That
 * was true of the old screen and is exactly what the brief moved: scheduled
 * work belongs on Home, and the Inbox is Chats and Notifications only.
 *
 * The behaviour is unchanged, so the assertions are too — retargeted at
 * `WeekBand`, the component both screens now share. This is why the tests moved
 * rather than being deleted: what they protect (a pass opens without a second
 * tap, a share opens WhatsApp and records that it happened) still has to work.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const agenda = {
    items: [{
      id: "booking:b1", kind: "booking", record_id: "b1",
      title: "Bulk maize delivery", starts_at: new Date().toISOString(),
      place: "Kisumu", price_kes: 500, capacity: 10, joined: 4,
      state: "confirmed", status_label: "Booking confirmed",
      counterparty: { name: "Kisumu Growers", handle: "growers" },
      to: "/activities/1", passable: true, pass_code: "HO-84K",
    }],
  };
  return {
    agenda,
    routineMine: vi.fn().mockResolvedValue({ data: { routines: [], share_prompts: [] } }),
    routineMarkShared: vi.fn().mockResolvedValue({ data: {} }),
    windowOpen: vi.fn(),
  };
});

vi.mock("@/lib/api", () => ({
  apiError: (_error, fallback) => fallback,
  outsideAPI: { agenda: vi.fn().mockResolvedValue({ data: mocks.agenda }) },
  corridorTaskAPI: { inbox: vi.fn().mockResolvedValue({ data: { days: [], tasks: [], earnings: null } }) },
  recurringRoutineAPI: { mine: mocks.routineMine, markShared: mocks.routineMarkShared },
  fileAPI: {},
}));

vi.mock("@/lib/ledgerApi", () => ({
  default: { confirmCompletion: vi.fn().mockResolvedValue({ data: {} }) },
}));

import { useState } from "react";
import WeekBand from "@/components/home/WeekBand";
import TradePassModal from "@/components/inbox/TradePassModal";

/**
 * The pass modal is page-level state, as it is in `TodayPage` — the band raises
 * the record and the page owns the dialog. Mounting both here is the same
 * arrangement the app uses, so the "one tap" contract is tested as it ships.
 */
function Harness(props) {
  const [pass, setPass] = useState(null);
  return (
    <>
      <WeekBand
        agenda={mocks.agenda.items}
        agendaLoading={false}
        agendaError=""
        onRetryAgenda={() => {}}
        onOpenPass={setPass}
        taskData={{ days: [], tasks: [], earnings: null }}
        sharePrompts={[]}
        {...props}
      />
      <TradePassModal pass={pass} memberHandle="ogallo" onClose={() => setPass(null)} />
    </>
  );
}

const mount = (props = {}) =>
  render(
    <MemoryRouter>
      <Harness {...props} />
    </MemoryRouter>,
  );

describe("WeekBand — the agenda on Home", () => {
  it("renders the week's real booking and opens its pass without a second click", async () => {
    mount();

    expect(await screen.findByText("Bulk maize delivery")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-timeline")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /pass/i }));
    expect(screen.getByTestId("trade-pass")).toBeInTheDocument();
    expect(screen.getByTestId("trade-pass-code")).toHaveTextContent("HO-84K");
  });

  it("stays out of the way entirely when the week is empty", async () => {
    // A permanent empty calendar above a Home feed is the "everything at once"
    // the Inbox redesign was about. Nothing to show, nothing rendered.
    mount({ agenda: [], taskData: null, sharePrompts: [] });
    expect(screen.queryByTestId("week-band")).toBeNull();
  });

  it("names the band once, rather than five headings", async () => {
    mount();
    expect(screen.getByRole("heading", { name: /your week/i })).toBeInTheDocument();
  });
});

describe("WeekBand — routine sharing", () => {
  it("drops a one-tap WhatsApp share for this week's published round", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    vi.stubGlobal("open", mocks.windowOpen);

    mount({
      sharePrompts: [{
        instance_id: "i1",
        occurrence_date: "2026-11-21",
        title: "Saturday deliveries",
        share_path: "/activities/a1",
        share_text: "Saturday deliveries — Sat 21 Nov in Kisumu. This week's round is live; message me to book.",
        shared_at: null,
      }],
    });

    expect(await screen.findByText("Share this week's round")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /whatsapp/i }));
    await waitFor(() => expect(mocks.windowOpen).toHaveBeenCalled());
    expect(mocks.windowOpen.mock.calls[0][0]).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(mocks.routineMarkShared).toHaveBeenCalledWith("i1");
  });
});
