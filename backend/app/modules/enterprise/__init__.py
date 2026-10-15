"""Enterprise workspaces — the paid, private side of the platform (v2.13).

The public marketplace already exists (vendors, stock, requests, orders,
the map). This module adds the second half of the dual model without a
second app: an organisation (trade association, cooperative, employer,
county programme) buys a workspace *inside* Brief_, registers its members
and field officers, keeps a register of managed Android devices, and —
once its own Android Enterprise / EMM is bound — requests remote actions
whose dispatch state is reported honestly.

Public interface:

    from app.modules.enterprise import service, rules
    rules.WORKSPACE_PLANS          # KSh pricing + server-side caps
    rules.COMMAND_MATRIX           # enrolment mode → allowed commands
"""

from app.modules.enterprise import models, router, rules, service  # noqa: F401

__all__ = ["models", "router", "rules", "service"]
