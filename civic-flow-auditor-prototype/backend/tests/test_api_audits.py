from fastapi.testclient import TestClient
import pytest

from app.config import settings
from app.main import create_app
from app.schemas import build_deterministic_summary


@pytest.fixture
def temp_database(request, tmp_path):
    import app.repository as repository

    original_database_url = settings.database_url
    original_engine = repository._engine
    db_path = tmp_path / "nested" / "audits.sqlite"
    object.__setattr__(settings, "database_url", f"sqlite:///{db_path.as_posix()}")
    repository._engine = None

    def restore():
        if repository._engine is not None:
            repository._engine.dispose()
        repository._engine = original_engine
        object.__setattr__(settings, "database_url", original_database_url)

    request.addfinalizer(restore)
    return db_path


def test_create_audit_creates_sqlite_parent_directory(temp_database):
    from app.repository import create_stored_audit_run

    run = create_stored_audit_run("abc123", "https://example.com", "standard")

    assert run.id == "abc123"
    assert temp_database.exists()


def test_create_audit_returns_json_when_queue_broker_is_unavailable(monkeypatch, temp_database):
    import app.agents.orchestrator as orchestrator
    import app.api.audits as audits_api
    import app.worker as worker
    from app.repository import load_audit_run, save_audit_run

    class FailingTask:
        def delay(self, audit_id):
            raise RuntimeError("broker unavailable")

    class ImmediateThread:
        def __init__(self, target, **_kwargs):
            self.target = target

        def start(self):
            self.target()

    def fake_run_audit(audit_id):
        run = load_audit_run(audit_id)
        run.status = "report-ready"
        run.progress = 100
        run.executiveSummary = build_deterministic_summary(run)
        return save_audit_run(run)

    monkeypatch.setattr(worker, "run_audit_task", FailingTask())
    monkeypatch.setattr(audits_api.threading, "Thread", ImmediateThread)
    monkeypatch.setattr(orchestrator, "run_audit", fake_run_audit)

    client = TestClient(create_app(), raise_server_exceptions=False)
    response = client.post("/api/audits", json={"url": "https://example.com/", "depth": "standard"})
    payload = response.json()

    assert response.status_code == 202
    assert response.headers["content-type"].startswith("application/json")
    assert payload["url"] == "https://example.com/"
    assert load_audit_run(payload["id"]).status == "report-ready"
