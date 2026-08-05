"""Supabase Auth — verify the JWT the client sends and pull out the user id.

The client signs users in with the Supabase publishable key and forwards the
resulting access token as `Authorization: Bearer <jwt>`. Routes depend on
`get_current_user_id` to authenticate the caller and scope queries by user.

Verification is asymmetric-first: tokens signed with an asymmetric "JWT signing
key" (ES256/RS256 — the new Supabase standard) are verified against the project's
JWKS endpoint; tokens still signed with the legacy shared secret (HS256, e.g. the
default local CLI stack) fall back to `SUPABASE_JWT_SECRET`. See `_decode`.

NB (divergence from harmony-fragment's app/utils/auth.py): harmony decodes with
`verify_signature=False` and lets its *user-scoped* Supabase client re-validate
the token at Postgres. This app talks to Supabase only through the service-role
client, which bypasses RLS and does not carry the caller's token — so nothing
downstream would reject a forged JWT. We therefore verify the signature here.
"""

from __future__ import annotations

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientError

from app.core.settings import settings

_bearer = HTTPBearer(auto_error=True)

# Asymmetric algorithms Supabase may sign access tokens with once "JWT signing
# keys" are enabled. Everything else falls back to the shared HS256 secret.
_ASYMMETRIC_ALGS = {
    "RS256", "RS384", "RS512",
    "PS256", "PS384", "PS512",
    "ES256", "ES384", "ES512",
    "EdDSA",
}

# Lazily-built, cache-backed JWKS client (fetches + caches the public keys).
_jwk_client: PyJWKClient | None = None


def _jwks() -> PyJWKClient:
    global _jwk_client
    if _jwk_client is None:
        _jwk_client = PyJWKClient(settings.SUPABASE_JWKS_URL)
    return _jwk_client


def _decode(token: str) -> dict:
    """Verify a Supabase access token, asymmetric-first with HS256 fallback.

    New Supabase projects sign tokens with an asymmetric key (ES256/RS256) whose
    public half is published at the JWKS endpoint. Projects still on the legacy
    shared secret (e.g. the default local CLI stack) sign with HS256. We pick the
    path from the token's own `alg` header.
    """
    alg = jwt.get_unverified_header(token).get("alg", "")
    if alg in _ASYMMETRIC_ALGS:
        signing_key = _jwks().get_signing_key_from_jwt(token).key
        return jwt.decode(
            token,
            signing_key,
            algorithms=sorted(_ASYMMETRIC_ALGS),
            audience="authenticated",
        )
    return jwt.decode(
        token,
        settings.SUPABASE_JWT_SECRET,
        algorithms=["HS256"],
        audience="authenticated",
    )


def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    """FastAPI dependency: verify the Supabase JWT and return auth.users.id.

    Returns the `sub` claim. Raises 401 on a missing/expired/invalid token.
    """
    try:
        claims = _decode(credentials.credentials)
    except (jwt.PyJWTError, PyJWKClientError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
        ) from exc

    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing 'sub' claim",
        )
    return user_id
