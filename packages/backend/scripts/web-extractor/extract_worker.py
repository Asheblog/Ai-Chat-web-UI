#!/usr/bin/env python3
"""Resident HTML-to-text extraction worker (JSON Lines over stdin/stdout).

Contract with the Node caller:
  - Read one JSON object per line from stdin: {"id": <string>, "url": <string>, "html": <string>}
  - Write one JSON object per line to stdout:
      {"type": "ready", "trafilatura": "<version>"}          once, after imports succeed
      {"id": <string>, "ok": true, "document": {"title"?: str, "content": str, "excerpt"?: str} | null}
      {"id": <string>, "ok": false, "error": {"code": str, "message": str}}
  - Diagnostics go to stderr only. stdout carries protocol lines and nothing else.
  - EOF on stdin ends the process (exit 0). Missing dependencies exit 3 before "ready".

The worker never touches the network: it only parses HTML that the caller already downloaded.
"""

from __future__ import annotations

import json
import sys

# Bound single-input size. The Node side already rejects oversized payloads; this is the
# worker's own guard so a protocol mistake cannot exhaust memory.
MAX_INPUT_BYTES = 4 * 1024 * 1024
# Cap emitted text so a pathological page cannot dominate the pipe or the caller's memory.
MAX_CONTENT_CHARS = 200_000
# Below this many characters we assume the precise pass under-extracted and retry with recall.
RECALL_RETRY_THRESHOLD = 500
MAX_ERROR_MESSAGE_CHARS = 400


def _configure_streams() -> None:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace", newline="\n")
        except (AttributeError, ValueError):
            pass


def _emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _log(message: str) -> None:
    sys.stderr.write("web-extractor: " + message + "\n")
    sys.stderr.flush()


def _load_trafilatura():
    import trafilatura  # imported here so a missing dependency fails before "ready"

    return trafilatura


def _run_extract(trafilatura, html: str, url: str | None, favor_recall: bool) -> dict | None:
    raw = trafilatura.extract(
        html,
        url=url,
        output_format="json",
        include_comments=False,
        include_tables=True,
        include_images=False,
        include_formatting=False,
        include_links=False,
        favor_recall=favor_recall,
        with_metadata=True,
    )
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _pick_text(parsed: dict | None) -> str:
    if not parsed:
        return ""
    for key in ("text", "raw_text"):
        value = parsed.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return ""


def _metadata(trafilatura, html: str, url: str | None) -> dict:
    try:
        meta = trafilatura.extract_metadata(html, default_url=url)
    except Exception:  # metadata is best-effort; body extraction still counts as success
        return {}
    fields = {}
    for source_key, target_key in (("title", "title"), ("description", "excerpt"), ("language", "lang")):
        value = getattr(meta, source_key, None)
        if isinstance(value, str) and value.strip():
            fields[target_key] = value.strip()
    return fields


def _build_document(trafilatura, html: str, url: str | None) -> dict | None:
    precise = _run_extract(trafilatura, html, url, favor_recall=False)
    text = _pick_text(precise)
    chosen = precise

    if len(text.strip()) < RECALL_RETRY_THRESHOLD:
        recalled = _run_extract(trafilatura, html, url, favor_recall=True)
        recalled_text = _pick_text(recalled)
        if len(recalled_text.strip()) > len(text.strip()):
            text = recalled_text
            chosen = recalled

    text = text.strip()
    if not text:
        return None

    truncated = len(text) > MAX_CONTENT_CHARS
    if truncated:
        text = text[:MAX_CONTENT_CHARS]

    document: dict = {"content": text}
    meta = _metadata(trafilatura, html, url)
    title = (chosen or {}).get("title") if chosen else None
    if not (isinstance(title, str) and title.strip()):
        title = meta.get("title")
    if isinstance(title, str) and title.strip():
        document["title"] = title.strip()

    excerpt = (chosen or {}).get("description") if chosen else None
    if not (isinstance(excerpt, str) and excerpt.strip()):
        excerpt = meta.get("excerpt")
    if isinstance(excerpt, str) and excerpt.strip():
        document["excerpt"] = excerpt.strip()[:500]

    if truncated:
        _log("content truncated at %d characters" % MAX_CONTENT_CHARS)
    return document


def _handle_job(trafilatura, job: dict) -> None:
    job_id = job.get("id")
    url = job.get("url") or None
    html = job.get("html")

    if not isinstance(html, str) or not html.strip():
        _emit({"id": job_id, "ok": False, "error": {"code": "INPUT_EMPTY", "message": "html payload was empty"}})
        return
    if len(html.encode("utf-8", errors="ignore")) > MAX_INPUT_BYTES:
        _emit({
            "id": job_id,
            "ok": False,
            "error": {"code": "INPUT_TOO_LARGE", "message": "html payload exceeded %d bytes" % MAX_INPUT_BYTES},
        })
        return

    try:
        document = _build_document(trafilatura, html, url if isinstance(url, str) else None)
    except Exception as exc:  # one bad page must not take down the resident worker
        _emit({
            "id": job_id,
            "ok": False,
            "error": {
                "code": "EXTRACT_FAILED",
                "message": (str(exc) or exc.__class__.__name__)[:MAX_ERROR_MESSAGE_CHARS],
            },
        })
        return

    _emit({"id": job_id, "ok": True, "document": document})


def main() -> int:
    _configure_streams()
    try:
        trafilatura = _load_trafilatura()
    except Exception as exc:
        _log("trafilatura unavailable: %s" % (str(exc) or exc.__class__.__name__))
        return 3

    _emit({"type": "ready", "trafilatura": getattr(trafilatura, "__version__", "unknown")})

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            job = json.loads(line)
        except ValueError:
            _log("dropped a line that was not valid JSON")
            continue
        if not isinstance(job, dict):
            _log("dropped a JSON line that was not an object")
            continue
        _handle_job(trafilatura, job)

    return 0


if __name__ == "__main__":
    sys.exit(main())
