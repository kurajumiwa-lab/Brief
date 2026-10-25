"""Production must not run on secrets that are published in this repository.

Both defaults are public: `SECRET_KEY` signs every login token, `PSP_WEBHOOK_SECRET`
authenticates payment callbacks. Before the guard, a forged token signed with the
default authenticated as any vendor (audit 2026-10-25, G-01), and a forged webhook
body passed signature verification (G-02).

These tests pin the guard and re-run the token forgery to prove it now fails.

They construct `Settings(...)` instances directly rather than reloading `app.config`:
a reload would replace the module-level settings object while every other module
still holds the old reference, which makes unrelated tests fail in file order.
"""

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from app import config as config_module
from app.config import Settings


def _settings(**overrides) -> Settings:
    """A settings instance with an explicit environment (never reads the caller's)."""
    base = {
        "DATABASE_URL": config_module.settings.DATABASE_URL,
        "ENVIRONMENT": "development",
        "SECRET_KEY": config_module.DEFAULT_SECRET_KEY,
        "PSP_WEBHOOK_SECRET": config_module.DEFAULT_PSP_WEBHOOK_SECRET,
        "PSP_PROVIDER": "mock",
    }
    base.update(overrides)
    return Settings(**base)


def test_development_may_use_the_defaults():
    assert _settings().SECRET_KEY == config_module.DEFAULT_SECRET_KEY


def test_production_refuses_the_default_secret_key():
    with pytest.raises(RuntimeError) as err:
        _settings(ENVIRONMENT="production")
    assert "SECRET_KEY" in str(err.value)


def test_production_refuses_a_short_secret_key():
    with pytest.raises(RuntimeError) as err:
        _settings(ENVIRONMENT="production", SECRET_KEY="too-short")
    assert "SECRET_KEY" in str(err.value)


def test_production_accepts_a_strong_secret_key():
    assert _settings(ENVIRONMENT="production", SECRET_KEY="a" * 64).is_production


def test_production_refuses_the_default_webhook_secret_with_a_real_psp():
    with pytest.raises(RuntimeError) as err:
        _settings(ENVIRONMENT="production", SECRET_KEY="a" * 64, PSP_PROVIDER="intasend")
    assert "PSP_WEBHOOK_SECRET" in str(err.value)


def test_production_allows_the_default_webhook_secret_while_payments_are_mock():
    """A production deploy mid-migration is not blocked: it already cannot move money."""
    assert _settings(ENVIRONMENT="production", SECRET_KEY="a" * 64).PSP_PROVIDER == "mock"


def test_production_accepts_private_secrets():
    cfg = _settings(ENVIRONMENT="production", SECRET_KEY="a" * 64,
                    PSP_PROVIDER="intasend", PSP_WEBHOOK_SECRET="b" * 64)
    assert cfg.is_production


def test_forged_token_is_rejected_once_the_secret_is_private(monkeypatch):
    """G-01 regression: a token signed with the public default must not authenticate.

    The live settings object is patched rather than the module reloaded: everything
    that says `from app.config import settings` holds that same instance, so the
    assertion exercises the real auth path regardless of module import order.
    """
    monkeypatch.setattr(config_module.settings, "SECRET_KEY", "b" * 64)
    from app.main import app  # imported after the patch so the token code sees it

    with TestClient(app) as client:
        registered = client.post("/api/auth/register", json={
            "account_kind": "person",
            "display_name": "Victim User",
            "business_name": "Victim User",
            "vendor_handle": "victim_user",
            "email": "victim@example.com",
            "password": "Password1",
        })
        assert registered.status_code == 201, registered.text
        victim_id = registered.json()["vendor_id"]

        forged = jwt.encode(
            {"sub": victim_id, "exp": 4102444800, "type": "access"},
            config_module.DEFAULT_SECRET_KEY,
            algorithm="HS256",
        )
        response = client.get("/api/vendors/me", headers={"Authorization": f"Bearer {forged}"})
        assert response.status_code == 401, response.text

        # The genuine token still works — the guard must not break normal sign-in.
        genuine = registered.json()["access_token"]
        me = client.get("/api/vendors/me", headers={"Authorization": f"Bearer {genuine}"})
        assert me.status_code == 200
        assert me.json()["vendor_handle"] == "victim_user"


def test_forged_webhook_is_rejected_once_the_secret_is_private(monkeypatch):
    """G-02 regression: a body signed with the public default must not pass the gate."""
    import hashlib
    import hmac
    import json

    monkeypatch.setattr(config_module.settings, "SECRET_KEY", "b" * 64)
    monkeypatch.setattr(config_module.settings, "PSP_WEBHOOK_SECRET", "c" * 64)
    from app.main import app

    body = json.dumps({
        "event": "payment.completed",
        "reference": "forged-" + "0" * 8,
        "amount": 999999,
        "state": "completed",
    }).encode()
    forged = hmac.new(config_module.DEFAULT_PSP_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()

    with TestClient(app) as client:
        r = client.post("/api/payments/webhook", content=body,
                        headers={"X-Webhook-Signature": forged,
                                 "Content-Type": "application/json"})
        assert r.status_code == 401, r.text
        assert "signature" in r.json()["detail"].lower()

        # A correctly signed body still reaches the handler (it answers 502 when
        # the reference is unknown, which means the signature gate let it through).
        good = hmac.new(b"c" * 64, body, hashlib.sha256).hexdigest()
        r = client.post("/api/payments/webhook", content=body,
                        headers={"X-Webhook-Signature": good,
                                 "Content-Type": "application/json"})
        assert r.status_code != 401, r.text
