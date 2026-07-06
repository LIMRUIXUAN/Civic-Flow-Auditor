from app.security import validate_public_url


def test_validate_public_url_adds_https():
    result = validate_public_url("example.com")
    assert result.ok
    assert result.url == "https://example.com"


def test_validate_public_url_blocks_non_http():
    result = validate_public_url("file:///etc/passwd")
    assert not result.ok