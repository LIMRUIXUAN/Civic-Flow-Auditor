from app.schemas import create_audit_run_base, build_deterministic_summary


def test_audit_run_contract_defaults():
    run = create_audit_run_base("abc123", "https://example.com", "standard")
    payload = run.model_dump(mode="json")
    assert payload["id"] == "abc123"
    assert payload["status"] == "idle"
    assert payload["artifacts"]["screenshots"] == []
    assert "legal certification" in " ".join(payload["safetyNotes"])


def test_deterministic_summary_mentions_review_limit():
    run = create_audit_run_base("abc123", "https://example.com", "standard")
    assert "not legal certification" in build_deterministic_summary(run)