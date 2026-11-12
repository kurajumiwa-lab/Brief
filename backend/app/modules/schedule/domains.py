"""Service domains (service-providers plan, Phase 6).

A provider may tag a service with one domain. The field is optional and additive. A service with
no domain stays valid and shows no domain. These six values are the only ones the API accepts.
"""

from typing import Literal, Optional, get_args

ServiceDomain = Literal[
    "healthcare_care",
    "trades_technical",
    "personal_care_beauty",
    "logistics_delivery",
    "market_retail",
    "other_services",
]

SERVICE_DOMAIN_KEYS: tuple = get_args(ServiceDomain)

SERVICE_DOMAIN_LABELS: dict = {
    "healthcare_care": "Healthcare & Care",
    "trades_technical": "Trades & Technical",
    "personal_care_beauty": "Personal Care & Beauty",
    "logistics_delivery": "Logistics & Delivery",
    "market_retail": "Market & Retail Support",
    "other_services": "Other Services",
}


def check_domain(value: Optional[str]) -> Optional[str]:
    """None clears the domain. Anything else must be one of the six keys."""
    if value is None:
        return None
    if value not in SERVICE_DOMAIN_KEYS:
        raise ValueError("Choose a service domain from the list.")
    return value
