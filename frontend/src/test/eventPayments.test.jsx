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
  it("closes booking when a price has no usable payment method", () => {
    render(<EventPaymentCard event={{ ...event, payment_method: null, payment_ready: false, entry_fee: 500 }} onBook={vi.fn()} />);
    expect(screen.getByRole("button", { name: /booking closed/i })).toBeDisabled();
    expect(screen.getByText(/no payment method yet/i)).toBeInTheDocument();
  });
  it("shows cash instructions and no M-Pesa box for a cash booking", () => {
    render(<EventPaymentCard event={{ ...event, payment_method: "CASH", payment_ready: true, entry_fee: 400, confirmed_count: 0, active_holds: 1 }} registration={{ booking_status: "PENDING_PAYMENT", hold_expires_at: "2030-01-01T10:00:00" }} />);
    expect(screen.getByText(/Pay KSh 400 in cash/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/M-Pesa message/i)).not.toBeInTheDocument();
  });
  it("does not offer a pass for a submitted note", () => {
    render(<EventPaymentCard event={event} registration={{ booking_status: "PAYMENT_SUBMITTED", mpesa_code: "UKG8X2Y4Z1" }} />);
    expect(screen.getByText(/waiting for the organiser/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open pass/i })).not.toBeInTheDocument();
  });
});
