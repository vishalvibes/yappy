"""Sarvam Speech-to-Text client.

Short yaps use the Batch STT job API with speaker diarization
(`with_diarization=True`). Diarization is Batch-only — the sync REST
endpoint does not support it.

Docs:
  https://docs.sarvam.ai/api-reference-docs/api-guides-tutorials/speech-to-text/batch-api
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

import httpx
from loguru import logger

from app.core.settings import settings

_SARVAM_BASE = "https://api.sarvam.ai"
_JOB_BASE = f"{_SARVAM_BASE}/speech-to-text/job/v1"
_DEFAULT_MODEL = "saaras:v3"
_DEFAULT_MODE = "transcribe"
_TIMEOUT_S = 90.0
_POLL_INTERVAL_S = 2.0
_POLL_TIMEOUT_S = 75.0


class SarvamError(RuntimeError):
    """Raised when Sarvam STT fails or is misconfigured."""


@dataclass(frozen=True)
class DiarizedSegment:
    speaker_id: str
    transcript: str
    start_time_seconds: float | None = None
    end_time_seconds: float | None = None


@dataclass(frozen=True)
class TranscriptionResult:
    """Full STT result, optionally split into user comment vs audio reference."""

    transcript: str
    language_code: str | None
    segments: tuple[DiarizedSegment, ...] = ()
    # User's yap / opinion (one speaker when diarized; full text when single).
    user_speech: str = ""
    # Other voices in the mic (video audio, interlocutor) — reference only.
    reference_speech: str | None = None


def _normalize_content_type(content_type: str) -> str:
    """Sarvam rejects parameterized MIME types like audio/webm;codecs=opus."""
    base = (content_type or "audio/webm").split(";", 1)[0].strip().lower()
    return base or "audio/webm"


def _auth_headers(key: str) -> dict[str, str]:
    return {"api-subscription-key": key}


def _split_user_and_reference(
    segments: list[DiarizedSegment],
    full_transcript: str,
) -> tuple[str, str | None]:
    """Decide which diarized speaker is the user.

    Heuristic: speakers ordered by first appearance. With one speaker, all
    words are the user's comment. With 2+, the *last* speaker to enter is
    treated as the user (commenting / reacting); earlier speakers are audio
    reference (video bleed, other person in conversation).
    """
    if not segments:
        text = full_transcript.strip()
        return text, None

    order: list[str] = []
    seen: set[str] = set()
    for seg in segments:
        sid = seg.speaker_id
        if sid not in seen:
            seen.add(sid)
            order.append(sid)

    if len(order) <= 1:
        joined = " ".join(s.transcript.strip() for s in segments if s.transcript.strip())
        return (joined or full_transcript).strip(), None

    user_id = order[-1]
    user_parts = [
        s.transcript.strip()
        for s in segments
        if s.speaker_id == user_id and s.transcript.strip()
    ]
    ref_parts = [
        s.transcript.strip()
        for s in segments
        if s.speaker_id != user_id and s.transcript.strip()
    ]
    user_text = " ".join(user_parts).strip() or full_transcript.strip()
    ref_text = " ".join(ref_parts).strip() or None
    return user_text, ref_text


def _parse_diarized_entries(body: dict) -> list[DiarizedSegment]:
    raw = body.get("diarized_transcript") or {}
    entries = raw.get("entries") if isinstance(raw, dict) else None
    if not isinstance(entries, list):
        return []

    out: list[DiarizedSegment] = []
    for item in entries:
        if not isinstance(item, dict):
            continue
        text = (item.get("transcript") or "").strip()
        speaker = item.get("speaker_id")
        if not text or speaker is None:
            continue
        out.append(
            DiarizedSegment(
                speaker_id=str(speaker),
                transcript=text,
                start_time_seconds=_as_float(item.get("start_time_seconds")),
                end_time_seconds=_as_float(item.get("end_time_seconds")),
            )
        )
    return out


def _as_float(value: object) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _result_from_body(body: dict) -> TranscriptionResult:
    transcript = (body.get("transcript") or "").strip()
    if not transcript:
        raise SarvamError("Sarvam returned an empty transcript")
    language_code = body.get("language_code")
    segments = _parse_diarized_entries(body)
    user_speech, reference_speech = _split_user_and_reference(segments, transcript)
    return TranscriptionResult(
        transcript=transcript,
        language_code=language_code if isinstance(language_code, str) else None,
        segments=tuple(segments),
        user_speech=user_speech,
        reference_speech=reference_speech,
    )


async def _put_upload(client: httpx.AsyncClient, url: str, audio: bytes, mime: str) -> None:
    res = await client.put(url, content=audio, headers={"Content-Type": mime})
    if res.status_code >= 400:
        logger.error(f"Sarvam upload PUT {res.status_code}: {res.text[:300]}")
        raise SarvamError(f"Sarvam upload failed ({res.status_code})")


async def _transcribe_batch_diarized(
    client: httpx.AsyncClient,
    *,
    key: str,
    audio: bytes,
    filename: str,
    mime: str,
) -> TranscriptionResult:
    headers = _auth_headers(key)

    init = await client.post(
        _JOB_BASE,
        headers=headers,
        json={
            "job_parameters": {
                "model": _DEFAULT_MODEL,
                "mode": _DEFAULT_MODE,
                "language_code": "unknown",
                "with_diarization": True,
                "num_speakers": 2,
            }
        },
    )
    if init.status_code not in (200, 202):
        logger.error(f"Sarvam job init {init.status_code}: {init.text[:500]}")
        raise SarvamError(f"Sarvam job init failed ({init.status_code})")

    job_id = (init.json() or {}).get("job_id")
    if not job_id:
        raise SarvamError("Sarvam job init missing job_id")

    upload_links = await client.post(
        f"{_JOB_BASE}/upload-files",
        headers=headers,
        json={"job_id": job_id, "files": [filename]},
    )
    if upload_links.status_code != 200:
        logger.error(
            f"Sarvam upload-files {upload_links.status_code}: {upload_links.text[:500]}"
        )
        raise SarvamError(f"Sarvam upload-files failed ({upload_links.status_code})")

    upload_urls = (upload_links.json() or {}).get("upload_urls") or {}
    # upload_urls is typically {filename: {file_url: ...}} or similar.
    entry = upload_urls.get(filename)
    if entry is None and isinstance(upload_urls, dict) and len(upload_urls) == 1:
        entry = next(iter(upload_urls.values()))
    file_url = None
    if isinstance(entry, dict):
        file_url = entry.get("file_url") or entry.get("url")
    elif isinstance(entry, str):
        file_url = entry
    if not file_url:
        raise SarvamError("Sarvam upload-files missing file_url")

    await _put_upload(client, file_url, audio, mime)

    start = await client.post(f"{_JOB_BASE}/{job_id}/start", headers=headers)
    if start.status_code >= 400:
        logger.error(f"Sarvam job start {start.status_code}: {start.text[:500]}")
        raise SarvamError(f"Sarvam job start failed ({start.status_code})")

    deadline = asyncio.get_running_loop().time() + _POLL_TIMEOUT_S
    status_body: dict = {}
    while True:
        status = await client.get(f"{_JOB_BASE}/{job_id}/status", headers=headers)
        if status.status_code != 200:
            logger.error(f"Sarvam job status {status.status_code}: {status.text[:500]}")
            raise SarvamError(f"Sarvam job status failed ({status.status_code})")
        status_body = status.json() or {}
        state = (status_body.get("job_state") or "").strip()
        if state == "Completed":
            break
        if state == "Failed":
            raise SarvamError(
                status_body.get("error_message") or "Sarvam job failed"
            )
        if asyncio.get_running_loop().time() >= deadline:
            raise SarvamError("Sarvam job timed out")
        await asyncio.sleep(_POLL_INTERVAL_S)

    output_names: list[str] = []
    for detail in status_body.get("job_details") or []:
        if not isinstance(detail, dict):
            continue
        for out in detail.get("outputs") or []:
            if isinstance(out, dict) and out.get("file_name"):
                output_names.append(str(out["file_name"]))
    if not output_names:
        output_names = ["0.json"]

    download = await client.post(
        f"{_JOB_BASE}/download-files",
        headers=headers,
        json={"job_id": job_id, "files": output_names},
    )
    if download.status_code != 200:
        logger.error(
            f"Sarvam download-files {download.status_code}: {download.text[:500]}"
        )
        raise SarvamError(f"Sarvam download-files failed ({download.status_code})")

    download_urls = (download.json() or {}).get("download_urls") or {}
    first_name = output_names[0]
    dl_entry = download_urls.get(first_name)
    if dl_entry is None and isinstance(download_urls, dict) and len(download_urls) == 1:
        dl_entry = next(iter(download_urls.values()))
    dl_url = None
    if isinstance(dl_entry, dict):
        dl_url = dl_entry.get("file_url") or dl_entry.get("url")
    elif isinstance(dl_entry, str):
        dl_url = dl_entry
    if not dl_url:
        raise SarvamError("Sarvam download-files missing file_url")

    result_res = await client.get(dl_url)
    if result_res.status_code != 200:
        raise SarvamError(f"Sarvam result download failed ({result_res.status_code})")
    body = result_res.json()
    if not isinstance(body, dict):
        raise SarvamError("Sarvam result was not a JSON object")
    return _result_from_body(body)


async def _transcribe_rest_fallback(
    client: httpx.AsyncClient,
    *,
    key: str,
    audio: bytes,
    filename: str,
    mime: str,
) -> TranscriptionResult:
    """Sync REST — no diarization. Used if the batch job path fails."""
    res = await client.post(
        f"{_SARVAM_BASE}/speech-to-text",
        headers=_auth_headers(key),
        files={"file": (filename, audio, mime)},
        data={
            "model": _DEFAULT_MODEL,
            "mode": _DEFAULT_MODE,
            "language_code": "unknown",
        },
    )
    if res.status_code != 200:
        logger.error(f"Sarvam STT REST {res.status_code}: {res.text[:500]}")
        raise SarvamError(f"Sarvam STT failed ({res.status_code})")
    body = res.json()
    if not isinstance(body, dict):
        raise SarvamError("Sarvam REST result was not a JSON object")
    return _result_from_body(body)


async def transcribe_audio(
    audio: bytes,
    *,
    filename: str = "yap.webm",
    content_type: str = "audio/webm",
    diarize: bool = True,
) -> TranscriptionResult:
    """Transcribe audio.

    diarize=True (default): batch job with speaker split; REST fallback.
    diarize=False: REST only — faster when speaker split is not needed
    (e.g. rewrite feedback is a single user voice).
    """
    key = settings.SARVAM_API_KEY
    if not key:
        raise SarvamError("SARVAM_API_KEY is not configured")

    mime = _normalize_content_type(content_type)
    # Keep a simple basename for upload_urls keying.
    safe_name = filename.rsplit("/", 1)[-1] or "yap.webm"

    async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
        if not diarize:
            return await _transcribe_rest_fallback(
                client, key=key, audio=audio, filename=safe_name, mime=mime
            )
        try:
            return await _transcribe_batch_diarized(
                client, key=key, audio=audio, filename=safe_name, mime=mime
            )
        except SarvamError as e:
            logger.warning(f"Sarvam batch diarization failed, REST fallback: {e}")
            return await _transcribe_rest_fallback(
                client, key=key, audio=audio, filename=safe_name, mime=mime
            )
