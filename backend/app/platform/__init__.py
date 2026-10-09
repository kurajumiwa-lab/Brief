"""platform — infrastructure that serves every module, and nothing else.

Rules of this package:
    · NO business rules. Business logic lives in app/modules/*.
    · NO imports from app.routes or app.modules (identity models will land
      here properly in the identity wave; until then routes/auth.py owns
      the vendor lookup and platform owns only the token mechanics).
    · Everything here is safe to call from routers, services and jobs.
"""
