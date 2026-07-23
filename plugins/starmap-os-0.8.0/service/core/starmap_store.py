# -*- coding: utf-8 -*-
"""core/starmap_store.py — 星图存储内核（精简版）。

保留三个核心模块：
  对话收件箱 → conversation_pipeline
  知识管理   → KnowledgeStore
  废纸篓     → trash

无外部依赖，纯标准库。
"""
import os
import re
import json
import datetime
import threading
import hashlib

import conversation_pipeline as convmod
import trash as trashmod


def _today():
    return datetime.date.today().isoformat()


def _now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def _sanitize_id(s):
    # 保留中文与字母数字下划线连字符，仅剔除文件系统非法字符
    # （/ \ : * ? " < > | 与控制字符），避免中文领域名塌成 "x"
    s = re.sub(r'[\\/:*?"<>|\x00-\x1f\x7f]', "", str(s)).strip()
    return s or "default"


# --------------------------------------------------------------------------
# 知识管理（knowledge）：领域 / 笔记 / 链接
# --------------------------------------------------------------------------
class KnowledgeStore:
    def __init__(self, root):
        self.dir = os.path.join(root, "knowledge")
        os.makedirs(self.dir, exist_ok=True)
        self._lock = threading.RLock()

    def _rpath(self, name):
        safe = _sanitize_id(name) or "default"
        return os.path.join(self.dir, safe + ".json")

    def _load(self, name):
        path = self._rpath(name)
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {"name": name, "notes": [], "updated_at": ""}

    def _save(self, name, data):
        path = self._rpath(name)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)

    def index(self):
        domains = {}
        for fn in os.listdir(self.dir):
            if not fn.endswith(".json") or fn == "links.json":
                continue
            name = fn[:-5]
            data = self._load(name)
            domains[name] = {
                "name": name,
                "entry_count": len(data.get("notes", [])),
                "updated_at": data.get("updated_at", ""),
            }
        links = self._links()
        return {
            "domains": list(domains.values()),
            "notes": self._all_notes(),
            "links": links,
            "document_mirrors": 0,
        }

    def _all_notes(self):
        notes = []
        for fn in os.listdir(self.dir):
            if not fn.endswith(".json") or fn == "links.json":
                continue
            name = fn[:-5]
            data = self._load(name)
            for n in data.get("notes", []):
                n["domain"] = name
                notes.append(n)
        notes.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return notes

    def _links(self):
        path = os.path.join(self.dir, "links.json")
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return []

    def domain(self, name):
        data = self._load(name)
        if not data.get("notes"):
            return None
        return data

    def note(self, note_id):
        for fn in os.listdir(self.dir):
            if not fn.endswith(".json") or fn == "links.json":
                continue
            name = fn[:-5]
            data = self._load(name)
            for n in data.get("notes", []):
                if n.get("id") == note_id:
                    n["domain"] = name
                    return n
        return None

    def add_note(self, title, content, domain, note_id=None, kind="note",
                 artifact_id="", source=None, evidence=None, tags=None):
        with self._lock:
            data = self._load(domain)
            note = {
                "id": note_id or ("note_" + _now().replace(":", "").replace("-", "").replace("T", "_")),
                "title": title, "content": content, "domain": domain,
                "kind": kind, "artifact_id": artifact_id,
                "source": source or {}, "evidence": evidence or [],
                "tags": tags or [], "created_at": _now(), "updated_at": _now(),
            }
            data.setdefault("notes", []).append(note)
            data["updated_at"] = _now()
            self._save(domain, data)
            return note

    def add_link(self, title, url, domain=""):
        links = self._links()
        link = {
            "id": "link_" + _now().replace(":", "").replace("-", "").replace("T", "_"),
            "title": title, "url": url, "domain": domain, "created_at": _now(),
        }
        links.append(link)
        path = os.path.join(self.dir, "links.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(links, f, ensure_ascii=False, indent=2)
        return link

    def edit_note(self, note_id, title, content, domain, tags=None):
        for fn in os.listdir(self.dir):
            if not fn.endswith(".json") or fn == "links.json":
                continue
            name = fn[:-5]
            data = self._load(name)
            for n in data.get("notes", []):
                if n.get("id") == note_id:
                    if title is not None:
                        n["title"] = title
                    if content is not None:
                        n["content"] = content
                    if domain is not None and domain != name:
                        data["notes"] = [x for x in data["notes"] if x.get("id") != note_id]
                        self._save(name, data)
                        return self.add_note(title or n["title"], content or n["content"],
                                             domain, note_id=note_id, kind=n.get("kind", "note"),
                                             artifact_id=n.get("artifact_id", ""),
                                             source=n.get("source"), evidence=n.get("evidence"),
                                             tags=tags or n.get("tags"))
                    if tags is not None:
                        n["tags"] = tags
                    n["updated_at"] = _now()
                    n["domain"] = name
                    data["updated_at"] = _now()
                    self._save(name, data)
                    return n
        return None

    def remove_note(self, note_id):
        for fn in os.listdir(self.dir):
            if not fn.endswith(".json") or fn == "links.json":
                continue
            name = fn[:-5]
            data = self._load(name)
            for n in data.get("notes", []):
                if n.get("id") == note_id:
                    data["notes"] = [x for x in data["notes"] if x.get("id") != note_id]
                    data["updated_at"] = _now()
                    self._save(name, data)
                    return n
        return None


# --------------------------------------------------------------------------
# 项目共享记忆：只聚合已确认知识，保留版本和来源
# --------------------------------------------------------------------------
class ProjectStore:
    def __init__(self, root, conversations, knowledge):
        self.dir = os.path.join(root, "projects")
        self.index_path = os.path.join(self.dir, "index.json")
        os.makedirs(self.dir, exist_ok=True)
        self.conversations = conversations
        self.knowledge = knowledge
        self._lock = threading.RLock()

    @staticmethod
    def _unique(values):
        result = []
        for value in values:
            value = str(value or "").strip()
            if value and value not in result:
                result.append(value)
        return result

    def _read(self, path, default):
        if not os.path.exists(path):
            return default
        try:
            with open(path, encoding="utf-8") as handle:
                value = json.load(handle)
            return value
        except Exception:
            return default

    def _write(self, path, value):
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
        os.replace(tmp, path)

    def _index(self):
        value = self._read(self.index_path, {"schema_version": 1, "projects": []})
        return value if isinstance(value, dict) and isinstance(value.get("projects"), list) else {"schema_version": 1, "projects": []}

    def _path(self, project_id):
        return os.path.join(self.dir, _sanitize_id(project_id) + ".json")

    def create(self, name, goal=""):
        name = str(name or "").strip()[:80]
        goal = str(goal or "").strip()[:1000]
        if not name:
            raise ValueError("项目名称不能为空")
        with self._lock:
            project_id = "project_" + hashlib.sha256((name + _now()).encode("utf-8")).hexdigest()[:16]
            project = {"schema_version": 1, "id": project_id, "name": name, "goal": goal,
                       "status": "active", "session_ids": [], "created_at": _now(), "updated_at": _now()}
            self._write(self._path(project_id), project)
            index = self._index()
            index["projects"].insert(0, self._projection(project))
            index["updated_at"] = _now()
            self._write(self.index_path, index)
            self._refresh(project)
            return self.get(project_id)

    def exists(self, project_id):
        project = self._read(self._path(project_id), None)
        return bool(project and project.get("id") == project_id)

    def candidates(self, limit=30):
        items = self.list().get("items", [])[:max(1, min(int(limit), 50))]
        return [{key: item.get(key) for key in ("id", "name", "goal", "stage", "next_step")} for item in items]

    def list(self):
        items = []
        for item in self._index().get("projects", []):
            if item.get("status") == "deleted":
                continue
            try:
                project = self.get(item.get("id"))
                items.append(self._projection(project))
            except LookupError:
                continue
        return {"items": items, "total": len(items)}

    def get(self, project_id):
        project = self._read(self._path(project_id), None)
        if not project or project.get("id") != project_id:
            raise LookupError("未找到项目")
        return self._refresh(project)

    def assign_session(self, project_id, session_id):
        # 先确认会话真实存在，再改变项目状态。
        self.conversations.get(session_id)
        with self._lock:
            index = self._index()
            for item in index.get("projects", []):
                other = self._read(self._path(item.get("id")), None)
                if not other:
                    continue
                before = list(other.get("session_ids") or [])
                other["session_ids"] = [sid for sid in before if sid != session_id]
                if other.get("id") == project_id and session_id not in other["session_ids"]:
                    other["session_ids"].append(session_id)
                if other["session_ids"] != before:
                    other["updated_at"] = _now()
                    self._write(self._path(other["id"]), other)
                    self._refresh(other)
            return self.get(project_id)

    def unassign_session(self, project_id, session_id):
        with self._lock:
            project = self._read(self._path(project_id), None)
            if not project or project.get("id") != project_id:
                raise LookupError("未找到项目")
            before = list(project.get("session_ids") or [])
            project["session_ids"] = [sid for sid in before if sid != session_id]
            if project["session_ids"] != before:
                project["updated_at"] = _now()
                self._write(self._path(project_id), project)
                self._refresh(project)
            return self.get(project_id)

    def unassign_session_everywhere(self, session_id):
        """会话副本删除时清理项目引用，避免共享记忆保留幽灵会话。"""
        changed = 0
        with self._lock:
            for item in self._index().get("projects", []):
                project = self._read(self._path(item.get("id")), None)
                if not project or session_id not in (project.get("session_ids") or []):
                    continue
                project["session_ids"] = [sid for sid in project.get("session_ids", []) if sid != session_id]
                project["updated_at"] = _now()
                self._write(self._path(project["id"]), project)
                self._refresh(project)
                changed += 1
        return changed

    def delete(self, project_id):
        """软删除项目：保留文件和历史版本，避免误删无法恢复。"""
        with self._lock:
            project = self._read(self._path(project_id), None)
            if not project or project.get("id") != project_id:
                raise LookupError("未找到项目")
            session_ids = list(project.get("session_ids") or [])
            project.update({"status": "deleted", "deleted_at": _now(), "updated_at": _now(), "session_ids": []})
            self._write(self._path(project_id), project)
            self._update_projection(project)
            return {"id": project_id, "session_ids": session_ids, "deleted_at": project["deleted_at"]}

    def _build_memory(self, project):
        session_ids = project.get("session_ids") or []
        notes = [note for note in self.knowledge.index().get("notes", [])
                 if (note.get("source") or {}).get("session_id") in session_ids]
        completed, decisions, unresolved, next_steps, failed = [], [], [], [], []
        sources = []
        stage = "exploring"
        for session_id in session_ids:
            try:
                session = self.conversations.get(session_id)["session"]
            except LookupError:
                continue
            summary = session.get("conversation_summary") or {}
            checkpoint = session.get("checkpoint") or {}
            stage = summary.get("stage") or stage
            completed += checkpoint.get("completed") or summary.get("resolved") or []
            decisions += checkpoint.get("decisions") or []
            unresolved += checkpoint.get("unresolved") or summary.get("unresolved") or []
            next_steps += checkpoint.get("next_steps") or ([summary.get("next_step")] if summary.get("next_step") else [])
            for item in checkpoint.get("failed_attempts") or []:
                failed.append(item if isinstance(item, str) else "尝试：%s；原因：%s；经验：%s" % (
                    item.get("attempt", ""), item.get("reason", ""), item.get("lesson", "")))
            sources.append({"kind": "conversation", "session_id": session_id, "title": session.get("title", "")})
        for note in notes:
            if note.get("kind") == "decision":
                decisions.append(note.get("title") or note.get("content"))
            sources.append({"kind": "knowledge_note", "id": note.get("id"), "title": note.get("title", ""),
                            "session_id": (note.get("source") or {}).get("session_id", "")})
        return {"goal": project.get("goal", ""), "stage": stage,
                "completed": self._unique(completed), "decisions": self._unique(decisions),
                "failed_attempts": self._unique(failed), "unresolved": self._unique(unresolved),
                "next_steps": self._unique(next_steps),
                "confirmed_notes": [{key: note.get(key) for key in ("id", "title", "content", "domain", "kind", "tags")} for note in notes],
                "sources": sources, "generated_at": _now()}

    def _refresh(self, project):
        memory = self._build_memory(project)
        old = project.get("memory") or {}
        comparable = lambda value: {key: value.get(key) for key in ("goal", "stage", "completed", "decisions", "failed_attempts", "unresolved", "next_steps", "confirmed_notes", "sources")}
        if comparable(old) != comparable(memory):
            versions = project.get("memory_versions") or []
            if old:
                versions.append(old)
            project["memory_version"] = int(project.get("memory_version") or 0) + 1
            project["memory_versions"] = versions[-49:]
            project["memory"] = memory
            project["updated_at"] = _now()
            self._write(self._path(project["id"]), project)
            self._update_projection(project)
        return project

    def capsule(self, project_id, question=""):
        project = self.get(project_id)
        memory = project.get("memory") or {}
        lines = ["# 项目上下文胶囊", "", "项目：%s" % project["name"], "目标：%s" % (project.get("goal") or "未填写"),
                 "当前阶段：%s" % memory.get("stage", "exploring")]
        for title, key in (("已完成", "completed"), ("已确认决策", "decisions"), ("失败方案及原因", "failed_attempts"),
                           ("未解决问题", "unresolved"), ("下一步", "next_steps")):
            values = memory.get(key) or []
            if values:
                lines += ["", "## " + title] + ["- " + value for value in values]
        notes = memory.get("confirmed_notes") or []
        if notes:
            lines += ["", "## 已确认知识"] + ["- %s：%s" % (n.get("title", ""), n.get("content", "")) for n in notes]
        if question:
            lines += ["", "## 本次任务", question.strip()[:2000]]
        text = "\n".join(lines)
        return {"project_id": project_id, "text": text, "estimated_tokens": max(1, len(text) // 2),
                "source_count": len(memory.get("sources") or []), "memory_version": project.get("memory_version", 1)}

    def _projection(self, project):
        memory = project.get("memory") or {}
        return {"id": project.get("id"), "name": project.get("name"), "goal": project.get("goal"),
                "status": project.get("status"), "stage": memory.get("stage", "exploring"),
                "session_count": len(project.get("session_ids") or []),
                "note_count": len(memory.get("confirmed_notes") or []),
                "unresolved_count": len(memory.get("unresolved") or []),
                "next_step": (memory.get("next_steps") or [""])[0], "updated_at": project.get("updated_at")}

    def _update_projection(self, project):
        index = self._index()
        items = [item for item in index.get("projects", []) if item.get("id") != project.get("id")]
        items.append(self._projection(project))
        items.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
        index.update({"projects": items, "updated_at": _now()})
        self._write(self.index_path, index)


# --------------------------------------------------------------------------
# 星图存储内核（三入口聚合）
# --------------------------------------------------------------------------
class StarmapStore:
    def __init__(self, data_dir, knowledge=None, provider_store=None, kb=None, kb_index_path=None, classifier=None):
        self.data_dir = os.path.abspath(data_dir)
        self.root = os.path.join(self.data_dir, "starmap")
        os.makedirs(self.root, exist_ok=True)
        self.kb = kb
        self.kb_index_path = kb_index_path
        self.knowledge = knowledge or KnowledgeStore(self.root)
        self.trash = trashmod.TrashStore(self.root)
        self.conversations = convmod.ConversationStore(
            data_dir,
            knowledge=self.knowledge,
            kb=kb, kb_index_path=kb_index_path,
        )
        self.projects = ProjectStore(self.root, self.conversations, self.knowledge)
        self.conversations.project_validator = self.projects.exists

    def delete_conversation(self, session_id):
        deleted = self.conversations.delete(session_id)
        deleted["projects_unlinked"] = self.projects.unassign_session_everywhere(session_id)
        return deleted

    def overview(self):
        conv = self.conversations.stats()
        know = self.knowledge.index()
        trash = self.trash.list()
        return {
            "conversations": conv,
            "knowledge": {
                "domains": len(know.get("domains", [])),
                "notes": len(know.get("notes", [])),
            },
            "trash": {"total": len(trash)},
        }

    def recap(self, days=7):
        """周复盘（离线统计版）：按领域汇总知识库、统计近 N 天新增、附对话概况。

        纯统计，不依赖 LLM；配置 API Key 后前端可在此基础上叠加 AI 周报。
        """
        import datetime as _dt
        know = self.knowledge.index()
        notes = know.get("notes", [])
        cutoff = _dt.datetime.now() - _dt.timedelta(days=days)
        period_notes = []
        by_domain = {}
        for n in notes:
            ca = n.get("created_at")
            if ca:
                try:
                    if _dt.datetime.fromisoformat(ca) >= cutoff:
                        period_notes.append(n)
                        d = n.get("domain") or "综合"
                        by_domain[d] = by_domain.get(d, 0) + 1
                except Exception:
                    pass
        knowledge_kinds = {"knowledge", "note", "decision", "goal", "question", "profile"}
        skill_kinds = {"action", "reasoning_summary", "reasoning_process", "reasoned_content"}
        knowledge = [n for n in period_notes if str(n.get("kind") or "note") in knowledge_kinds]
        skills = [n for n in period_notes if str(n.get("kind") or "note") in skill_kinds]
        conv = self.conversations.stats()
        return {
            "period_days": days,
            "total_notes": len(notes),
            "period_notes": len(period_notes),
            "week_notes": len(period_notes),
            "by_domain": [{"domain": k, "count": v} for k, v in sorted(by_domain.items(), key=lambda x: -x[1])],
            "knowledge": knowledge[:50],
            "skills": skills[:50],
            "recent_notes": period_notes[:50],
            "conversations": conv,
        }

    def list_trash(self):
        return self.trash.list()

    def restore_trash(self, trash_id):
        rec = self.trash.get(trash_id)
        if not rec:
            return None
        zone = rec["zone"]
        if zone == "knowledge_note":
            if rec.get("mode") == "object":
                note = rec.get("payload") or {}
                restored = self.knowledge.add_note(
                    note.get("title", ""), note.get("content", ""), note.get("domain") or "综合",
                    note_id=note.get("id") or rec.get("ref_id"), kind=note.get("kind", "note"),
                    artifact_id=note.get("artifact_id", ""), source=note.get("source"),
                    evidence=note.get("evidence"), tags=note.get("tags"),
                )
                self._index_note(restored)
                self.trash.remove_record(trash_id)
            else:
                self.trash.restore_files(rec)
                self.trash.remove_record(trash_id)
            return {"zone": zone, "ref_id": rec["ref_id"]}
        return None

    def purge_trash(self, trash_id):
        return self.trash.purge(trash_id)

    def empty_trash(self):
        return self.trash.empty()

    def delete_note(self, note_id):
        note = self.knowledge.note(note_id)
        if note is None:
            return None
        # 先落废纸篓，再移出知识库：任何后续失败都至少保留一份可恢复数据。
        rec = self.trash.add_object(
            zone="knowledge_note", ref_id=note_id,
            label=note.get("title", ""),
            payload=note,
        )
        removed = self.knowledge.remove_note(note_id)
        if removed is None:
            self.trash.purge(rec["trash_id"])
            return None
        if self.kb is not None:
            self.kb.docs.pop("starmap-artifact:%s" % note.get("artifact_id", ""), None)
            self.kb.docs.pop("starmap-note:%s" % note_id, None)
            if self.kb_index_path:
                self.kb.save(self.kb_index_path)
        return rec

    def _index_note(self, note):
        if self.kb is None or not self.kb_index_path:
            return
        doc_id = "starmap-artifact:%s" % note.get("artifact_id") if note.get("artifact_id") else "starmap-note:%s" % note["id"]
        self.kb.add_text(doc_id, note.get("content", ""), title=note.get("title", ""),
                         source="conversation:%s" % (note.get("source") or {}).get("session_id", ""), kind=note.get("kind", "note"))
        if doc_id in self.kb.docs:
            self.kb.docs[doc_id]["category"] = note.get("domain", "综合")
            self.kb.docs[doc_id]["tags"] = note.get("tags") or []
        self.kb.save(self.kb_index_path)

    def edit_note(self, note_id, title, content, domain, tags=None):
        return self.knowledge.edit_note(note_id, title, content, domain, tags)
