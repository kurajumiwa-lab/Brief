"""MarketTrust service catalogue: the only place to add, remove or re-price services.

Points are rewards, not money. They cannot be withdrawn, transferred or paid out.
They can only be exchanged for a service listed here.

Rules:
  · SERVICES is empty until the catalogue is agreed.
  · CATALOGUE_APPROVED must also be True before anything can be exchanged. Until
    then every exchange is refused, even if a service is listed.
  · To add a service: add an entry to SERVICES. To remove one: delete the entry.
    To change a price: edit points_cost. No other code changes are needed.

Entry shape:
    "service_key": {
        "title": "What the customer sees",
        "points_cost": 40,              # whole points, must be > 0
        "countries": ["KE", "ET", "UG"] # any of these three
    }
"""

CATALOGUE_APPROVED: bool = False

SERVICES: dict = {}
