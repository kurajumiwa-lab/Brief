import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import EventPaymentCard from "@/components/events/EventPaymentCard";

describe("event payment card", () => {
  const event = { max_vendors: 2, confirmed_count: 1, active_holds: 1, waitlist_count: 3, payment_method: "TILL", payment_number: "1234", entry_fee: 500 };
  it("counts held seats when showing the waitlist action", () => {
    const book = vi.fn();
    render(<EventPaymentCard event={event} onBook={book} />);
    fireEvent.click(screen.getByRole("button", { name: /join waiting list/i }));
    expect(book).toHaveBeenCalledOnce();
    expect(screen.getByText(/3 waiting/i)).toBeInTheDocument();
  });
  it("does not offer a pass for a submitted note", () => {
    render(<EventPaymentCard event={event} registration={{ booking_status: "PAYMENT_SUBMITTED", mpesa_code: "UKG8X2Y4Z1" }} />);
    expect(screen.getByText(/waiting for the organiser/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open pass/i })).not.toBeInTheDocument();
  });
});
