import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import EventForm from "@/components/forms/EventForm";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/stores/eventStore", () => ({
  useEventStore: (selector) => selector({ create: mocks.create }),
}));

vi.mock("@/lib/api", () => ({
  apiError: (_err, fallback) => fallback,
}));

describe("event creation payment section", () => {
  it("names the payment section and offers the organiser's own rails", () => {
    render(<EventForm />);
    expect(screen.getByRole("heading", { name: /tickets & payment/i })).toBeInTheDocument();
    expect(screen.getByText(/Money goes directly to you/)).toBeInTheDocument();
    const select = screen.getByLabelText(/How guests pay you/);
    expect(select).toHaveValue("");
    expect(screen.getByRole("option", { name: "M-Pesa Paybill" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Cash to the organiser" })).toBeInTheDocument();
  });

  it("explains cash and asks for no M-Pesa number", () => {
    render(<EventForm />);
    fireEvent.change(screen.getByLabelText(/How guests pay you/), { target: { value: "CASH" } });
    expect(screen.getByText(/No M-Pesa note is needed/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Till number/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Paybill number/)).not.toBeInTheDocument();
  });

  it("asks for a Paybill number and account when Paybill is chosen", () => {
    render(<EventForm />);
    fireEvent.change(screen.getByLabelText(/How guests pay you/), { target: { value: "PAYBILL" } });
    expect(screen.getByLabelText(/Paybill number/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Account reference/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Recipient name/)).toBeInTheDocument();
  });
});
