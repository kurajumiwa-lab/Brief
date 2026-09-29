import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base

ROUTE_STATUSES = ("planned", "dispatched", "completed", "cancelled")


class RoutePlan(Base):
    """A courier's optimised run through a set of stops (v2.1 §5.5).

    Priced in kilometres: the plan stores what the stops would have cost in
    booking order (`baseline_distance_km`) and what the optimiser actually
    produced (`total_distance_km`), so the saving is auditable rather than
    claimed.
    """

    __tablename__ = "route_plans"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    courier_id = Column(UUID(as_uuid=True), ForeignKey('courier_registrations.id', ondelete='CASCADE'), nullable=False, index=True)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id', ondelete='CASCADE'), nullable=False, index=True)

    name = Column(String(200))
    planned_for = Column(DateTime)
    status = Column(String(50), default="planned", nullable=False, index=True)
    # planned → dispatched → completed | cancelled

    total_stops = Column(Integer, default=0, nullable=False)
    total_distance_km = Column(Float, default=0, nullable=False)
    baseline_distance_km = Column(Float, default=0, nullable=False)
    saved_km = Column(Float, default=0, nullable=False)
    estimated_minutes = Column(Integer, default=0, nullable=False)

    average_speed_kmh = Column(Float, default=25, nullable=False)
    return_to_start = Column(Boolean, default=False, nullable=False)
    algorithm = Column(String(50), default="nearest_neighbour+2opt", nullable=False)
    start_label = Column(String(300))
    start_lat = Column(Float)
    start_lng = Column(Float)
    notes = Column(Text)
    stops_meta = Column(JSONB, default=list)  # snapshot of the request that produced the plan
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    courier = relationship("CourierRegistration")
    vendor = relationship("Vendor")
    stops = relationship("RouteStop", back_populates="plan", cascade="all, delete-orphan",
                         order_by="RouteStop.sequence")


class RouteStop(Base):
    """One leg-stop on a :class:`RoutePlan`, in visiting order."""

    __tablename__ = "route_stops"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    route_plan_id = Column(UUID(as_uuid=True), ForeignKey('route_plans.id', ondelete='CASCADE'), nullable=False, index=True)
    shipment_id = Column(UUID(as_uuid=True), ForeignKey('courier_shipments.id', ondelete='SET NULL'), nullable=True, index=True)

    sequence = Column(Integer, nullable=False)     # 1-based visiting order
    label = Column(String(300), nullable=False)
    address = Column(String(500))
    contact_phone = Column(String(40))
    geo_lat = Column(Float)
    geo_lng = Column(Float)
    weight_kg = Column(Float)
    priority = Column(Integer, default=0, nullable=False)  # kept first inside a tie

    distance_from_prev_km = Column(Float, default=0)
    cumulative_km = Column(Float, default=0)
    eta_minutes = Column(Integer, default=0)
    solved = Column(Boolean, default=False, nullable=False)  # courier ticked it off

    plan = relationship("RoutePlan", back_populates="stops")
    shipment = relationship("CourierShipment")
