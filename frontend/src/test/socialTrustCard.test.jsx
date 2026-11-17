import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/Toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import SocialTrustCard from "@/components/social/SocialTrustCard";

const card = {
  handle: "achieng",
  name: "Achieng Shoes",
  account_kind: "vendor",
  standing_level: 2,
  account_age_days: 140,
  verified_deliveries: 9,
  verified_deliveries_label: "9 completed deliveries",
  delivery_note: "Buyer-confirmed trades only.",
  dispute: {
    open_reports: 2,
    raw_open_reports: 2,
    ratio_label: "2 unresolved",
    warning: true,
    warning_text: "⚠ 2 Unresolved Delivery Reports — Inspect Before Paying",
    signal_note: "Reports come from Level 2+ buyers who traded with this seller. A report is an allegation, not a finding.",
  },
  bio_links: [
    {
      platform: "tiktok",
      handle: "achieng.shoes",
      profile_url: "https://www.tiktok.com/@achieng.shoes",
      bio_verified: true,
      signal_note: "A bio match means the public profile links here. It does not verify the business and awards no standing credit.",
    },
  ],
  stock_proof: {
    image_url: "/uploads/stock.jpg",
    label: "Stock-in-Hand Photo • Code KSM-92 (Valid 48h)",
    code: "KSM-92",
    item_title: "Nike Air Max 90",
    price_kes: 4200,
    expires_at: "2026-11-19T09:00:00Z",
    signal_note: "A photo proves a photo was taken beside today's code, nothing more.",
  },
  routines: [{ title: "Saturday deliveries", day_of_week: 6, recurrence_label: "Weekly • Every Sat", start_time_local: "08:00", town: "Kisumu" }],
  routine_note: "A weekly badge is a schedule, not a reliability guarantee.",
  trust_reply: "Check my verified delivery record & stock-in-hand proof before ordering: https://brief.example/p/achieng",
  page_url: "https://brief.example/p/achieng",
  signals_note: "Every signal here is self-reported or buyer-reported. A signal — it does not award standing credit.",
};

describe("social seller trust card", () => {
  it("leads with the amber delivery warning and its exact copy", () => {
    render(<SocialTrustCard card={card} />);
    expect(screen.getByTestId("delivery-warning-banner")).toHaveTextContent(
      "⚠ 2 Unresolved Delivery Reports — Inspect Before Paying",
    );
  });

  it("labels the stock photo with the 48-hour code", () => {
    render(<SocialTrustCard card={card} />);
    expect(screen.getByText("Stock-in-Hand Photo • Code KSM-92 (Valid 48h)")).toBeInTheDocument();
    expect(screen.getByText("Nike Air Max 90")).toBeInTheDocument();
  });

  it("shows the weekly pill as a schedule, not a guarantee", () => {
    render(<SocialTrustCard card={card} />);
    expect(screen.getAllByText(/Weekly • Every Sat/).length).toBeGreaterThan(0);
    expect(screen.getByText(/A signal — it does not award standing credit/)).toBeInTheDocument();
  });

  it("copies the one-tap trust reply with the /p/ link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<SocialTrustCard card={card} />);
    fireEvent.click(screen.getByRole("button", { name: /copy trust reply/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(card.trust_reply));
    expect(card.trust_reply).toContain("/p/achieng");
  });
});
