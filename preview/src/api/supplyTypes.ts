import type { SupplyRole as CapabilitySupplyRole } from "./requestTypes";
export const businessTypes = [
  "manufacturer",
  "wholesaler",
  "distributor",
  "retailer",
  "service_provider",
  "logistics_provider",
  "warehouse",
  "processor",
  "fabricator",
  "repair_provider",
  "sourcing_agent",
  "hybrid",
] as const;
export type BusinessType = (typeof businessTypes)[number];
export type EnterpriseSupplyRole = CapabilitySupplyRole | "hybrid";
export type VerificationState =
  | "unverified"
  | "submitted"
  | "under_review"
  | "verified"
  | "rejected"
  | "expired";
export interface VerificationStanding {
  status: VerificationState;
  verifiedAt: string | null;
  expiresAt: string | null;
  method: "manual_review" | null;
}
export interface LeadTime {
  minDays: number | null;
  maxDays: number | null;
}
export interface SupplyActivity {
  id: string;
  actorId: string;
  action: string;
  changedFields: string[];
  at: string;
}
export interface EnterpriseInput {
  displayName: string;
  legalName: string;
  description: string;
  businessType: BusinessType;
  supplyRole: EnterpriseSupplyRole;
  location: string;
  serviceAreas: string[];
  operatingStatus: "active" | "paused" | "closed";
  publication: "private" | "public";
  contactPreferences: {
    method: "brief" | "email" | "phone" | "whatsapp";
    value: string;
    public: boolean;
  };
}
export interface SourcingInput {
  serviceDescription: string;
  experienceYears: number | null;
  categories: string[];
  regions: string[];
  typicalOrderMin: number | null;
  typicalOrderMax: number | null;
  sourcingLeadTime: LeadTime;
  deliveryCoordination: boolean;
  inspectionCapability: boolean;
  negotiationCapability: boolean;
  privateNetworks: string;
}
export interface CapabilityInput {
  name: string;
  category: string;
  description: string;
  productsServices: string[];
  materials: string[];
  specifications: { name: string; value: string }[];
  minimumQuantity: number | null;
  maximumQuantity: number | null;
  typicalCapacity: number | null;
  availableCapacity: number | null;
  unit: string;
  capacityPeriod: "per_order" | "day" | "week" | "month";
  capacityKind:
    | "production"
    | "stock"
    | "service"
    | "logistics"
    | "sourcing_access";
  availability: "unknown" | "available" | "limited" | "unavailable";
  productionSchedule: string;
  leadTime: LeadTime;
  serviceAreas: string[];
  operatingStatus: "active" | "paused" | "archived";
  supplyMode: "direct" | "source";
  evidence: { uploadId: string }[];
  sourcingAccess: {
    products: string[];
    regions: string[];
    networkDescription: string;
    deliveryCoordination: boolean;
    inspectionCapability: boolean;
    negotiationCapability: boolean;
  };
}
export interface Capability extends CapabilityInput {
  id: string;
  participantId: string;
  revision: number;
  history?: SupplyActivity[];
  createdAt: string;
  updatedAt: string;
  declaredAt: string;
  verification: VerificationStanding;
  capacityInformation: {
    basis: "stated_by_business" | "verified";
    declaredAt: string;
    verification: VerificationStanding;
    currentConfirmation: null;
  };
  evidence: { uploadId: string; url: string | null }[];
}
export interface Enterprise
  extends Omit<EnterpriseInput, "legalName" | "contactPreferences"> {
  id: string;
  ownerId?: string;
  legalName?: string;
  revision?: number;
  history?: SupplyActivity[];
  createdAt: string;
  updatedAt: string;
  roleLabel: string;
  disclosure: string;
  contactPreferences: {
    method: EnterpriseInput["contactPreferences"]["method"];
    value: string | null;
    public: boolean;
  };
  verification: {
    identity: VerificationStanding;
    businessType: VerificationStanding;
    sourcingRole: VerificationStanding;
  };
  capabilities: Capability[];
  sourcingProfile:
    | (Omit<SourcingInput, "privateNetworks"> & { privateNetworks?: string })
    | null;
}
export interface CapabilityHit {
  capability: Capability;
  participant: Omit<Enterprise, "capabilities">;
}
export interface CapabilitySearch {
  total: number;
  offset: number;
  limit: number;
  capabilities: CapabilityHit[];
}
export type VerificationKind =
  | "identity"
  | "business_type"
  | "sourcing_role"
  | "capability"
  | "capacity"
  | "authorization";
export const evidenceTypes = [
  "business_registration",
  "tax_identifier",
  "physical_location",
  "operating_evidence",
  "certification",
  "authorization",
  "supplier_relationship",
  "capability_evidence",
] as const;
export interface SupplyEvidence {
  uploadId: string;
  type: (typeof evidenceTypes)[number];
  note: string;
}
export interface SupplyVerification {
  id: string;
  participantId: string;
  userId: string;
  kind: VerificationKind;
  capabilityId: string | null;
  evidence: SupplyEvidence[];
  note: string;
  status: VerificationState;
  effectiveStatus: VerificationState;
  revision: number;
  history: SupplyActivity[];
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reason: string | null;
  expiresAt: string | null;
}
export interface PotentialParticipant {
  id: string;
  requestId: string;
  participantId: string;
  capabilityId: string;
  supplyMode: "direct" | "source";
  status: "potential" | "removed";
  origin: "requester_selected";
  revision: number;
  createdAt: string;
  updatedAt: string;
  history: SupplyActivity[];
  available: boolean;
  provenance: null;
  capability: Capability | null;
  participant: Pick<
    Enterprise,
    "id" | "displayName" | "roleLabel" | "disclosure"
  > | null;
}
// Extend the existing Request response foundation, not a parallel quote model.
export type {
  RequestResponseFoundation,
  SupplyRelationship,
} from "./requestTypes";

// Vendor leads: a shop somebody met on the street. Captured by a scout, with
// no cap on how many one account captures. A lead is not a shop and cannot
// take orders until produce is confirmed by linking a real row.
export type VendorLeadStatus = "captured" | "validated" | "claimed" | "dropped";
export type VendorLeadCauseKind = "capability" | "request" | "workOrder";
export type ExposurePeriod = "once" | "weekly" | "monthly";
export interface VendorLeadProduce {
  kind: VendorLeadCauseKind;
  id: string;
  at: string;
  by: string;
}
export interface VendorLeadExposureTerms {
  amountKes: number;
  period: ExposurePeriod;
  note: string;
  setBy: string;
  setAt: string;
}
export interface VendorLeadInput {
  name: string;
  contact: string;
  category: string;
  photo?: string | null;
  siteUrl?: string | null;
  note?: string;
  idempotencyKey?: string;
  /** How the lead was captured: typed by hand, or picked from a pasted note. */
  source?: string;
  /** Scout GPS at capture. A pair or absent — never half a pin. */
  lat?: number | null;
  lon?: number | null;
}
export interface VendorLead {
  id: string;
  scoutId: string;
  name: string;
  contact: string;
  category: string;
  photo: string | null;
  siteUrl: string | null;
  note: string;
  status: VendorLeadStatus;
  produce: VendorLeadProduce | null;
  exposureTerms: VendorLeadExposureTerms | null;
  /** 'manual' or 'scrape-note'. Absent on leads captured before the tray. */
  source?: string;
  /** Scout GPS at capture. Absent on leads captured without a pin. */
  lat?: number | null;
  lon?: number | null;
  /** Server-minted pickup code. Absent until the scout mints one on a pin. */
  code?: string | null;
  createdAt: string;
  updatedAt: string;
}
// The minimum a courier needs from a pickup code: name, pin, photo. No
// contact, no note, no terms — the vendor never consented to a listing.
export interface LeadCodeView {
  code: string;
  name: string;
  category: string;
  photo: string | null;
  lat: number;
  lon: number;
  status: string;
}
