"""Local-only static preview, with no third-party dependencies."""
import functools
import os
from pathlib import Path
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.request import urlopen
import webbrowser

root = Path(__file__).resolve().parent.parent
port = int(os.environ.get("GRE_PORT", "4173"))
url = f"http://127.0.0.1:{port}/"
handler = functools.partial(SimpleHTTPRequestHandler, directory=str(root))
try:
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
except OSError:
    try:
        with urlopen(url, timeout=2) as response:
            existing = response.read(8192).decode("utf-8")
        if "GRE 词境 · Lexi Atlas" not in existing:
            raise ValueError("该端口运行着其他网站")
    except Exception:
        sys.exit(f"端口 {port} 不可用。请先关闭占用该端口的程序，或设置 GRE_PORT 后重试。")
    webbrowser.open(url)
    print(f"已打开正在运行的词境：{url}")
    sys.exit(0)
print(f"GRE 词境：{url}\n保持此窗口打开。按 Ctrl+C 停止服务。", flush=True)
webbrowser.open(url)
try:
    server.serve_forever()
except KeyboardInterrupt:
    print("\n词境本地服务已停止。")
finally:
    server.server_close()
