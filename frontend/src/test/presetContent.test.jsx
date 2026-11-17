import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PresetContent from "@/components/page/PresetContent";

describe("public Page presets", () => {
  it("shows public shop offers, not a personal redemption code", () => {
    render(<MemoryRouter><PresetContent card={{preset:"shop",payment_tag:{type:"paybill",number:"123456",account:"SHOP"},preset_content:{shops:[{name:"Shop",status:"probationary"}],catalog:[],offers:[{title:"Tea",discount_kes:50,points_cost:20}],rounds:[]}}} /></MemoryRouter>);
    expect(screen.getByText(/Probationary owner/)).toBeInTheDocument();
    expect(screen.getByText(/Paybill: 123456/)).toBeInTheDocument();
    expect(screen.getByText(/Tea · KSh 50 off/)).toBeInTheDocument();
    expect(screen.getByText(/private redemption codes are not published/)).toBeInTheDocument();
  });
  it("shows a public headcount and shareable event link", () => {
    render(<MemoryRouter><PresetContent card={{preset:"host",preset_content:{rounds:[{id:"1",title:"Hike",starts_at:"2030-01-01T00:00:00Z",meeting:"Town stage",joined:4,capacity:10,url:"/e/hike"}]}}} /></MemoryRouter>);
    expect(screen.getByText("4/10 joined")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("max","10");
    expect(screen.getByRole("link",{name:"Hike"})).toHaveAttribute("href","/e/hike");
  });
});
