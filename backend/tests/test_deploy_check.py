"""`scripts/check_deploy.py` — the outside-in check an operator runs after a deploy.

It exists because of a specific confusion. Vercel answers a second attempt to set
an existing variable with

    A variable with the name `MEDIA_STORE` already exists for the target production

which reads like a failure and is not one: the *name* is there. What the dashboard
cannot say is **what the value is**, whether the running process picked it up, or
whether a photograph can actually be fetched. A variable created months ago may
hold `local` — the value that discarded every upload from the deployment.

So the script grades the deployment's own `/api/health`, which reports what the
process resolved rather than what the project's settings panel says it should
have. These tests pin the grading: the two real faults must be FAIL, the values
nobody can see in a dashboard must be NOTE, and a requested photo check that did
not happen must never pass by silence.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

from check_deploy import FAIL, NOTE, PASS, inspect_health, verdict  # noqa: E402


def health(**overrides):
    """A healthy production deployment, as `/api/health` now reports itself."""
    payload = {
        "status": "ok",
        "database": True,
        "schema": True,
        "version": "2.2.0",
        "environment": "production",
        "production": True,
        "managed_host": True,
        "media_store": "db",
        "media_durable": True,
        "schema_state": {
            "current": "0030_market_intake",
            "head": "0030_market_intake",
            "stamped": True,
            "pending": [],
            "pending_count": 0,
            "at_head": True,
            "missing_tables": [],
            "drifted": {},
            "reachable": True,
        },
    }
    payload.update(overrides)
    return payload


def levels(rows):
    return [level for level, _, _ in rows]


def titles(rows):
    return " | ".join(title for _, title, _ in rows)


# ── the healthy case, so a pass means something ────────────────────────────


def test_a_correct_deployment_passes_with_no_failures():
    ok, rows = verdict(health())

    assert ok is True
    assert FAIL not in levels(rows)
    assert "photos are stored durably (db)" in titles(rows)
    assert "schema is at 0030_market_intake" in titles(rows)
    # The guard that refuses the shipped SECRET_KEY only arms in production.
    assert any(level == PASS and "production" in title for level, title, _ in rows)


# ── the two faults that started this ───────────────────────────────────────


def test_photos_on_a_discarded_disk_are_a_failure_with_the_value_to_set():
    payload = health(media_store="local", media_durable=False)
    ok, rows = verdict(payload)

    assert ok is False
    failure = next(row for row in rows if row[0] == FAIL)
    assert "local" in failure[1]
    assert "404" in failure[1]
    assert "MEDIA_STORE=db" in failure[2]


def test_a_schema_behind_the_code_names_the_missing_table():
    payload = health(schema=False)
    payload["schema_state"].update(
        current=None, at_head=False, stamped=False, pending_count=30,
        missing_tables=["media_objects"],
    )
    ok, rows = verdict(payload)

    assert ok is False
    assert "media_objects" in titles(rows)
    assert "alembic upgrade head" in " ".join(advice for level, _, advice in rows if level == FAIL)


def test_missing_columns_say_create_all_never_adds_one():
    """The exact misdiagnosis that reported a live vendor as missing."""
    payload = health(schema=False)
    payload["schema_state"].update(drifted={"stock_items": ["brand_line"]}, at_head=False)
    ok, rows = verdict(payload)

    assert ok is False
    assert "stock_items.brand_line" in titles(rows)
    assert "never adds a column" in " ".join(advice for _, _, advice in rows)


def test_an_unreachable_database_stops_the_judgement_there():
    ok, rows = verdict({"database": False, "error": "OperationalError: password authentication failed"})

    assert ok is False
    assert len(rows) == 1
    assert "cannot reach its database" in rows[0][1]
    # The driver's message is passed through — it is the useful part.
    assert "password authentication failed" in rows[0][2]


# ── the values a dashboard cannot show ─────────────────────────────────────


def test_a_stale_ENVIRONMENT_is_noted_not_failed():
    """The app serves; what is missing is the guard on the shipped secret.

    A variable that exists with the value `development` is exactly the trap: the
    name is present, so every "set it" instruction has been satisfied, and
    `is_production` is still False.
    """
    ok, rows = verdict(health(environment="development", production=False))

    assert ok is True, "the deployment is serving; this is a NOTE, not a FAIL"
    note = next(row for row in rows if row[0] == NOTE)
    assert "ENVIRONMENT" in note[1]
    assert "SECRET_KEY" in note[2]


def test_a_complete_but_unstamped_schema_is_a_note_with_the_debt_named():
    payload = health()
    payload["schema_state"].update(current=None, stamped=False, pending_count=30, at_head=False)
    ok, rows = verdict(payload)

    assert ok is True, "tables and columns are right — the app serves"
    assert "not stamped" in titles(rows)
    assert "starting point" in " ".join(advice for _, _, advice in rows)


# ── a photo check that was asked for and did not happen ────────────────────


def test_a_served_photo_passes_and_reports_its_size():
    ok, rows = verdict(health(), photo={
        "ok": True, "path": "/static/uploads/a/b.jpg", "status": 200,
        "bytes": 9292, "content_type": "image/jpeg",
    })

    assert ok is True
    assert "is served (image/jpeg, 9292 bytes)" in titles(rows)


def test_a_404ing_photo_fails_and_says_the_bytes_are_gone():
    ok, rows = verdict(health(), photo={
        "ok": False, "path": "/static/uploads/a/b.jpg", "status": 404, "bytes": 0,
        "content_type": "application/json",
    })

    assert ok is False
    failure = next(row for row in rows if row[0] == FAIL)
    assert "404" in failure[1]
    assert "re-upload" in failure[2]


def test_a_transport_error_on_the_photo_is_a_failure_not_silence():
    ok, rows = verdict(health(), photo={
        "ok": False, "path": "/static/uploads/a/b.jpg", "error": "URLError: timed out",
    })

    assert ok is False
    assert "timed out" in next(row for row in rows if row[0] == FAIL)[1]


def test_html_answering_a_photo_url_is_not_a_photo():
    """A rewritten SPA route answers 200 with index.html for any path.

    `status == 200` alone would call that a served photo; the content type is
    what distinguishes a photograph from a page that happens to load.
    """
    ok, rows = verdict(health(), photo={
        "ok": False, "path": "/static/uploads/a/b.jpg", "status": 200, "bytes": 2100,
        "content_type": "text/html",
    })

    assert ok is False
    assert "not served" in next(row for row in rows if row[0] == FAIL)[1]


# ── argument handling ──────────────────────────────────────────────────────


@pytest.mark.parametrize("argv", [["--help"], []])
def test_the_cli_does_not_crash_on_help_or_no_arguments(argv):
    """`--help` must work without a deployment (it is read before any GET)."""
    import check_deploy

    with pytest.raises(SystemExit):
        check_deploy.main(argv)


# ── the gate has to be in the pipeline, not only in the runbook ─────────────


def test_the_deploy_workflow_runs_the_checker_after_rolling_out():
    """A written-down check that nobody runs is a coincidence away from nothing.

    The container HEALTHCHECK is `curl -fsS /api/health`, which fails only on a
    5xx. `media_store=local` answers 200 with a correct schema and a working app —
    and discards every upload. So the rollout step alone would have passed the
    deployment that lost the photographs.
    """
    import os

    path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "deploy",
        "github-deploy.yml",
    )
    workflow = open(path, encoding="utf-8").read()

    assert "scripts/check_deploy.py" in workflow, "the template does not run the checker"
    assert "http://localhost:8000" in workflow, "it must grade the server it just rolled out"
    # Order matters: a gate that runs before the rollout proves nothing.
    assert workflow.index("docker compose -f docker-compose.prod.yml up -d") < workflow.index(
        "scripts/check_deploy.py"
    )


def test_the_checker_ships_inside_the_backend_image():
    """`COPY backend/ ./` is what puts scripts/ in the container; assert it stays."""
    import os

    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    dockerfile = open(os.path.join(root, "Dockerfile"), encoding="utf-8").read()
    assert "COPY backend/ ." in dockerfile
    assert "python:3.11" in dockerfile, "the gate invokes `python`, which the slim image provides"
    assert os.path.isfile(os.path.join(root, "backend", "scripts", "check_deploy.py"))


# ── which host is answering, and is it the release? ────────────────────────
#
# Two hosts can serve one repository. Vercel previewed every pull request and
# reported green twice a day; the host that actually served the app had not
# deployed since October. A two-week-old build answers `/api/health` with `200`,
# `status: ok`, a schema at head and durable media — every check above passes on
# a release nobody has shipped. The only thing that tells them apart is the
# commit the process was built from.

def test_an_old_but_healthy_build_is_not_the_release():
    ok, rows = verdict(health(commit="2ecfaca9f1", host="railway"),
                       expect_commit="d0595f3")

    assert ok is False
    assert FAIL in levels(rows)
    assert "different build" in titles(rows)
    assert "2ecfaca" in titles(rows) and "d0595f3" in titles(rows)
    advice = " ".join(a for level, _, a in rows if level == FAIL)
    assert "which host actually serves this app" in advice


def test_the_commit_that_answers_is_named_when_it_matches():
    ok, rows = verdict(health(commit="2d2616d" + "0" * 33, host="vercel"),
                       expect_commit="2d2616d")

    assert ok is True
    assert any(level == PASS and "2d2616d" in title and "vercel" in title
               for level, title, _ in rows)


def test_a_short_expectation_matches_a_long_commit_and_the_reverse():
    long_sha = "0123456789abcdef0123456789abcdef01234567"
    for expected in (long_sha, "0123456"):
        ok, rows = verdict(health(commit=long_sha, host="railway"), expect_commit=expected)
        assert ok is True, f"{expected!r} was not matched against {long_sha!r}"


def test_a_build_that_does_not_say_its_commit_fails_the_pin():
    ok, rows = verdict(health(commit="unknown", host="local"), expect_commit="d0595f3")

    assert ok is False
    assert "does not report the commit" in titles(rows)
    assert "--build-arg COMMIT_SHA" in " ".join(a for _, _, a in rows)


def test_without_a_pin_an_unknown_commit_is_only_a_note():
    ok, rows = verdict(health(commit="unknown", host="local"))

    assert ok is True
    assert any(level == NOTE and "does not report its commit" in title
               for level, title, _ in rows)


def test_without_a_pin_a_known_commit_is_reported_with_its_host():
    ok, rows = verdict(health(commit="abcdef1234567", host="railway"))

    assert ok is True
    assert any(level == PASS and "abcdef1 on railway" in title for level, title, _ in rows)


def test_the_platform_and_commit_come_from_the_environment(monkeypatch):
    """`Settings` is a singleton built at import; these read the environment."""
    from app.config import settings

    monkeypatch.delenv("COMMIT_SHA", raising=False)
    monkeypatch.delenv("GIT_SHA", raising=False)
    monkeypatch.delenv("VERCEL_GIT_COMMIT_SHA", raising=False)
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "deadbeef" * 5)
    monkeypatch.setenv("RAILWAY_ENVIRONMENT", "production")
    monkeypatch.delenv("VERCEL", raising=False)

    assert settings.host_name == "railway"
    assert settings.build_commit == "deadbeef" * 5

    monkeypatch.setenv("COMMIT_SHA", "build-arg-wins-0000000000000000000000")
    assert settings.build_commit.startswith("build-arg-wins")

    monkeypatch.delenv("RAILWAY_ENVIRONMENT")
    monkeypatch.delenv("FLY_APP_NAME", raising=False)
    monkeypatch.delenv("K_SERVICE", raising=False)
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.delenv("DYNO", raising=False)
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)
    monkeypatch.delenv("CF_PAGES", raising=False)
    assert settings.host_name == "local"


def test_the_health_endpoint_publishes_the_build_and_the_platform():
    """A deploy gate is worthless if the payload it grades cannot name the build."""
    source = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                               "app", "main.py"), encoding="utf-8").read()
    assert '"commit": settings.build_commit' in source
    assert '"host": settings.host_name' in source


def test_the_deploy_gate_pins_the_rollout_to_the_commit_being_shipped():
    workflow = open(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__)))), "deploy", "github-deploy.yml"), encoding="utf-8").read()

    assert "--expect-commit" in workflow
    assert "COMMIT_SHA=${{ github.sha }}" in workflow
