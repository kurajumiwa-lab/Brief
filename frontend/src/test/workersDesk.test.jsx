import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AssignedToMe, ManageWork } from "@/components/desk/WorkersPanel";
import { workersAPI, officeAPI } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  workersAPI: {
    mine: vi.fn(),
    assignments: vi.fn(),
    assign: vi.fn(),
    start: vi.fn(),
    complete: vi.fn(),
    cancel: vi.fn(),
    reassign: vi.fn(),
    history: vi.fn(),
  },
  officeAPI: { mine: vi.fn() },
  apiError: (_error, fallback) => fallback,
}));

vi.mock("@/components/ui/Toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const work = (over = {}) => ({
  id: "w1",
  office_id: "o1",
  title: "Stock the cold room",
  details: "Before 9am",
  status: "assigned",
  assignee_handle: "amina",
  assignee_label: null,
  assignee_active: true,
  ...over,
});

describe("Assigned to me", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows an empty message when nothing is assigned", async () => {
    workersAPI.mine.mockResolvedValue({ data: { items: [] } });
    render(<AssignedToMe />);
    expect(await screen.findByText("No work is assigned to you right now.")).toBeInTheDocument();
  });

  it("lists assigned work and starts it, then reloads", async () => {
    workersAPI.mine
      .mockResolvedValueOnce({ data: { items: [work()] } })
      .mockResolvedValueOnce({ data: { items: [work({ status: "in_progress" })] } });
    workersAPI.start.mockResolvedValue({ data: {} });
    render(<AssignedToMe />);
    expect(await screen.findByText("Stock the cold room")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(workersAPI.start).toHaveBeenCalledWith("w1"));
    await waitFor(() => expect(screen.getByText(/In progress/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark done" })).toBeInTheDocument();
  });

  it("marks work done", async () => {
    workersAPI.mine
      .mockResolvedValueOnce({ data: { items: [work({ status: "in_progress" })] } })
      .mockResolvedValueOnce({ data: { items: [] } });
    workersAPI.complete.mockResolvedValue({ data: {} });
    render(<AssignedToMe />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark done" }));
    await waitFor(() => expect(workersAPI.complete).toHaveBeenCalledWith("w1"));
  });

  it("shows an error when work cannot be loaded", async () => {
    workersAPI.mine.mockRejectedValue(new Error("boom"));
    render(<AssignedToMe />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your assigned work.");
  });
});

describe("Work I assign", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is hidden for an office where I am only a member", async () => {
    officeAPI.mine.mockResolvedValue({ data: { offices: [{ id: "o1", name: "Kisumu Co-op", my_role: "member" }] } });
    const { container } = render(<ManageWork />);
    await waitFor(() => expect(officeAPI.mine).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the assign form for an office I can edit and checks the handle first", async () => {
    officeAPI.mine.mockResolvedValue({ data: { offices: [{ id: "o1", name: "Kisumu Co-op", my_role: "editor" }] } });
    workersAPI.assignments.mockResolvedValue({ data: { items: [] } });
    render(<ManageWork />);
    const form = await screen.findByRole("form", { name: "Assign work in Kisumu Co-op" });
    fireEvent.click(screen.getByRole("button", { name: "Assign work" }));
    expect(await screen.findByText("Give the work a title of at least 2 characters.")).toBeInTheDocument();
    expect(workersAPI.assign).not.toHaveBeenCalled();
    expect(form).toBeInTheDocument();
  });

  it("assigns work to a handle, dropping a leading @", async () => {
    officeAPI.mine.mockResolvedValue({ data: { offices: [{ id: "o1", name: "Kisumu Co-op", my_role: "owner" }] } });
    workersAPI.assignments.mockResolvedValue({ data: { items: [] } });
    workersAPI.assign.mockResolvedValue({ data: {} });
    render(<ManageWork />);
    await screen.findByRole("form", { name: "Assign work in Kisumu Co-op" });
    fireEvent.change(screen.getByLabelText("Work"), { target: { value: "Stock the cold room" } });
    fireEvent.change(screen.getByLabelText("Assign to (@handle)"), { target: { value: "@amina" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign work" }));
    await waitFor(() => expect(workersAPI.assign).toHaveBeenCalledWith("o1", {
      title: "Stock the cold room", details: null, assignee_handle: "amina",
    }));
  });
});
