"""Application settings.

Plain os.getenv-backed settings class (matches the harmony house style — no
pydantic-settings). Every value has a sensible local-dev default so the app
boots against a local Supabase stack out of the box.
"""

import os


def _bool_env(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).lower() == "true"


class Settings:
    # --- App -----------------------------------------------------------------
    APP_NAME: str = os.getenv("APP_NAME", "yappy-backend")
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "local")  # local | staging | production
    PORT: int = int(os.getenv("PORT", "8000"))
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")

    # --- CORS ----------------------------------------------------------------
    # Comma-separated list of allowed origins (Electron Vite / web clients).
    CORS_ORIGINS: list[str] = [
        o.strip()
        for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
        if o.strip()
    ]

    # --- Supabase ------------------------------------------------------------
    # URL/keys are read directly from the environment by the client factories
    # in app/clients/supabase.py; kept here too for convenient access/logging.
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "http://127.0.0.1:54321")

    # Server-side key (full access, bypasses RLS). New Supabase standard: the
    # "secret key" (sb_secret_...), which replaces the legacy service_role JWT.
    # The legacy var is accepted as a fallback during migration.
    SUPABASE_SECRET_KEY: str = os.getenv("SUPABASE_SECRET_KEY") or os.getenv(
        "SUPABASE_SERVICE_ROLE_KEY", ""
    )
    # Deprecated alias, kept for backward compatibility.
    SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

    # --- Frontend-facing JWT verification ------------------------------------
    # New standard: asymmetric signing keys (ES256/RS256), verified via the JWKS
    # discovery endpoint (derived from SUPABASE_URL unless overridden).
    SUPABASE_JWKS_URL: str = os.getenv(
        "SUPABASE_JWKS_URL",
        f"{os.getenv('SUPABASE_URL', 'http://127.0.0.1:54321')}"
        "/auth/v1/.well-known/jwks.json",
    )
    # Fallback HS256 shared secret, used only when a token is HS256-signed (e.g.
    # the default local CLI stack, which has no asymmetric keys yet). Printed by
    # `make status` as "JWT secret"; the value below is the CLI's well-known
    # local-dev default (do NOT use in production).
    SUPABASE_JWT_SECRET: str = os.getenv(
        "SUPABASE_JWT_SECRET",
        "super-secret-jwt-token-with-at-least-32-characters-long",
    )

    # Shared httpx connection-pool limits for the Supabase clients.
    SUPABASE_POOL_MAX_CONNECTIONS: int = int(
        os.getenv("SUPABASE_POOL_MAX_CONNECTIONS", "100")
    )
    SUPABASE_POOL_MAX_KEEPALIVE: int = int(
        os.getenv("SUPABASE_POOL_MAX_KEEPALIVE", "20")
    )
    SUPABASE_TIMEOUT_SECONDS: float = float(os.getenv("SUPABASE_TIMEOUT_SECONDS", "30"))

    # --- OpenAI --------------------------------------------------------------
    # Client is built in app/clients/llm_clients.py only when OPENAI_ENABLED is
    # true and a key is present; the chat/inference routes 503 until then.
    OPENAI_ENABLED: bool = _bool_env("OPENAI_ENABLED")
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    # Optional. Set to talk to any OpenAI-compatible gateway (Azure's /v1
    # endpoint, OpenRouter, a local server); empty → api.openai.com.
    OPENAI_BASE_URL: str = os.getenv("OPENAI_BASE_URL", "")
    OPENAI_ORG_ID: str = os.getenv("OPENAI_ORG_ID", "")
    # Default model for the chat + inference helpers. The GPT-5.6 family
    # (released 2026-07-09) is three tiers of the same generation:
    #   gpt-5.6-sol    flagship reasoning   $5 / $30 per 1M tokens
    #   gpt-5.6-terra  balanced default     $2.50 / $15
    #   gpt-5.6-luna   fast + cheapest      $1 / $6
    # `gpt-5.6` is an alias for Sol. All three: 1M context, 128k max output.
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-5.6-terra")
    # Fast tier for judge / vision / template helpers (not generate/rewrite).
    OPENAI_MODEL_FAST: str = os.getenv("OPENAI_MODEL_FAST", "gpt-5.6-luna")
    # When true, generate/rewrite use an extra LLM call to order drafts.
    # Default off — heuristic sort is enough and saves a full RTT.
    YAPS_LLM_RANK: bool = _bool_env("YAPS_LLM_RANK")

    # --- Web research (Tavily) -----------------------------------------------
    # LLM-native web search. Empty key → the search layer falls back to ddgs.
    TAVILY_API_KEY: str = os.getenv("TAVILY_API_KEY", "")

    # --- Sarvam (Speech-to-Text) ---------------------------------------------
    # Powers POST /yaps background transcription. Empty → /yaps returns 503.
    SARVAM_API_KEY: str = os.getenv("SARVAM_API_KEY", "")

    # --- Flags ---------------------------------------------------------------
    TESTING: bool = _bool_env("TESTING")


settings = Settings()
