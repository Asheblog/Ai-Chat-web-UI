#!/usr/bin/env python3
"""Build-time smoke test for the extraction worker.

Verifies that Trafilatura is importable inside the target environment and that the
JSONL contract works end to end: one request in, one document out, navigation dropped.
Run after installing requirements.lock:

    <venv>/bin/python smoke_test.py

Exits non-zero with a readable message when the capability is broken, so an image
build fails instead of shipping a silently unavailable extractor.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

WORKER = Path(__file__).with_name("extract_worker.py")
TIMEOUT_SECONDS = 60

FIXTURE_HTML = """
<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>受限检索改造：正文质量判定</title>
<meta name="description" content="说明正文质量判定与降级策略。">
</head><body>
<nav><a href="/">首页</a><a href="/news">新闻中心</a></nav>
<article>
<h1>受限检索改造：正文质量判定</h1>
<p>我们先把已经下载的 HTML 交给本地提取器，避免重复下载。这一段用于验证提取器能否在中文页面上取出正文，而不是把导航当成内容。</p>
<p>第二段描述取消语义：调用方取消时立刻结算，不占用队列。第三段描述空闲退出：一段时间没有任务后进程自行结束，避免容器里常驻无尽负载。</p>
<p>表格信息同样重要：时间、数值列需要在正文中保留，供后续结构化处理使用。最后一段包含较长文本，用于让提取器按精确模式返回结果。</p>
</article>
<footer>版权所有</footer>
</body></html>
"""

MARKER = "第二段描述取消语义"


def fail(message: str) -> "NoReturn":  # type: ignore[name-defined]
    sys.stderr.write("smoke test failed: " + message + "\n")
    raise SystemExit(1)


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    payload = json.dumps(
        {"id": "smoke-1", "url": "https://example.com/smoke", "html": FIXTURE_HTML},
        ensure_ascii=False,
    )
    completed = subprocess.run(
        [sys.executable, str(WORKER)],
        input=payload + "\n",
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=TIMEOUT_SECONDS,
    )
    if completed.returncode != 0:
        fail(
            "worker exited %d; stderr=%s"
            % (completed.returncode, (completed.stderr or "").strip()[:500])
        )

    lines = [line for line in completed.stdout.splitlines() if line.strip()]
    if not lines:
        fail("worker produced no stdout lines")

    try:
        ready = json.loads(lines[0])
    except ValueError:
        fail("first stdout line was not JSON: " + lines[0][:200])
    if ready.get("type") != "ready":
        fail("first stdout line was not the ready handshake: " + lines[0][:200])

    document = None
    for line in lines[1:]:
        try:
            event = json.loads(line)
        except ValueError:
            fail("stdout carried a non-JSON line: " + line[:200])
        if event.get("id") == "smoke-1":
            if not event.get("ok"):
                fail("extraction returned an error: " + json.dumps(event.get("error"))[:300])
            document = event.get("document")
            break

    if not isinstance(document, dict):
        fail("no document returned for the smoke job")

    content = document.get("content") or ""
    if MARKER not in content:
        fail("body text missing the article marker; got: " + content[:200])
    if "新闻中心" in content:
        fail("navigation text leaked into the body")
    if not document.get("title"):
        fail("title was not extracted")
    if not document.get("excerpt"):
        fail("excerpt was not extracted")

    sys.stderr.write(
        "smoke test ok: trafilatura=%s title=%r content_chars=%d\n"
        % (ready.get("trafilatura"), document.get("title"), len(content))
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
