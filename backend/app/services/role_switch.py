"""Server-side rules for changing a vendor's operating role.

A role is not cosmetic: ``dormant`` removes the account from discovery. The
drawer's confirmation dialog is a UX safeguard, not an authorization boundary;
an API client, a stale tab or a request replay can bypass it. This module owns
the decision for BOTH write paths (``POST /vendors/switch-role/{role}`` and
``PUT /vendors/me``).

Dormancy therefore needs three independent facts:

* an explicit ``confirm_dormant`` acknowledgement on the mutating request;
* a short-lived, server-signed token issued by a separate non-mutating
  endpoint, so the server — not only the client — records a two-step intent;
* the caller's expected current role, so a stale screen cannot apply an old
  decision to a role that has since changed.

The token is bound to the vendor, the current role and the dormant target, and
expires in five minutes. It is not a session token and cannot be used to sign
in: ``platform.security`` gives it its own JWT ``type``.
"""

from typing import Optional

from fastapi import HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.models.vendor import Vendor, VendorRole
from app.platform.security import decode_dormancy_confirmation_token


class RoleChangeConfirmation(BaseModel):
    """The body accepted by the dedicated role-switch endpoint.

    ``extra="forbid`` matters: a typo in ``confirm_dormant`` must fail loudly
    rather than silently becoming an unconfirmed delisting.
    """

    model_config = ConfigDict(extra="forbid")

    expected_current_role: Optional[VendorRole] = None
    confirm_dormant: bool = False
    confirmation_token: Optional[str] = Field(default=None, max_length=2048)


def role_value(role) -> str:
    """Everything in the API speaks the enum's lowercase value."""
    return role.value if hasattr(role, "value") else str(role)


def current_role_value(vendor: Vendor) -> str:
    return role_value(vendor.current_role)


def assert_role_change_allowed(
    vendor: Vendor,
    requested_role: VendorRole,
    confirmation: Optional[RoleChangeConfirmation] = None,
) -> str:
    """Validate a role change against the database's current row.

    Returns the current role so the router can report the transition. No-op
    changes are allowed without confirmation: they do not delist a business.
    Leaving dormant is also allowed without a token: it restores visibility.
    """

    intent = confirmation or RoleChangeConfirmation()
    current = current_role_value(vendor)
    target = role_value(requested_role)

    if target == current:
        return current

    if intent.expected_current_role is not None and role_value(intent.expected_current_role) != current:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "code": "stale_role",
                "message": "Your operating mode changed. Refresh and choose again.",
                "current_role": current,
                "expected_current_role": role_value(intent.expected_current_role),
            },
        )

    if requested_role != VendorRole.DORMANT:
        return current

    # A client that did not say the words, and a client that did not obtain the
    # server's challenge, are both refused. The endpoint in the detail is
    # deliberately explicit: this is a two-step operation, not a hidden flag.
    if intent.expected_current_role is None or not intent.confirm_dormant:
        raise HTTPException(
            status.HTTP_428_PRECONDITION_REQUIRED,
            {
                "code": "dormancy_confirmation_required",
                "message": (
                    "Going dormant removes this business from discovery. "
                    "Confirm the change and supply the server's confirmation token."
                ),
                "current_role": current,
                "confirmation_endpoint": "/api/vendors/switch-role/dormant/confirmation",
                "required_fields": [
                    "confirm_dormant",
                    "expected_current_role",
                    "confirmation_token",
                ],
            },
        )

    if not decode_dormancy_confirmation_token(
        intent.confirmation_token, vendor.id, current
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "code": "invalid_dormancy_confirmation",
                "message": "That dormancy confirmation is invalid or expired. Confirm again.",
                "current_role": current,
            },
        )

    return current
