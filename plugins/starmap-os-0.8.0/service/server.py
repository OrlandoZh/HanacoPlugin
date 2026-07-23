# -*- coding: utf-8 -*-
"""server.py — 星图 HTTP 服务（纯标准库 http.server）。

核心 API：
  POST /api/starmap/conversations/sync     ← 插件推对话
  POST /api/starmap/conversations/review   ← 审核确认/驳回
  GET  /api/starmap/conversations           ← 对话/卡片列表
  GET  /api/starmap/conversations/session   ← 单段对话详情
  GET  /api/starmap/overview                ← 总览数据
  GET  /api/starmap/ai-status               ← Hanako AI 调用方式与状态
  GET  /api/starmap/knowledge               ← 知识库索引
  GET  /api/starmap/knowledge/note          ← 单条笔记
  POST /api/starmap/knowledge/note          ← 笔记增删改
  GET  /api/starmap/trash                   ← 废纸篓
  POST /api/starmap/trash/restore|purge|empty
"""
import os
import sys
import json
import threading
import re

HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.join(HERE, "core")
STATIC = os.path.join(HERE, "static")
DATA = os.path.abspath(os.environ.get("STARMAP_DATA_DIR") or os.path.join(HERE, "data"))
INDEX_PATH = os.path.join(DATA, "index", "kb.json")
PROVIDERS_PATH = os.path.join(DATA, "providers.json")
PLUGIN_MANIFEST_PATH = next((path for path in (
    os.path.join(HERE, "plugin", "manifest.json"),
    os.path.join(os.path.dirname(HERE), "manifest.json"),
) if os.path.exists(path)), os.path.join(HERE, "plugin", "manifest.json"))

os.makedirs(DATA, exist_ok=True)
os.makedirs(os.path.dirname(INDEX_PATH), exist_ok=True)

sys.path.insert(0, CORE)

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import providers as provmod
import starmap_store as starmod

_kb = None
_store = None
_starmap_store = None
_kb_lock = threading.RLock()


def get_kb():
    global _kb
    with _kb_lock:
        if _kb is None:
            import kb as kbmod
            _kb = kbmod.KnowledgeBase(INDEX_PATH)
            if not _kb.docs and os.path.exists(INDEX_PATH):
                _kb.load(INDEX_PATH)
        return _kb


def get_store():
    global _store
    with _kb_lock:
        if _store is None:
            _store = provmod.ProviderStore(PROVIDERS_PATH)
        return _store


def get_starmap_store():
    global _starmap_store
    with _kb_lock:
        if _starmap_store is None:
            _starmap_store = starmod.StarmapStore(
                DATA,
                provider_store=get_store(),
                kb=get_kb(),
                kb_index_path=INDEX_PATH,
            )
        return _starmap_store


def get_ai_status():
    """只报告可验证信息；Hanako 未向插件暴露具体厂商和模型名。"""
    manifest = {}
    try:
        with open(PLUGIN_MANIFEST_PATH, "r", encoding="utf-8") as handle:
            manifest = json.load(handle)
    except (OSError, ValueError):
        pass
    sessions = get_starmap_store().conversations.list(limit=200).get("items", [])
    ready = [item for item in sessions if item.get("extraction_status") == "ready"]
    failed = [item for item in sessions if item.get("extraction_status") == "failed"]
    pending = [item for item in sessions if item.get("extraction_status") == "pending_ai"]
    return {
        "ok": True, "mode": "hanako_plugin", "mode_label": "Hanako AI 插件模式",
        "interface": "model:sample-text", "provider": "跟随当前 Hanako 智能体配置",
        "model": "由 Hanako 管理（未向星图暴露）", "direct_vendor_api": False,
        "local_model": False, "plugin_id": manifest.get("id", "starmap-os"),
        "plugin_version": manifest.get("version", ""),
        "status": "failed" if failed else "pending" if pending else "healthy",
        "ready_sessions": len(ready), "pending_sessions": len(pending), "failed_sessions": len(failed),
        "last_success_at": max((item.get("last_extracted_at") or "" for item in ready), default=""),
    }


def send_json(handler, obj, code=200):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_json_body(handler):
    try:
        length = int(handler.headers.get("Content-Length", 0) or 0)
    except (TypeError, ValueError):
        raise ValueError("Content-Length 无效")
    if length <= 0:
        return {}
    if length > 8 * 1024 * 1024:
        raise ValueError("请求正文超过 8 MiB 上限")
    raw = handler.rfile.read(length)
    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        raise ValueError("请求正文不是有效 UTF-8 JSON")
    if not isinstance(payload, dict):
        raise ValueError("请求正文必须是 JSON 对象")
    return payload


def is_local_host_header(value):
    if not isinstance(value, str) or not value or any(
            char in value for char in ("@", "/", "\\", "#", "?", ",", "\r", "\n", "\t", " ")):
        return False
    try:
        parsed = urlparse("//" + value)
        hostname = (parsed.hostname or "").lower()
        parsed.port
    except (TypeError, ValueError):
        return False
    return hostname in {"127.0.0.1", "localhost", "::1"}


def is_json_content_type(value):
    if not isinstance(value, str):
        return False
    return value.split(";", 1)[0].strip().lower() == "application/json"


def serve_static(handler, path):
    rel = path.lstrip("/")
    if rel in ("", "index.html"):
        rel = "index.html"
    fpath = os.path.normpath(os.path.join(STATIC, rel))
    if os.path.commonpath((STATIC, fpath)) != STATIC or not os.path.isfile(fpath):
        handler.send_response(404)
        handler.end_headers()
        return
    ctype = {"html": "text/html", "css": "text/css", "js": "application/javascript", "json": "application/json"}.get(
        fpath.split(".")[-1], "text/plain")
    with open(fpath, "rb") as f:
        data = f.read()
    handler.send_response(200)
    handler.send_header("Content-Type", f"{ctype}; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


class Handler(BaseHTTPRequestHandler):
    def _require_local_host(self):
        if not is_local_host_header(self.headers.get("Host")):
            send_json(self, {"ok": False, "error": "只接受本机 Host"}, 403)
            return False
        return True

    def do_OPTIONS(self):
        if not self._require_local_host():
            return
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if not self._require_local_host():
            return
        parsed = urlparse(self.path)

        if parsed.path == "/api/starmap/overview":
            send_json(self, get_starmap_store().overview())
            return

        if parsed.path == "/api/starmap/ai-status":
            send_json(self, get_ai_status())
            return

        if parsed.path == "/api/starmap/conversations":
            q = parse_qs(parsed.query)
            try:
                result = get_starmap_store().conversations.list(
                    q.get("status", [None])[0], int(q.get("limit", [100])[0])
                )
                send_json(self, {"ok": True, **result})
            except ValueError as error:
                send_json(self, {"ok": False, "error": str(error)}, 400)
            return

        if parsed.path == "/api/starmap/conversations/session":
            session_id = parse_qs(parsed.query).get("id", [None])[0]
            if not session_id:
                send_json(self, {"ok": False, "error": "缺少 id"}, 400)
                return
            try:
                send_json(self, {"ok": True, **get_starmap_store().conversations.get(session_id)})
            except LookupError:
                send_json(self, {"ok": False, "error": "未找到"}, 404)
            except ValueError as error:
                send_json(self, {"ok": False, "error": str(error)}, 400)
            return

        if parsed.path == "/api/starmap/knowledge":
            send_json(self, get_starmap_store().knowledge.index())
            return

        if parsed.path == "/api/starmap/search":
            q = parse_qs(parsed.query).get("q", [""])[0]
            try:
                limit = int(parse_qs(parsed.query).get("limit", [10])[0])
            except ValueError:
                limit = 10
            if not q.strip():
                send_json(self, {"ok": True, "results": []})
                return
            try:
                results = get_kb().search(q, top_k=limit)
                send_json(self, {"ok": True, "results": results})
            except Exception as error:
                send_json(self, {"ok": False, "error": str(error)}, 500)
            return

        if parsed.path == "/api/starmap/recap":
            try:
                raw_days = parse_qs(parsed.query).get("days", ["7"])[0]
                days = max(1, min(int(raw_days), 366))
                send_json(self, {"ok": True, **get_starmap_store().recap(days)})
            except Exception as error:
                send_json(self, {"ok": False, "error": str(error)}, 500)
            return

        if parsed.path == "/api/starmap/projects":
            send_json(self, {"ok": True, **get_starmap_store().projects.list()})
            return

        if parsed.path == "/api/starmap/projects/candidates":
            send_json(self, {"ok": True, "items": get_starmap_store().projects.candidates()})
            return

        if parsed.path == "/api/starmap/projects/detail":
            project_id = parse_qs(parsed.query).get("id", [None])[0]
            if not project_id:
                send_json(self, {"ok": False, "error": "缺少 id"}, 400)
                return
            try:
                send_json(self, {"ok": True, "project": get_starmap_store().projects.get(project_id)})
            except LookupError as error:
                send_json(self, {"ok": False, "error": str(error)}, 404)
            return

        if parsed.path == "/api/starmap/projects/capsule":
            query = parse_qs(parsed.query)
            project_id = query.get("id", [None])[0]
            try:
                send_json(self, {"ok": True, **get_starmap_store().projects.capsule(project_id, query.get("question", [""])[0])})
            except LookupError as error:
                send_json(self, {"ok": False, "error": str(error)}, 404)
            return

        if parsed.path == "/api/starmap/knowledge/note":
            nid = parse_qs(parsed.query).get("id", [None])[0]
            if not nid:
                send_json(self, {"ok": False, "error": "缺少 id"}, 400)
                return
            note = get_starmap_store().knowledge.note(nid)
            if not note:
                send_json(self, {"ok": False, "error": "未找到"}, 404)
                return
            send_json(self, {"ok": True, **note})
            return

        if parsed.path == "/api/starmap/knowledge/domain":
            name = parse_qs(parsed.query).get("name", [None])[0]
            if not name:
                send_json(self, {"ok": False, "error": "缺少 name"}, 400)
                return
            dom = get_starmap_store().knowledge.domain(name)
            if not dom:
                send_json(self, {"ok": False, "error": "暂无内容"}, 404)
                return
            send_json(self, {"ok": True, **dom})
            return

        if parsed.path == "/api/starmap/trash":
            items = get_starmap_store().list_trash()
            send_json(self, {"ok": True, "items": items})
            return

        if parsed.path == "/api/starmap/providers":
            send_json(self, get_store().list())
            return

        serve_static(self, parsed.path)

    def do_POST(self):
        if not self._require_local_host():
            return
        parsed = urlparse(self.path)
        if not is_json_content_type(self.headers.get("Content-Type")):
            send_json(self, {"ok": False, "error": "POST 必须使用 application/json"}, 415)
            return
        try:
            data = read_json_body(self)
        except ValueError as error:
            send_json(self, {"ok": False, "error": str(error)}, 400)
            return

        # ===== 对话同步 =====
        if parsed.path == "/api/starmap/conversations/sync":
            try:
                r = get_starmap_store().conversations.sync(data)
                send_json(self, {"ok": True, **r})
            except ValueError as error:
                send_json(self, {"ok": False, "error": str(error)}, 400)
            return

        if parsed.path == "/api/starmap/conversations/delete":
            try:
                deleted = get_starmap_store().delete_conversation(data.get("session_id"))
                send_json(self, {"ok": True, "deleted": deleted})
            except LookupError as error:
                send_json(self, {"ok": False, "error": str(error)}, 404)
            except ValueError as error:
                send_json(self, {"ok": False, "error": str(error)}, 400)
            return

        # ===== 审核 =====
        if parsed.path == "/api/starmap/conversations/review":
            try:
                r = get_starmap_store().conversations.review(data)
                send_json(self, {"ok": True, **r})
            except LookupError as error:
                send_json(self, {"ok": False, "error": str(error)}, 404)
            except ValueError as error:
                send_json(self, {"ok": False, "error": str(error)}, 400)
            return

        # ===== 知识库笔记增删改 =====
        if parsed.path == "/api/starmap/knowledge/note":
            sms = get_starmap_store()
            action = data.get("action", "add")
            if action == "edit":
                meta = sms.edit_note(
                    data.get("id"), data.get("title"), data.get("content"),
                    data.get("domain"), data.get("tags"),
                )
                if meta is None:
                    send_json(self, {"ok": False, "error": "未找到"}, 404)
                    return
                send_json(self, {"ok": True, **meta})
            elif action == "delete":
                rec = sms.delete_note(data.get("id"))
                if rec is None:
                    send_json(self, {"ok": False, "error": "未找到"}, 404)
                    return
                send_json(self, {"ok": True, "trash_id": rec["trash_id"]})
            else:
                content = (data.get("content") or "").strip()
                if not content:
                    send_json(self, {"ok": False, "error": "content 不能为空"}, 400)
                    return
                domain = data.get("domain") or "综合"
                meta = sms.knowledge.add_note(
                    data.get("title", ""), content, domain,
                    tags=data.get("tags", []),
                    source={"kind": "manual"},
                )
                # 同步进检索索引，使搜索可用（失败不影响笔记落库）
                try:
                    kb = get_kb()
                    doc_id = "starmap-note:%s" % meta["id"]
                    kb.add_text(doc_id, content, title=data.get("title", "") or content[:40],
                                source="manual", kind="note")
                    if doc_id in kb.docs:
                        kb.docs[doc_id]["category"] = domain
                        kb.docs[doc_id]["tags"] = data.get("tags", [])
                    kb.save(INDEX_PATH)
                except Exception:
                    pass
                send_json(self, {"ok": True, **meta})
            return

        if parsed.path == "/api/starmap/projects":
            projects = get_starmap_store().projects
            action = data.get("action", "create")
            try:
                if action == "create":
                    project = projects.create(data.get("name"), data.get("goal", ""))
                elif action == "assign_session":
                    project = projects.assign_session(data.get("project_id"), data.get("session_id"))
                    session = get_starmap_store().conversations.get(data.get("session_id"))["session"]
                    suggested = (session.get("project_suggestion") or {}).get("project_id")
                    get_starmap_store().conversations.resolve_project(
                        data.get("session_id"), "accepted" if suggested == data.get("project_id") else "changed",
                        data.get("project_id"))
                elif action == "resolve_suggestion":
                    session_id = data.get("session_id")
                    resolution = data.get("resolution")
                    if resolution == "dismissed":
                        get_starmap_store().conversations.resolve_project(session_id, "dismissed")
                        send_json(self, {"ok": True, "resolution": "dismissed"})
                        return
                    session = get_starmap_store().conversations.get(session_id)["session"]
                    suggested = (session.get("project_suggestion") or {}).get("project_id")
                    project_id = data.get("project_id") or suggested
                    project = projects.assign_session(project_id, session_id)
                    status = "accepted" if project_id == suggested else "changed"
                    get_starmap_store().conversations.resolve_project(session_id, status, project_id)
                elif action == "unassign_session":
                    project = projects.unassign_session(data.get("project_id"), data.get("session_id"))
                    get_starmap_store().conversations.resolve_project(data.get("session_id"), "dismissed")
                elif action == "delete":
                    deleted = projects.delete(data.get("project_id"))
                    for session_id in deleted.get("session_ids", []):
                        get_starmap_store().conversations.resolve_project(session_id, "dismissed")
                    send_json(self, {"ok": True, "deleted": deleted})
                    return
                else:
                    send_json(self, {"ok": False, "error": "未知 action"}, 400)
                    return
                send_json(self, {"ok": True, "project": project})
            except LookupError as error:
                send_json(self, {"ok": False, "error": str(error)}, 404)
            except ValueError as error:
                send_json(self, {"ok": False, "error": str(error)}, 400)
            return

        if parsed.path == "/api/starmap/knowledge/link":
            url = (data.get("url") or "").strip()
            if not re.match(r"^https?://", url, re.I):
                send_json(self, {"ok": False, "error": "只支持 HTTP/HTTPS"}, 400)
                return
            meta = get_starmap_store().knowledge.add_link(
                data.get("title", ""), url, data.get("domain", ""),
            )
            send_json(self, {"ok": True, **meta})
            return

        # ===== 废纸篓 =====
        if parsed.path == "/api/starmap/trash/restore":
            rec = get_starmap_store().restore_trash(data.get("trash_id"))
            if rec is None:
                send_json(self, {"ok": False, "error": "未找到"}, 404)
                return
            send_json(self, {"ok": True, **rec})
            return

        if parsed.path == "/api/starmap/trash/purge":
            ok = get_starmap_store().purge_trash(data.get("trash_id"))
            send_json(self, {"ok": ok})
            return

        if parsed.path == "/api/starmap/trash/empty":
            get_starmap_store().empty_trash()
            send_json(self, {"ok": True})
            return

        # ===== 手动摄入（无需插件，直接贴文本进收件箱） =====
        if parsed.path == "/api/starmap/ingest":
            text = (data.get("text") or "").strip()
            if not text:
                send_json(self, {"ok": False, "error": "text 不能为空"}, 400)
                return
            try:
                r = get_starmap_store().conversations.sync_manual({
                    "messages": [{"role": "assistant", "content": text}],
                    "title": data.get("title") or "手动采集",
                })
                send_json(self, {"ok": True, **r})
            except ValueError as error:
                send_json(self, {"ok": False, "error": str(error)}, 400)
            return

        # ===== Provider 配置 =====
        if parsed.path == "/api/starmap/providers":
            pstore = get_store()
            action = data.get("action", "add")
            if action == "add":
                rec = pstore.add(data.get("provider", {}))
                send_json(self, {"ok": True, "provider": {**rec, "api_key": "",
                          "has_api_key": bool(rec.get("api_key"))}})
            elif action == "delete":
                pstore.delete(data.get("id"))
                send_json(self, {"ok": True})
            elif action == "set_role":
                pstore.set_role(data.get("role"), data.get("id"))
                send_json(self, {"ok": True})
            else:
                send_json(self, {"ok": False, "error": "未知 action"}, 400)
            return

        send_json(self, {"ok": False, "error": "未知接口"}, 404)

    def log_message(self, *a):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("STARMAP_PORT", "8790"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("星图已启动: http://127.0.0.1:%d" % port)
    server.serve_forever()


if __name__ == "__main__":
    main()
