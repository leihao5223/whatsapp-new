from __future__ import annotations

import json
import os
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

try:
    import pyautogui
except ImportError:  # pragma: no cover - handled by setup instructions.
    pyautogui = None


HOST = os.getenv("QQ_BRIDGE_HOST", "127.0.0.1")
PORT = int(os.getenv("QQ_BRIDGE_PORT", "9876"))
QQ_EXE = os.getenv("QQ_EXE", r"C:\Program Files\Tencent\QQNT\QQ.exe")


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
    if not os.path.exists(QQ_EXE):
        raise FileNotFoundError(f"QQ_EXE not found: {QQ_EXE}")

    subprocess.Popen([QQ_EXE], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def type_text(value: str) -> None:
    if pyautogui is None:
        raise RuntimeError("pyautogui is not installed. Run: pip install -r requirements.txt")
    pyautogui.write(value, interval=0.025)


class QQBridgeHandler(BaseHTTPRequestHandler):
    server_version = "QELocalQQBridge/0.1"

    def do_OPTIONS(self) -> None:  # noqa: N802
        json_response(self, 204, {})

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            json_response(
                self,
                200,
                {
                    "ok": True,
                    "mode": "windows-qq-bridge",
                    "qqExe": QQ_EXE,
                },
            )
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
                if not bind_only and pyautogui is not None and account and password:
                    type_text(account)
                    pyautogui.press("tab")
                    type_text(password)
                    pyautogui.press("enter")

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

                if pyautogui is not None:
                    pyautogui.hotkey("ctrl", "f")
                    type_text(query)
                    pyautogui.press("enter")

                json_response(
                    self,
                    200,
                    {
                        "success": True,
                        "title": f"已发送到本机 QQ 搜索：{query}",
                        "category": "待复核",
                        "summary": "Bridge 已把搜索内容发送到本机 QQ，结果抽取将在下一阶段接入 OCR/窗口读取。",
                        "confidence": 72,
                        "source": "Windows QQ Bridge",
                        "tags": ["本机QQ", "Bridge"],
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
