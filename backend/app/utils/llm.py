"""OpenAI inference helpers.

Two entry points over the Chat Completions API — one buffered, one streamed —
sharing the client built in app/clients/llm_clients.py. `model` defaults to
settings.OPENAI_MODEL.
"""

import json
from typing import Any, AsyncGenerator, List, Optional

from app.clients.llm_clients import get_openai_client
from app.core.settings import settings


async def create_chat_completion(
    messages: List[dict],
    model: Optional[str] = None,
    temperature: float = 1,
    max_tokens: Optional[int] = None,
    tools: Optional[List[dict]] = None,
    tool_choice: Optional[Any] = None,
    response_format: Optional[dict] = None,
    reasoning_effort: Optional[str] = None,
) -> Any:
    """Create a chat completion.

    Returns the raw OpenAI SDK ChatCompletion; read
    `.choices[0].message.content`.
    """
    client = get_openai_client()

    params: dict = {
        "model": model or settings.OPENAI_MODEL,
        "messages": messages,
        "temperature": temperature,
    }
    if max_tokens is not None:
        params["max_completion_tokens"] = max_tokens
    if tools is not None:
        params["tools"] = tools
    if tool_choice is not None:
        params["tool_choice"] = tool_choice
    if response_format is not None:
        params["response_format"] = response_format
    if reasoning_effort is not None:
        params["reasoning_effort"] = reasoning_effort

    return await client.chat.completions.create(**params)


def _sse(data: dict) -> str:
    """Format one SSE frame."""
    return f"data: {json.dumps(data)}\n\n"


async def stream_chat_completion(
    messages: List[dict],
    model: Optional[str] = None,
    temperature: float = 1,
    max_tokens: Optional[int] = None,
) -> AsyncGenerator[str, None]:
    """Stream a chat completion as SSE frames.

    Emits the event contract SSE clients consume:

        {"type": "response.created"}
        {"type": "llm.response.init"}
        {"type": "llm.response", "content": "<delta>"}   (repeated)
        {"type": "llm.response.done"}
        {"type": "response.completed"}                    (terminator)
    """
    client = get_openai_client()

    params: dict = {
        "model": model or settings.OPENAI_MODEL,
        "messages": messages,
        "temperature": temperature,
        "stream": True,
    }
    if max_tokens is not None:
        params["max_completion_tokens"] = max_tokens

    yield _sse({"type": "response.created"})

    stream = await client.chat.completions.create(**params)
    started = False
    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta.content
        if not delta:
            continue
        if not started:
            yield _sse({"type": "llm.response.init"})
            started = True
        yield _sse({"type": "llm.response", "content": delta})

    yield _sse({"type": "llm.response.done"})
    yield _sse({"type": "response.completed"})
