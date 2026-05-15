from __future__ import annotations

import json
import os
import re
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

try:
    import pyperclip
    from pywinauto import Desktop
    from pywinauto.keyboard import send_keys
except ImportError:  # pragma: no cover - handled by setup instructions.
    Desktop = None
    pyperclip = None
    send_keys = None


HOST = os.getenv("QQ_BRIDGE_HOST", "127.0.0.1")
PORT = int(os.getenv("QQ_BRIDGE_PORT", "9876"))
QQ_EXE = os.getenv("QQ_EXE", r"C:\Program Files\Tencent\QQNT\QQ.exe")
QQ_EXE_CANDIDATES = [
    QQ_EXE,
    r"C:\Program Files\Tencent\QQNT\QQ.exe",
    r"C:\Program Files\Tencent\QQ\QQ.exe",
    r"C:\Program Files (x86)\Tencent\QQ\Bin\QQ.exe",
]


def json_response(handler: BaseHTTPRequestHandler, status: int, body: dict[str, Any]) -> None:
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def read_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    content_length = int(handler.headers.get("Content-Length", "0"))
    if content_length <= 0:
        return {}
    raw = handler.rfile.read(content_length)
    return json.loads(raw.decode("utf-8") or "{}")


def open_qq() -> None:
    executable = next((path for path in QQ_EXE_CANDIDATES if path and os.path.exists(path)), None)
    if executable is None:
        raise FileNotFoundError(
            f"QQ_EXE not found: {QQ_EXE}. "
            "Please set env QQ_EXE to your real QQ executable path, or open QQ manually before searching."
        )

    subprocess.Popen([executable], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def qq_windows() -> list[Any]:
    if Desktop is None:
        raise RuntimeError("pywinauto is not installed. Run: pip install -r requirements.txt")

    windows = []
    for window in Desktop(backend="uia").windows():
        title = window.window_text()
        class_name = window.element_info.class_name or ""
        if "QQ" in title or "腾讯" in title or "TXGuiFoundation" in class_name:
            windows.append(window)
    return windows


def compact_control(control: Any) -> dict[str, str]:
    info = control.element_info
    return {
        "autoId": info.automation_id or "",
        "className": info.class_name or "",
        "controlType": info.control_type or "",
        "name": info.name or "",
    }


def extract_qq_from_controls(query: str, limit: int = 220) -> str | None:
    query_norm = query.strip()
    candidates: dict[str, int] = {}
    for window in qq_windows():
        controls = window.descendants()[:limit]
        for control in controls:
            name = (control.element_info.name or "").strip()
            if not name:
                continue

            for match in re.findall(r"\b\d{5,12}\b", name):
                if match == query_norm:
                    continue
                candidates[match] = candidates.get(match, 0) + 1

    if not candidates:
        return None

    sorted_candidates = sorted(candidates.items(), key=lambda item: item[1], reverse=True)
    return sorted_candidates[0][0]


def collect_candidates_from_controls(query: str, limit: int = 260) -> list[dict[str, Any]]:
    query_norm = query.strip()
    name_weight: dict[str, int] = {}
    qq_weight: dict[str, int] = {}

    for window in qq_windows():
        controls = window.descendants()[:limit]
        for control in controls:
            info = control.element_info
            name = (info.name or "").strip()
            if not name:
                continue

            lowered = name.lower()
            # Prefer text blocks likely tied to search results.
            if any(keyword in lowered for keyword in ["搜索", "查找", "用户", "昵称", "账号", "qq"]):
                name_weight[name] = name_weight.get(name, 0) + 2
            else:
                name_weight[name] = name_weight.get(name, 0) + 1

            for qq in re.findall(r"\b\d{5,12}\b", name):
                if qq == query_norm:
                    continue
                qq_weight[qq] = qq_weight.get(qq, 0) + 2

    candidates: list[dict[str, Any]] = []
    for qq, weight in sorted(qq_weight.items(), key=lambda item: item[1], reverse=True)[:10]:
        candidates.append(
            {
                "qq": qq,
                "name": "",
                "avatarHash": "",
                "signals": {"qqHits": weight, "nameHits": 0, "keywordHits": 1},
                "source": "uia-controls",
            }
        )

    top_names = [name for name, _ in sorted(name_weight.items(), key=lambda item: item[1], reverse=True)[:10]]
    if not candidates and top_names:
        for name in top_names:
            candidates.append(
                {
                    "qq": "",
                    "name": name,
                    "avatarHash": "",
                    "signals": {"qqHits": 0, "nameHits": 1, "keywordHits": 1},
                    "source": "uia-controls",
                }
            )
    elif top_names:
        for index, candidate in enumerate(candidates):
            if index < len(top_names):
                candidate["name"] = top_names[index]
                candidate["signals"]["nameHits"] = 1

    return candidates[:10]


def inspect_qq_controls(limit: int = 80) -> list[dict[str, str]]:
    controls: list[dict[str, str]] = []
    for window in qq_windows():
        controls.append({"autoId": "", "className": "", "controlType": "Window", "name": window.window_text()})
        for control in window.descendants():
            item = compact_control(control)
            if item["controlType"] or item["name"] or item["autoId"]:
                controls.append(item)
            if len(controls) >= limit:
                return controls
    return controls


def is_search_candidate(control: Any) -> bool:
    info = control.element_info
    text = " ".join(
        [
            info.name or "",
            info.automation_id or "",
            info.class_name or "",
            info.control_type or "",
        ],
    ).lower()
    return info.control_type in {"Edit", "ComboBox"} and any(keyword in text for keyword in ["search", "搜索", "查找"])


def find_search_control() -> Any | None:
    for window in qq_windows():
        for control in window.descendants():
            if is_search_candidate(control):
                return control
    return None


def focus_primary_qq_window() -> Any | None:
    windows = qq_windows()
    if not windows:
        return None

    window = windows[0]
    try:
        window.set_focus()
    except Exception:
        return None
    return window


def paste_text(value: str) -> None:
    if pyperclip is None or send_keys is None:
        raise RuntimeError("pyperclip/pywinauto keyboard is not installed. Run: pip install -r requirements.txt")
    pyperclip.copy(value)
    send_keys("^a")
    send_keys("^v")


def run_uia_search(query: str) -> dict[str, Any]:
    # If QQ is already open, do not block on fixed install path.
    if not qq_windows():
        open_qq()
        time.sleep(1)

    search_control = find_search_control()
    if search_control is None:
        active_window = focus_primary_qq_window()
        if active_window is None:
            return {
                "success": False,
                "error": "未找到可聚焦的 QQ 窗口。",
                "controls": inspect_qq_controls(40),
            }

        # QQ 新版 UIA 有时无法直接枚举搜索框，回退到 Ctrl+F 热键方案。
        send_keys("^f")
        time.sleep(0.2)
        paste_text(query)
        send_keys("{ENTER}")
        time.sleep(0.8)
        extracted_qq = extract_qq_from_controls(query)
        candidates = collect_candidates_from_controls(query)
        return {
            "success": True,
            "control": {
                "autoId": "",
                "className": "",
                "controlType": "HotkeyFallback",
                "name": "Ctrl+F fallback",
            },
            "mode": "hotkey-fallback",
            "qq": extracted_qq,
            "candidates": candidates,
        }

    search_control.set_focus()
    paste_text(query)
    send_keys("{ENTER}")
    time.sleep(0.8)
    extracted_qq = extract_qq_from_controls(query)
    candidates = collect_candidates_from_controls(query)
    return {
        "success": True,
        "control": compact_control(search_control),
        "qq": extracted_qq,
        "candidates": candidates,
    }


class QQBridgeHandler(BaseHTTPRequestHandler):
    server_version = "QELocalQQBridge/0.1"

    def do_OPTIONS(self) -> None:  # noqa: N802
        json_response(self, 204, {})

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            try:
                windows = [window.window_text() for window in qq_windows()]
            except Exception:
                windows = []
            json_response(
                self,
                200,
                {
                    "ok": True,
                    "mode": "windows-qq-bridge",
                    "qqExe": QQ_EXE,
                    "windows": windows,
                },
            )
            return

        if self.path == "/inspect":
            json_response(self, 200, {"success": True, "controls": inspect_qq_controls()})
            return

        json_response(self, 404, {"success": False, "error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        try:
            if self.path == "/open":
                open_qq()
                json_response(self, 200, {"success": True, "message": "QQ opened"})
                return

            if self.path == "/login":
                body = read_json(self)
                account = str(body.get("account", "")).strip()
                password = str(body.get("password", ""))
                bind_only = bool(body.get("bindOnly")) or body.get("loginMode") == "existing-session"

                open_qq()
                time.sleep(2)

                json_response(
                    self,
                    200,
                    {
                        "success": True,
                        "account": account or "本机已登录QQ",
                        "message": "已绑定本机 QQ 窗口。若 QQ 已登录，系统将直接调用该 QQ；如未登录，请先在 QQ 内扫码登录。",
                    },
                )
                return

            if self.path == "/search":
                body = read_json(self)
                query = str(body.get("query", "")).strip()
                if not query:
                    json_response(self, 400, {"success": False, "error": "Missing query"})
                    return

                search_result = run_uia_search(query)
                if not search_result.get("success"):
                    json_response(self, 422, search_result)
                    return

                json_response(
                    self,
                    200,
                    {
                        "success": True,
                        "opened": True,
                        "status": "opened",
                        "title": f"已通过 UIA 发送到本机 QQ 搜索：{query}",
                        "category": "开通",
                        "summary": "Bridge 已执行搜索动作；当前按成功触发搜索暂记为开通，后续可接入 QQ 两态状态源精确判定。",
                        "confidence": 72,
                        "source": "Windows QQ Bridge",
                        "tags": ["本机QQ", "Bridge", "开通判定"],
                        "control": search_result.get("control"),
                        "qq": search_result.get("qq"),
                        "candidates": search_result.get("candidates", []),
                    },
                )
                return

            json_response(self, 404, {"success": False, "error": "Not found"})
        except Exception as error:  # noqa: BLE001 - bridge must surface local automation errors.
            json_response(self, 500, {"success": False, "error": str(error)})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[QQ Bridge] {self.address_string()} - {format % args}")


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), QQBridgeHandler)
    print(f"QQ Bridge listening on http://{HOST}:{PORT}")
    print(f"QQ_EXE={QQ_EXE}")
    server.serve_forever()


if __name__ == "__main__":
    main()
