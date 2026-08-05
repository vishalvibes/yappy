"""Inngest client factory.

Single process-wide Inngest client used to send events and register durable
background functions. Mirrors the harmony house style: the Inngest SDK expects a
stdlib ``logging.Logger`` (not loguru), and production vs. dev-server mode is
driven by ``INNGEST_IS_PRODUCTION``.

Local/dev: the SDK syncs with the Inngest Dev Server (`make inngest`,
http://localhost:8288). Production: reads INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY
straight from the environment.
"""

import logging
import os

import inngest

logger = logging.getLogger("uvicorn.inngest")
logger.setLevel(logging.ERROR)

# Default to non-production (dev-server) mode for safety.
is_production = os.getenv("INNGEST_IS_PRODUCTION", "false").lower() == "true"

inngest_client = inngest.Inngest(
    app_id="yappy-backend",
    logger=logger,
    is_production=is_production,
)
