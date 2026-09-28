export interface TrackingEvent {
  status: string;
  label: string;
  at: string | null;
  location: string | null;
  source: string;
}
export interface TrackingStep {
  id: string;
  label: string;
  at: string | null;
  location: string | null;
  completed: boolean;
  current: boolean;
}
export interface TrackingShipment {
  id: string;
  mode: 'stage' | 'door';
  status: string;
  label: string;
  description: string;
  carrier: string | null;
  trackingNumber: string | null;
  carrierContact: string | null;
  trackingReferenceKind: 'carrier' | 'wairo' | 'unspecified';
  estimatedDelivery: string | null;
  destination: string | null;
  lastLocation: string | null;
  quantity: number | null;
  canRequestPreferences: boolean;
  timeline: TrackingStep[];
  events: TrackingEvent[];
}
export type TrackingRequestKind =
  | 'preferences'
  | 'neighbor'
  | 'hold'
  | 'not_arrived'
  | 'wrong_item'
  | 'support';
export interface TrackingRequest {
  id: string;
  kind: TrackingRequestKind;
  message: string;
  shipmentId: string | null;
  status: string;
  createdAt: string;
  respondedAt: string | null;
}
export interface OrderTracking {
  orderNumber: string;
  orderDate: string;
  orderStatus: string;
  seller: string;
  sellerContact: string | null;
  deliveryAddress: string | null;
  deliveryInstructions: string | null;
  trackingEmailConfigured: boolean;
  items: { name: string; quantity: number; image: string | null }[];
  shipments: TrackingShipment[];
  split: boolean;
  requests: TrackingRequest[];
  notificationCapabilities: { sms: boolean; email: boolean; push: boolean };
  updatedAt: string;
  checkedAt: string;
}
export interface TrackingAccess {
  token: string;
  expiresAt: string;
  tracking: OrderTracking;
  canManage: boolean;
  canRespond: boolean;
}
export interface DeliveryDetails {
  email: string;
  address: string;
  instructions: string;
}
