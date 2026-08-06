"""OAuth desktop bridge unit checks."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_google_desktop_callback_opens_deep_link() -> None:
    res = client.get(
        "/oauth/google/desktop/callback",
        params={"app_protocol": "yappy-dev", "code": "abc", "state": "s1"},
    )
    assert res.status_code == 200
    assert "yappy-dev://auth/callback?code=abc" in res.text
    assert "state=s1" in res.text


def test_google_desktop_callback_rejects_unknown_protocol() -> None:
    res = client.get(
        "/oauth/google/desktop/callback",
        params={"app_protocol": "evil", "code": "abc"},
    )
    assert res.status_code == 400
