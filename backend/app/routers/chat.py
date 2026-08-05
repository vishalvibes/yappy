"""Chat / inference routes — thin wrapper over the OpenAI helpers.

Two surfaces, both auth-gated by the same verified Supabase JWT as the rest of
the app:

- ``POST /inference``   one-shot completion from a single prompt (the simplest
  possible "does the LLM work" call).
- ``POST /chat``        multi-turn chat, returns the whole reply at once.
- ``POST /chat/stream`` the same multi-turn chat as Server-Sent Events.

Nothing here touches the database — it is a pure passthrough to
``app/utils/llm.py`` so Yappy shows the wiring, not a domain model.
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel

from app.core.auth import get_current_user_id
from app.utils.llm import create_chat_completion, stream_chat_completion

router = APIRouter(tags=["chat"])

_MAX_TOKENS = 2000


# --- models ------------------------------------------------------------------
class ChatMessage(BaseModel):
    role: str  # "system" | "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


class ChatResponse(BaseModel):
    reply: str


class InferenceRequest(BaseModel):
    prompt: str
    system: str | None = None
    temperature: float = 1


class InferenceResponse(BaseModel):
    output: str
    model: str


# --- routes ------------------------------------------------------------------
@router.post("/inference")
async def inference(
    body: InferenceRequest,
    _user_id: str = Depends(get_current_user_id),
) -> InferenceResponse:
    """Basic inference: one prompt in, one completion out."""
    if not body.prompt.strip():
        raise HTTPException(status_code=400, detail="prompt is empty")

    messages: list[dict] = []
    if body.system:
        messages.append({"role": "system", "content": body.system})
    messages.append({"role": "user", "content": body.prompt})

    completion = await _complete(messages, temperature=body.temperature)
    return InferenceResponse(
        output=completion.choices[0].message.content or "",
        model=completion.model,
    )


@router.post("/chat")
async def chat(
    body: ChatRequest,
    _user_id: str = Depends(get_current_user_id),
) -> ChatResponse:
    """Multi-turn chat, buffered — the full reply lands in one response."""
    messages = _serialize(body)
    completion = await _complete(messages)
    return ChatResponse(reply=completion.choices[0].message.content or "")


@router.post("/chat/stream")
async def chat_stream(
    body: ChatRequest,
    _user_id: str = Depends(get_current_user_id),
) -> StreamingResponse:
    """Streaming counterpart to POST /chat — Server-Sent Events.

    Emits the house event contract (response.created / llm.response.init /
    llm.response deltas / llm.response.done / response.completed). Errors
    surface as an ``{"error": ...}`` frame mid-stream, since the status line is
    already 200 by the time streaming starts.
    """
    messages = _serialize(body)

    async def generate():
        try:
            async for frame in stream_chat_completion(
                messages, max_tokens=_MAX_TOKENS
            ):
                yield frame
        except Exception as e:
            logger.error(f"OpenAI chat stream failed: {type(e).__name__}: {e}")
            yield 'data: {"error": "LLM stream failed"}\n\n'

    return StreamingResponse(generate(), media_type="text/event-stream")


# --- helpers -----------------------------------------------------------------
def _serialize(body: ChatRequest) -> list[dict]:
    if not body.messages:
        raise HTTPException(status_code=400, detail="messages is empty")
    return [m.model_dump() for m in body.messages]


async def _complete(messages: list[dict], temperature: float = 1):
    """Call the LLM, mapping provider failures to a 502.

    Generous token budget on purpose — reasoning models spend completion tokens
    on reasoning first, so a small cap yields empty content.
    """
    try:
        return await create_chat_completion(
            messages=messages,
            temperature=temperature,
            max_tokens=_MAX_TOKENS,
        )
    except RuntimeError as e:
        # Raised by get_openai_client() when OpenAI is not configured.
        logger.warning(f"LLM not configured: {e}")
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.error(f"OpenAI chat completion failed: {type(e).__name__}: {e}")
        raise HTTPException(status_code=502, detail="LLM call failed") from e
