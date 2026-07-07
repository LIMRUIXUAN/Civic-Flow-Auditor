import pytest

from app.config import settings


@pytest.fixture
def temp_database(request, tmp_path):
    """Isolate each test on its own SQLite file and artifact storage dir."""
    import app.repository as repository

    original_database_url = settings.database_url
    original_storage = settings.audit_storage_dir
    original_engine = repository._engine

    db_path = tmp_path / "nested" / "audits.sqlite"
    storage_dir = tmp_path / "artifacts"
    object.__setattr__(settings, "database_url", f"sqlite:///{db_path.as_posix()}")
    object.__setattr__(settings, "audit_storage_dir", storage_dir.resolve())
    repository._engine = None

    def restore():
        if repository._engine is not None:
            repository._engine.dispose()
        repository._engine = original_engine
        object.__setattr__(settings, "database_url", original_database_url)
        object.__setattr__(settings, "audit_storage_dir", original_storage)

    request.addfinalizer(restore)
    return db_path
