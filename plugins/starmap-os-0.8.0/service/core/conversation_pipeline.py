# -*- coding: utf-8 -*-
"""Hanako 对话收件箱、候选资产分类、人工审核与发布。

原始消息是唯一真源；分类结果是可重建的候选资产。任何下游写入都必须经过
``confirm`` 审核，Hanako 返回值不能自行改变状态、执行 skill 或指定 URL。
"""
from __future__ import annotations

import copy
import datetime
import hashlib
import json
import os
import re
import shutil
import tempfile
import threading


SCHEMA_VERSION = 1
MAX_AI_ARTIFACTS = 8
ARTIFACT_TYPES = {
    "knowledge", "decision", "action", "question", "goal", "profile",
    "reasoning_process", "reasoned_content", "reasoning_summary",
}
ARTIFACT_STATUSES = {"pending_review", "confirmed", "rejected"}
REVIEW_ACTIONS = {"confirm", "reject", "edit"}
CONVERSATION_STAGES = {"exploring", "direction_set", "action_ready", "blocked", "deep_dive", "archive_ready"}
CONVERSATION_RECOMMENDATIONS = {"continue", "new_session", "archive"}
BLOCKED_SESSION_KINDS = {
    "automation", "subagent", "heartbeat", "cron", "starmap-task", "utility", "system",
}
DEFAULT_DESTINATION = {
    "knowledge": "knowledge", "decision": "knowledge", "question": "knowledge",
    "action": "knowledge", "goal": "knowledge", "profile": "knowledge",
    "reasoning_process": "knowledge", "reasoned_content": "knowledge", "reasoning_summary": "knowledge",
}
DESTINATIONS_BY_TYPE = {
    "knowledge": {"knowledge"},
    "decision": {"knowledge"},
    "question": {"knowledge"},
    "action": {"knowledge", "daily", "workflow"},
    "goal": {"knowledge", "roadmap"},
    "profile": {"knowledge", "profile"},
    "reasoning_process": {"knowledge"},
    "reasoned_content": {"knowledge"},
    "reasoning_summary": {"knowledge"},
}
TYPE_LABELS = {
    "knowledge": "知识", "decision": "决策", "action": "行动",
    "question": "待解问题", "goal": "目标线索", "profile": "个人线索",
    "reasoning_process": "推理过程", "reasoned_content": "推理内容", "reasoning_summary": "完整思考总结",
}
REASONING_TYPES = {"reasoning_process", "reasoned_content", "reasoning_summary"}

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_EFFECTIVE_RE = re.compile(r"[\u4e00-\u9fffA-Za-z0-9]")
_SENTENCE_RE = re.compile(r"[^\n。！？!?;；]+[\n。！？!?;；]?")
_DECISION_RE = re.compile(r"决定|确定|统一为|采用|选择|结论|最终|就按|不再")
_ACTION_RE = re.compile(r"下一步|需要|应该|待办|TODO|计划|请完成|要增加|要修改|要删除|实现|开发|测试", re.I)
_QUESTION_RE = re.compile(r"[？?]|是否|怎么|为什么|哪个|待确认|不确定|需不需要")
_GOAL_RE = re.compile(r"我的目标|希望成为|本阶段目标|长期目标|想要达成|计划在")
_PROFILE_RE = re.compile(r"我喜欢|我偏好|我希望|我不喜欢|我更倾向|对我来说|我习惯")


class ConversationValidationError(ValueError):
    """会话输入或审核操作不符合产品边界。"""


def _now():
    return datetime.datetime.now(datetime.timezone.utc).astimezone().isoformat(timespec="seconds")


def _text(value, limit, field, required=False):
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ConversationValidationError("%s 必须是字符串" % field)
    value = _CONTROL_RE.sub("", value).strip()
    if required and not value:
        raise ConversationValidationError("%s 不能为空" % field)
    if len(value) > limit:
        raise ConversationValidationError("%s 超过 %d 字符上限" % (field, limit))
    return value


def _hash(*parts):
    joined = "\x1f".join(str(part or "") for part in parts)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


def _quality_ok(content):
    """质量门禁（A1 · 防虚假内容）：过短 / 无有效字符 / 纯重复 → 不进收件箱。"""
    text = (content or "").strip()
    if len(text) < 12:
        return False
    if not _EFFECTIVE_RE.search(text):
        return False
    if len(set(text)) <= 2 and len(text) >= 12:
        return False
    return True


def _atomic_json(path, value):
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=".starmap-", suffix=".tmp", dir=directory)
    try:
        if os.name == "posix":
            os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    except Exception:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


def _read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            value = json.load(handle)
        return value
    except (OSError, ValueError, TypeError):
        return default


def _json_object(value):
    if isinstance(value, dict):
        return value
    if not isinstance(value, str):
        raise ConversationValidationError("Hanako 分类结果必须是 JSON 对象")
    if len(value) > 500000:
        raise ConversationValidationError("Hanako 分类结果过大")
    source = value.strip()
    fenced = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", source, re.I)
    if fenced:
        source = fenced.group(1)
    try:
        parsed = json.loads(source)
    except ValueError:
        match = re.search(r"\{[\s\S]*\}", source)
        if not match:
            raise ConversationValidationError("Hanako 分类结果不是有效 JSON")
        try:
            parsed = json.loads(match.group(0))
        except ValueError as error:
            raise ConversationValidationError("Hanako 分类结果不是有效 JSON") from error
    if not isinstance(parsed, dict):
        raise ConversationValidationError("Hanako 分类结果必须是 JSON 对象")
    return parsed


class ConversationStore:
    def __init__(self, data_dir, classifier=None, knowledge=None, daily=None, roadmap=None,
                 kb=None, kb_index_path=None, activity=None, loop=None, migrate_legacy=True,
                 provider_store=None):
        self.data_dir = os.path.abspath(data_dir)
        self.root = os.path.join(self.data_dir, "starmap", "conversations")
        self.sessions_dir = os.path.join(self.root, "sessions")
        self.index_path = os.path.join(self.root, "index.json")
        self.migration_path = os.path.join(self.root, "migration.json")
        self.workflows_dir = os.path.join(self.data_dir, "starmap", "workflows", "drafts")
        for directory in (self.sessions_dir, self.workflows_dir):
            os.makedirs(directory, exist_ok=True)
        self.knowledge = knowledge
        self.daily = daily
        self.roadmap = roadmap
        self.kb = kb
        self.kb_index_path = kb_index_path
        self.activity = activity
        self.loop = loop
        self.project_validator = None
        self._lock = threading.RLock()
        if migrate_legacy:
            self._migrate_legacy()

    # ---------------- 公开读接口 ----------------
    def stats(self):
        index = self._index()
        sessions = index.get("sessions", [])
        artifacts = []
        for session in sessions[:200]:
            try:
                artifacts.extend(self.get(session["session_id"])["artifacts"])
            except (KeyError, LookupError, ValueError):
                continue
        reviewed = [item for item in artifacts if item.get("status") in {"confirmed", "rejected"}]
        review_seconds = []
        for item in reviewed:
            try:
                created = datetime.datetime.fromisoformat(item.get("created_at", ""))
                reviewed_at = datetime.datetime.fromisoformat(item.get("reviewed_at", ""))
                review_seconds.append(max(0, (reviewed_at - created).total_seconds()))
            except (TypeError, ValueError):
                continue
        total = len(artifacts)
        confirmed = sum(item.get("status") == "confirmed" for item in artifacts)
        return {
            "sessions": len(sessions),
            "pending_sessions": sum(item.get("status") == "pending_review" for item in sessions),
            "processed_sessions": sum(item.get("status") == "processed" for item in sessions),
            "messages": sum(int(item.get("message_count", 0)) for item in sessions),
            "artifacts": sum(int(item.get("artifact_count", 0)) for item in sessions),
            "pending_artifacts": sum(int(item.get("pending_count", 0)) for item in sessions),
            "confirmed_artifacts": sum(int(item.get("confirmed_count", 0)) for item in sessions),
            "pending_ai_sessions": sum(item.get("extraction_status") == "pending_ai" for item in sessions),
            "failed_ai_sessions": sum(item.get("extraction_status") == "failed" for item in sessions),
            "avg_artifacts_per_session": round(total / len(sessions), 1) if sessions else 0,
            "confirmation_rate": round(confirmed / total * 100, 1) if total else 0,
            "avg_review_seconds": round(sum(review_seconds) / len(review_seconds), 1) if review_seconds else 0,
            "mvp_targets": {"max_cards_per_session": MAX_AI_ARTIFACTS, "min_confirmation_rate": 30, "max_review_seconds": 60},
        }

    def list(self, status=None, limit=100):
        if status is not None and status not in {"captured", "pending_review", "processed"}:
            raise ConversationValidationError("未知会话状态")
        try:
            limit = max(1, min(int(limit), 200))
        except (TypeError, ValueError):
            raise ConversationValidationError("limit 必须是整数")
        items = self._index().get("sessions", [])
        if status:
            items = [item for item in items if item.get("status") == status]
        return {"items": [dict(item) for item in items[:limit]], "stats": self.stats()}

    def get(self, session_id):
        session_id = _text(session_id, 200, "session_id", required=True)
        key = self._session_key(session_id)
        directory = os.path.join(self.sessions_dir, key)
        session = _read_json(os.path.join(directory, "session.json"), None)
        if not session or session.get("session_id") != session_id:
            raise LookupError("未找到该会话")
        messages = _read_json(os.path.join(directory, "messages.json"), {"items": []}).get("items", [])
        artifacts = _read_json(os.path.join(directory, "artifacts.json"), {"items": []}).get("items", [])
        return {"session": session, "messages": messages, "artifacts": artifacts}

    def delete(self, session_id):
        """删除星图中的会话副本；Hanako 原会话不在本存储范围内。"""
        session_id = _text(session_id, 200, "session_id", required=True)
        with self._lock:
            detail = self.get(session_id)
            directory = os.path.join(self.sessions_dir, self._session_key(session_id))
            # get 已验证目录内 session_id；再校验父目录，避免路径范围扩大。
            if os.path.dirname(os.path.abspath(directory)) != os.path.abspath(self.sessions_dir):
                raise ConversationValidationError("会话目录不安全")
            shutil.rmtree(directory)
            index = self._index()
            index["sessions"] = [item for item in index.get("sessions", [])
                                 if item.get("session_id") != session_id]
            index["updated_at"] = _now()
            _atomic_json(self.index_path, index)
            return {"session_id": session_id, "title": detail["session"].get("title", ""),
                    "deleted_at": _now()}

    # ---------------- 同步与分类 ----------------
    def sync(self, payload):
        if not isinstance(payload, dict):
            raise ConversationValidationError("同步请求必须是对象")
        source = _text(payload.get("source") or "hanako", 40, "source", required=True)
        if source not in {"hanako", "backfill", "manual", "legacy"}:
            raise ConversationValidationError("不支持的对话来源")
        session_input = payload.get("session")
        if not isinstance(session_input, dict):
            raise ConversationValidationError("缺少 session 对象")
        session = self._normalize_session(session_input, source)
        raw_messages = payload.get("messages") or []
        if not isinstance(raw_messages, list):
            raise ConversationValidationError("messages 必须是数组")
        if len(raw_messages) > 500:
            raise ConversationValidationError("单次最多同步 500 条消息")

        with self._lock:
            directory = os.path.join(self.sessions_dir, self._session_key(session["session_id"]))
            os.makedirs(directory, exist_ok=True)
            old_session = _read_json(os.path.join(directory, "session.json"), {})
            messages_doc = _read_json(
                os.path.join(directory, "messages.json"), {"schema_version": SCHEMA_VERSION, "items": []}
            )
            artifacts_doc = _read_json(
                os.path.join(directory, "artifacts.json"), {"schema_version": SCHEMA_VERSION, "items": []}
            )
            messages = messages_doc.get("items", []) if isinstance(messages_doc.get("items"), list) else []
            artifacts = artifacts_doc.get("items", []) if isinstance(artifacts_doc.get("items"), list) else []
            known = {item.get("dedupe_key") for item in messages if item.get("dedupe_key")}
            added = []
            total_chars = 0
            for ordinal, raw in enumerate(raw_messages):
                message = self._normalize_message(raw, session["session_id"], ordinal)
                total_chars += len(message["content"])
                if total_chars > 2 * 1024 * 1024:
                    raise ConversationValidationError("单次同步消息文本超过 2 MiB")
                if message["dedupe_key"] in known:
                    continue
                # 0.7.0 以前 history source_id 含滑动窗口序号。升级后只在旧 ID
                # 明确匹配且角色/正文/思考完全相同时原地换成稳定 ID，避免真实原文重复。
                legacy = next((item for item in messages
                    if re.match(r"^history:\d+:[0-9a-f]{20}$", str(item.get("source_id") or ""))
                    and str(message.get("source_id") or "").startswith("history:")
                    and item.get("role") == message.get("role")
                    and item.get("content") == message.get("content")
                    and (item.get("thinking") or "") == (message.get("thinking") or "")), None)
                if legacy is not None:
                    known.discard(legacy.get("dedupe_key"))
                    legacy["source_id"] = message["source_id"]
                    legacy["dedupe_key"] = message["dedupe_key"]
                    known.add(message["dedupe_key"])
                    continue
                known.add(message["dedupe_key"])
                messages.append(message)
                added.append(message)
            if len(messages) > 10000:
                raise ConversationValidationError("单会话消息数超过 10000 条安全上限")

            now = _now()
            merged_session = {
                **old_session, **session,
                "schema_version": SCHEMA_VERSION,
                "created_at": old_session.get("created_at") or now,
                "updated_at": now,
                "last_sync_at": now,
                "message_count": len(messages),
            }
            warnings = []
            mode = "none"
            new_artifacts = []
            complete_turn = bool(payload.get("complete_turn", True))
            hanako_result = payload.get("hanako_result")
            extraction_error = _text(payload.get("extraction_error") or "", 500, "extraction_error")
            if complete_turn and hanako_result:
                parsed = _json_object(hanako_result)
                new_artifacts = self._from_hanako(parsed, session["session_id"], messages)
                checkpoint = self._checkpoint(parsed, messages, old_session.get("checkpoint"))
                mode = "hanako"
                # 完整会话会在每轮重新提炼；审核前只保留最新候选，防止逐轮堆积。
                artifacts = [item for item in artifacts if item.get("status") != "pending_review"]
                artifacts = self._merge_artifacts(artifacts, new_artifacts)
                merged_session["conversation_summary"] = self._conversation_summary(parsed)
                # 项目归属由 Hanako AI 建议，但用户已经确认的 project_id 永远优先。
                if not old_session.get("project_id"):
                    suggestion = self._project_suggestion(parsed)
                    if suggestion is not None:
                        merged_session["project_suggestion"] = suggestion
                # checkpoint 是可选的向前兼容字段。只有通过完整契约校验的新版本
                # 才能替换旧值；缺失字段不会清空已保存的稳定检查点。
                if checkpoint is not None:
                    merged_session["checkpoint"] = checkpoint
                merged_session["extraction_status"] = "ready"
                merged_session["extraction_error"] = ""
                merged_session["last_extracted_at"] = now
            elif complete_turn and extraction_error:
                merged_session["extraction_status"] = "failed"
                merged_session["extraction_error"] = extraction_error
                warnings.append(extraction_error)
            else:
                # 原文先可靠落盘；AI 提炼由插件的第二阶段请求完成。
                # Hanako 可能重复发送同一个 turn_end；没有新消息时不能把 ready 降回 pending。
                if added or not old_session.get("last_extracted_at"):
                    merged_session["extraction_status"] = "pending_ai"
                    merged_session["extraction_error"] = ""
                elif old_session.get("extraction_status") == "pending_ai":
                    merged_session["extraction_status"] = "ready"

            merged_session = self._apply_session_status(merged_session, artifacts)
            _atomic_json(os.path.join(directory, "messages.json"), {
                "schema_version": SCHEMA_VERSION, "items": messages,
            })
            _atomic_json(os.path.join(directory, "artifacts.json"), {
                "schema_version": SCHEMA_VERSION, "items": artifacts,
            })
            _atomic_json(os.path.join(directory, "session.json"), merged_session)
            self._update_index(merged_session, artifacts)
            return {
                "session": self._session_projection(merged_session, artifacts),
                "added_messages": len(added), "artifacts_created": len(new_artifacts),
                "mode": mode, "warnings": warnings,
            }

    def sync_manual(self, payload):
        raise ConversationValidationError("手动本地采集已关闭；请通过 Hanako AI 插件同步对话")

    def resolve_project(self, session_id, status, project_id=None):
        session_id = _text(session_id, 200, "session_id", required=True)
        status = _text(status, 20, "status", required=True)
        if status not in {"accepted", "changed", "dismissed"}:
            raise ConversationValidationError("项目建议状态无效")
        if status != "dismissed":
            project_id = _text(project_id, 80, "project_id", required=True)
            if self.project_validator and not self.project_validator(project_id):
                raise ConversationValidationError("项目不存在")
        else:
            project_id = ""
        with self._lock:
            detail = self.get(session_id)
            session, artifacts = detail["session"], detail["artifacts"]
            session["project_id"] = project_id
            session["project_suggestion_status"] = status
            session["project_confirmed_at"] = _now()
            if isinstance(session.get("project_suggestion"), dict):
                session["project_suggestion"]["status"] = status
            session["updated_at"] = _now()
            directory = os.path.join(self.sessions_dir, self._session_key(session_id))
            _atomic_json(os.path.join(directory, "session.json"), session)
            self._update_index(session, artifacts)
            return self._session_projection(session, artifacts)

    # ---------------- 审核与发布 ----------------
    def review(self, payload):
        if not isinstance(payload, dict):
            raise ConversationValidationError("审核请求必须是对象")
        session_id = _text(payload.get("session_id"), 200, "session_id", required=True)
        decisions = payload.get("decisions") or []
        if not isinstance(decisions, list) or not decisions or len(decisions) > 100:
            raise ConversationValidationError("decisions 必须是 1-100 项数组")
        with self._lock:
            detail = self.get(session_id)
            # 审核可能一次提交多项。先在副本中完成全部校验，避免后面的非法项
            # 让前面的合法项已经发布，形成用户看不见的“半成功”状态。
            session = copy.deepcopy(detail["session"])
            artifacts = copy.deepcopy(detail["artifacts"])
            by_id = {item.get("id"): item for item in artifacts}
            changed = []
            published_now = False
            prepared = []
            seen = set()
            for raw in decisions:
                if not isinstance(raw, dict):
                    raise ConversationValidationError("审核项必须是对象")
                artifact_id = _text(raw.get("artifact_id"), 80, "artifact_id", required=True)
                if artifact_id in seen:
                    raise ConversationValidationError("同一候选资产不能在一次请求中重复审核")
                seen.add(artifact_id)
                action = _text(raw.get("action"), 20, "action", required=True)
                if action not in REVIEW_ACTIONS:
                    raise ConversationValidationError("审核动作只能是 confirm / reject / edit")
                artifact = by_id.get(artifact_id)
                if not artifact:
                    raise ConversationValidationError("候选资产不存在：%s" % artifact_id)
                if artifact.get("status") == "confirmed" and artifact.get("published"):
                    if action != "confirm":
                        raise ConversationValidationError("已发布资产不能再编辑或驳回")
                    for field in ("type", "title", "content", "domain", "destination"):
                        if field in raw and str(raw.get(field) or "").strip() != str(artifact.get(field) or "").strip():
                            raise ConversationValidationError("已发布资产不能改变内容或去向")
                self._apply_edits(artifact, raw)
                if action == "reject":
                    if artifact.get("status") == "confirmed" and artifact.get("published"):
                        raise ConversationValidationError("已发布资产不能直接驳回")
                    artifact["status"] = "rejected"
                    artifact["reviewed_at"] = _now()
                elif action == "edit":
                    if artifact.get("status") not in ARTIFACT_STATUSES:
                        artifact["status"] = "pending_review"
                    artifact["updated_at"] = _now()
                prepared.append((artifact, action))
                changed.append(artifact_id)

            # 所有项都通过边界校验之后才允许产生下游写入。
            for artifact, action in prepared:
                if action != "confirm":
                    continue
                if not artifact.get("published"):
                    artifact["published"] = self._publish(artifact, session)
                    published_now = True
                artifact["status"] = "confirmed"
                artifact["reviewed_at"] = _now()

            session["updated_at"] = _now()
            session = self._apply_session_status(session, artifacts)
            directory = os.path.join(self.sessions_dir, self._session_key(session_id))
            _atomic_json(os.path.join(directory, "artifacts.json"), {
                "schema_version": SCHEMA_VERSION, "items": artifacts,
            })
            _atomic_json(os.path.join(directory, "session.json"), session)
            self._update_index(session, artifacts)
            if self.activity and published_now:
                self.activity.record("确认对话资产")
            return {"session": self._session_projection(session, artifacts), "changed": changed}

    def review_context(self, limit=100):
        rows = []
        for projection in self._index().get("sessions", [])[:200]:
            try:
                detail = self.get(projection["session_id"])
            except LookupError:
                continue
            for item in detail["artifacts"]:
                if item.get("status") == "confirmed":
                    rows.append(item)
                    if len(rows) >= limit:
                        break
            if len(rows) >= limit:
                break
        grouped = {key: [] for key in ARTIFACT_TYPES}
        for item in rows:
            grouped[item["type"]].append(item.get("content") or item.get("title") or "")
        return {"confirmed_count": len(rows), **grouped}

    # ---------------- 验证 / 提取 ----------------
    def _normalize_session(self, value, source):
        session_id = _text(
            value.get("session_id") or value.get("id"), 200, "session.session_id", required=True
        )
        visibility = _text(value.get("visibility") or "public", 40, "session.visibility")
        owner = _text(value.get("owner_plugin_id") or value.get("ownerPluginId") or "", 100, "session.owner_plugin_id")
        kind = _text(value.get("kind") or "desktop", 80, "session.kind")
        if visibility != "public":
            raise ConversationValidationError("只允许同步公开用户会话")
        if owner:
            raise ConversationValidationError("不同步任何插件拥有的会话")
        if kind.lower() in BLOCKED_SESSION_KINDS:
            raise ConversationValidationError("不同步自动任务或子会话")
        return {
            "session_id": session_id,
            "source": source,
            "title": _text(value.get("title") or "未命名对话", 200, "session.title") or "未命名对话",
            "agent_id": _text(value.get("agent_id") or value.get("agentId") or "", 120, "session.agent_id"),
            "agent_name": _text(value.get("agent_name") or value.get("agentName") or "Hanako", 120, "session.agent_name"),
            "visibility": "public", "kind": kind or "desktop", "owner_plugin_id": "",
        }

    def _normalize_message(self, raw, session_id, ordinal):
        if not isinstance(raw, dict):
            raise ConversationValidationError("messages[%d] 必须是对象" % ordinal)
        role = _text(raw.get("role"), 20, "messages[%d].role" % ordinal, required=True).lower()
        if role not in {"user", "assistant"}:
            raise ConversationValidationError("只保存 user / assistant 可见消息")
        content = _text(raw.get("content"), 100000, "messages[%d].content" % ordinal, required=True)
        thinking = _text(raw.get("thinking") or raw.get("reasoning") or raw.get("reasoning_content"), 100000, "messages[%d].thinking" % ordinal)
        source_id = _text(raw.get("source_id") or raw.get("id") or "", 240, "messages[%d].source_id" % ordinal)
        timestamp = _text(raw.get("created_at") or raw.get("timestamp") or "", 80, "messages[%d].timestamp" % ordinal)
        sequence = raw.get("sequence")
        if sequence is not None and (not isinstance(sequence, int) or isinstance(sequence, bool) or sequence < 0):
            raise ConversationValidationError("message.sequence 必须是非负整数")
        basis = source_id or "%s|%s|%s|%s" % (sequence if sequence is not None else ordinal, timestamp, role, content)
        dedupe_key = _hash(session_id, basis)
        message_id = "msg_" + dedupe_key[:24]
        normalized = {
            "id": message_id, "source_id": source_id, "dedupe_key": dedupe_key,
            "role": role, "content": content, "created_at": timestamp or _now(),
        }
        if thinking:
            normalized["thinking"] = thinking
        return normalized

    def _from_hanako(self, value, session_id, messages):
        parsed = _json_object(value)
        items = parsed.get("artifacts")
        if not isinstance(items, list) or len(items) > MAX_AI_ARTIFACTS:
            raise ConversationValidationError("Hanako artifacts 必须是 0-%d 项数组" % MAX_AI_ARTIFACTS)
        # 模型偶尔会把流式小段思考各自制卡。只保留一张完整思考总结；
        # 若模型已给 reasoning_summary，优先采用它，否则把碎片合并为一张候选。
        reasoning = [item for item in items if isinstance(item, dict) and str(item.get("type") or "").lower() in REASONING_TYPES]
        regular = [item for item in items if not (isinstance(item, dict) and str(item.get("type") or "").lower() in REASONING_TYPES)]
        if reasoning:
            summary = next((copy.deepcopy(item) for item in reasoning if str(item.get("type") or "").lower() == "reasoning_summary"), None)
            if summary is None:
                summary = copy.deepcopy(reasoning[0])
                contents = [_text(item.get("content"), 4000, "artifact.content", required=True) for item in reasoning]
                summary["title"] = "完整思考总结"
                summary["content"] = "\n".join(dict.fromkeys(contents))[:4000]
                summary["evidence"] = list(dict.fromkeys(ref for item in reasoning for ref in (item.get("evidence") or [])))[:20]
            summary["type"] = "reasoning_summary"
            items = regular + [summary]
        result = []
        for index, raw in enumerate(items):
            if not isinstance(raw, dict):
                raise ConversationValidationError("Hanako artifact[%d] 必须是对象" % index)
            kind = _text(raw.get("type"), 30, "artifact.type", required=True).lower()
            if kind not in ARTIFACT_TYPES:
                raise ConversationValidationError("Hanako artifact.type 不在允许列表")
            evidence_raw = raw.get("evidence") or []
            if not isinstance(evidence_raw, list) or not evidence_raw or len(evidence_raw) > 20:
                raise ConversationValidationError("Hanako artifact.evidence 必须引用本轮消息")
            evidence = []
            message_ids = {item["id"] for item in messages}
            source_to_id = {item.get("source_id"): item["id"] for item in messages if item.get("source_id")}
            for ref in evidence_raw:
                if isinstance(ref, int) and not isinstance(ref, bool) and 0 <= ref < len(messages):
                    evidence.append(messages[ref]["id"])
                elif isinstance(ref, str) and ref in message_ids:
                    evidence.append(ref)
                elif isinstance(ref, str) and ref in source_to_id:
                    evidence.append(source_to_id[ref])
            evidence = list(dict.fromkeys(evidence))
            if not evidence:
                raise ConversationValidationError("Hanako artifact.evidence 没有有效消息引用")
            confidence = raw.get("confidence", 0.8)
            if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
                confidence = 0.8
            confidence = max(0.0, min(float(confidence), 1.0))
            useful = raw.get("useful", True)
            if isinstance(useful, str):
                useful = useful.strip().lower() not in ("false", "0", "no", "无用", "否", "n")
            elif not isinstance(useful, bool):
                useful = True
            artifact = self._artifact(
                session_id, kind,
                _text(raw.get("title"), 120, "artifact.title", required=True),
                _text(raw.get("content"), 4000, "artifact.content", required=True),
                evidence, domain=_text(raw.get("domain") or "综合", 40, "artifact.domain") or "综合",
                tags=self._tags(raw.get("tags")), confidence=confidence, mode="hanako",
            )
            # AI 自审：无价值内容直接过滤，不进入人工审核队列。
            if not useful:
                artifact["status"] = "rejected"
                artifact["auto_filtered"] = True
                artifact["reviewed_at"] = _now()
            result.append(artifact)
        return result

    def _conversation_summary(self, parsed):
        raw = parsed.get("conversation_summary") or {}
        if not isinstance(raw, dict):
            raw = {}
        stage = _text(raw.get("stage") or "exploring", 40, "conversation_summary.stage").lower()
        if stage not in CONVERSATION_STAGES:
            stage = "exploring"
        recommendation = _text(raw.get("recommendation") or "continue", 40, "conversation_summary.recommendation").lower()
        if recommendation not in CONVERSATION_RECOMMENDATIONS:
            recommendation = "continue"
        def text_list(key):
            values = raw.get(key) or []
            if not isinstance(values, list):
                return []
            return [_text(item, 300, "conversation_summary.%s" % key) for item in values[:8] if isinstance(item, str) and item.strip()]
        return {
            "one_liner": _text(raw.get("one_liner") or "", 300, "conversation_summary.one_liner"),
            "stage": stage,
            "resolved": text_list("resolved"),
            "unresolved": text_list("unresolved"),
            "next_step": _text(raw.get("next_step") or "", 500, "conversation_summary.next_step"),
            "recommendation": recommendation,
            "domains": self._tags(raw.get("domains")),
        }

    def _project_suggestion(self, parsed):
        if "project_suggestion" not in parsed or parsed.get("project_suggestion") is None:
            return None
        raw = parsed.get("project_suggestion")
        if not isinstance(raw, dict):
            raise ConversationValidationError("project_suggestion 必须是对象")
        project_id = _text(raw.get("project_id") or "", 80, "project_suggestion.project_id")
        try:
            confidence = float(raw.get("confidence", 0))
        except (TypeError, ValueError):
            raise ConversationValidationError("project_suggestion.confidence 必须是数字")
        if confidence < 0 or confidence > 1:
            raise ConversationValidationError("project_suggestion.confidence 必须在 0-1 之间")
        should_create = raw.get("should_create_project") is True
        if project_id and should_create:
            raise ConversationValidationError("已有项目建议不能同时建议新建项目")
        if project_id and self.project_validator and not self.project_validator(project_id):
            raise ConversationValidationError("project_suggestion 引用了不存在的项目")
        suggested_name = _text(raw.get("suggested_name") or "", 80, "project_suggestion.suggested_name")
        if should_create and not suggested_name:
            raise ConversationValidationError("建议新建项目时必须提供 suggested_name")
        return {"project_id": project_id, "confidence": round(confidence, 4),
                "reason": _text(raw.get("reason") or "", 300, "project_suggestion.reason", required=True),
                "should_create_project": should_create, "suggested_name": suggested_name,
                "status": "pending", "suggested_at": _now()}

    def _checkpoint(self, parsed, messages, current=None):
        """校验 Hanako 增量检查点；缺失时返回 None，绝不覆盖旧检查点。"""
        if "checkpoint" not in parsed or parsed.get("checkpoint") is None:
            return None
        raw = parsed.get("checkpoint")
        if not isinstance(raw, dict):
            raise ConversationValidationError("checkpoint 必须是对象")

        def text_list(key, limit=100, item_limit=1000):
            values = raw.get(key)
            if not isinstance(values, list) or len(values) > limit:
                raise ConversationValidationError("checkpoint.%s 必须是 0-%d 项数组" % (key, limit))
            if any(not isinstance(item, str) for item in values):
                raise ConversationValidationError("checkpoint.%s 的每一项都必须是字符串" % key)
            return [_text(item, item_limit, "checkpoint.%s" % key, required=True) for item in values]

        system_raw = raw.get("system_state")
        if not isinstance(system_raw, dict):
            raise ConversationValidationError("checkpoint.system_state 必须是对象")
        system_state = {}
        for key in ("files", "services", "versions", "tests"):
            values = system_raw.get(key)
            if not isinstance(values, list) or len(values) > 100:
                raise ConversationValidationError("checkpoint.system_state.%s 必须是 0-100 项数组" % key)
            if any(not isinstance(item, str) for item in values):
                raise ConversationValidationError("checkpoint.system_state.%s 的每一项都必须是字符串" % key)
            system_state[key] = [_text(item, 1000, "checkpoint.system_state.%s" % key, required=True) for item in values]

        failed_raw = raw.get("failed_attempts")
        if not isinstance(failed_raw, list) or len(failed_raw) > 50:
            raise ConversationValidationError("checkpoint.failed_attempts 必须是 0-50 项数组")
        failed_attempts = []
        for index, item in enumerate(failed_raw):
            if not isinstance(item, dict):
                raise ConversationValidationError("checkpoint.failed_attempts[%d] 必须是对象" % index)
            failed_attempts.append({
                key: _text(item.get(key), 1000, "checkpoint.failed_attempts.%s" % key, required=True)
                for key in ("attempt", "reason", "lesson")
            })

        version = raw.get("version")
        if isinstance(version, bool) or not isinstance(version, int) or version < 1:
            raise ConversationValidationError("checkpoint.version 必须是正整数")
        covered = text_list("covered_message_ids", limit=10000, item_limit=240)
        if len(covered) != len(set(covered)):
            raise ConversationValidationError("checkpoint.covered_message_ids 不能重复")
        known_refs = {item.get("source_id") or item.get("id") for item in messages}
        known_refs.update(item.get("id") for item in messages)
        if any(ref not in known_refs for ref in covered):
            raise ConversationValidationError("checkpoint.covered_message_ids 引用了不存在的消息")
        through = _text(raw.get("through_source_id"), 240, "checkpoint.through_source_id", required=True)
        source_ids = {item.get("source_id") for item in messages if item.get("source_id")}
        if through not in source_ids or through not in covered:
            raise ConversationValidationError("checkpoint.through_source_id 必须是已覆盖的 source_id")

        result = {
            "goal": text_list("goal"),
            "completed": text_list("completed"),
            "system_state": system_state,
            "decisions": text_list("decisions"),
            "failed_attempts": failed_attempts,
            "unresolved": text_list("unresolved"),
            "next_steps": text_list("next_steps"),
            "covered_message_ids": covered,
            "through_source_id": through,
            "version": version,
            "generated_at": _text(raw.get("generated_at"), 80, "checkpoint.generated_at", required=True),
        }
        if isinstance(current, dict):
            current_version = current.get("version", 0)
            if version < current_version:
                raise ConversationValidationError("checkpoint.version 不能倒退")
            if version == current_version:
                if result == current:
                    return current
                raise ConversationValidationError("同一 checkpoint.version 的内容不能变化")
        return result

    def _artifact(self, session_id, kind, title, content, evidence, domain, tags, confidence, mode):
        artifact_id = "art_" + _hash(session_id, kind, content, "|".join(evidence))[:24]
        now = _now()
        return {
            "id": artifact_id, "type": kind, "type_label": TYPE_LABELS[kind],
            "title": title, "content": content, "domain": domain,
            "tags": self._tags(tags), "confidence": round(float(confidence), 3),
            "evidence": list(evidence), "status": "pending_review",
            "destination": DEFAULT_DESTINATION[kind], "classification_mode": mode,
            "created_at": now, "updated_at": now,
        }

    @staticmethod
    def _tags(value):
        if not isinstance(value, list):
            return []
        tags = []
        for item in value:
            if not isinstance(item, str):
                continue
            item = _CONTROL_RE.sub("", item).strip()[:30]
            if item and item not in tags:
                tags.append(item)
            if len(tags) >= 8:
                break
        return tags

    @staticmethod
    def _merge_artifacts(current, incoming):
        by_id = {item.get("id"): item for item in current if item.get("id")}
        order = [item.get("id") for item in current if item.get("id")]
        for item in incoming:
            old = by_id.get(item["id"])
            if old and old.get("status") != "pending_review":
                continue
            if old:
                item["created_at"] = old.get("created_at") or item["created_at"]
                by_id[item["id"]] = {**old, **item}
            else:
                by_id[item["id"]] = item
                order.append(item["id"])
        return [by_id[item_id] for item_id in order]

    def _apply_edits(self, artifact, raw):
        if "type" in raw:
            kind = _text(raw.get("type"), 30, "type", required=True).lower()
            if kind not in ARTIFACT_TYPES:
                raise ConversationValidationError("未知资产类型")
            artifact["type"] = kind
            artifact["type_label"] = TYPE_LABELS[kind]
            if "destination" not in raw:
                artifact["destination"] = DEFAULT_DESTINATION[kind]
        for key, limit in (("title", 120), ("content", 4000), ("domain", 40)):
            if key in raw:
                artifact[key] = _text(raw.get(key), limit, key, required=True)
        if "tags" in raw:
            artifact["tags"] = self._tags(raw.get("tags"))
        destination = _text(raw.get("destination") or artifact.get("destination"), 30, "destination", required=True)
        allowed = DESTINATIONS_BY_TYPE[artifact["type"]]
        if destination not in allowed:
            raise ConversationValidationError("%s 不能发布到 %s" % (TYPE_LABELS[artifact["type"]], destination))
        artifact["destination"] = destination
        artifact["updated_at"] = _now()

    def _publish(self, artifact, session):
        destination = artifact["destination"]
        published = None
        if destination == "knowledge":
            if not self.knowledge:
                raise ConversationValidationError("知识库当前不可用")
            note_id = "artifact_" + artifact["id"]
            meta = self.knowledge.add_note(
                artifact["title"], artifact["content"], artifact["domain"],
                note_id=note_id, kind=artifact["type"], artifact_id=artifact["id"],
                source={"kind": "conversation", "session_id": session["session_id"]},
                evidence=artifact["evidence"], tags=artifact.get("tags") or [],
            )
            if self.kb is not None and self.kb_index_path:
                doc_id = "starmap-artifact:%s" % artifact["id"]
                self.kb.add_text(doc_id, artifact["content"], title=artifact["title"],
                                 source="conversation:%s" % session["session_id"], kind=artifact["type"])
                if doc_id in self.kb.docs:
                    self.kb.docs[doc_id]["category"] = artifact["domain"]
                    self.kb.docs[doc_id]["tags"] = artifact.get("tags") or []
                os.makedirs(os.path.dirname(self.kb_index_path), exist_ok=True)
                self.kb.save(self.kb_index_path)
            published = {"kind": "knowledge_note", "id": meta["id"]}
        elif destination == "daily":
            if not self.daily:
                raise ConversationValidationError("每日清单当前不可用")
            self.daily.add("todo", artifact["content"], "medium", "",
                           source_artifact_id=artifact["id"], source_session_id=session["session_id"])
            item = next(
                (row for row in self.daily.get_all().get("todos", [])
                 if row.get("source_artifact_id") == artifact["id"]), None
            )
            published = {"kind": "daily_todo", "id": item.get("id") if item else ""}
        elif destination == "roadmap":
            if not self.roadmap:
                raise ConversationValidationError("目标方向当前不可用")
            goal = self.roadmap.add_goal_from_artifact(artifact, session["session_id"])
            published = {"kind": "roadmap_goal", "id": goal["id"]}
        elif destination == "profile":
            if not self.roadmap:
                raise ConversationValidationError("个人画像当前不可用")
            signal = self.roadmap.add_profile_signal(artifact, session["session_id"])
            published = {"kind": "profile_signal", "id": signal["id"]}
        elif destination == "workflow":
            draft = self._workflow_draft(artifact, session)
            published = {"kind": "workflow_draft", "id": draft["draft_id"]}
        else:
            raise ConversationValidationError("未知发布目标")
        # 阶段5 · 沉淀出口：把成品记入闭环燃料桶（run() 会回流到 2→5）
        if published is not None and self.loop is not None:
            self.loop.enqueue({
                "id": artifact.get("id"),
                "artifact_id": artifact.get("id"),
                "title": artifact.get("title"),
                "content": artifact.get("content"),
                "domain": artifact.get("domain"),
                "type": artifact.get("type"),
                "tags": artifact.get("tags"),
                "destination": destination,
            })
        return published

    def _workflow_draft(self, artifact, session):
        draft_id = "draft_" + artifact["id"]
        graph = {
            "schema_version": 2,
            "title": artifact["title"],
            "nodes": [
                {"id": "start", "type": "start", "title": "开始",
                 "output_schema": {"request": {"type": "string", "required": True}}},
                {"id": "task", "type": "task", "title": artifact["title"],
                 "description": artifact["content"],
                 "input_schema": {"request": {"type": "string", "required": True}},
                 "output_schema": {"result": {"type": "string", "required": True}},
                 "knowledge_scope": {"domains": [artifact["domain"]]},
                 "sop": [{"id": "compose", "title": "生成行动成果", "skill": "local.compose",
                          "with": {"template": "{{request}}"}, "save_as": "result"}]},
                {"id": "end", "type": "end", "title": "完成",
                 "input_schema": {"result": {"type": "string", "required": True}},
                 "output_schema": {"result": {"type": "string", "required": True}}},
            ],
            "edges": [
                {"id": "e1", "from": "start", "from_port": "request", "to": "task", "to_port": "request"},
                {"id": "e2", "from": "task", "from_port": "result", "to": "end", "to_port": "result"},
            ],
        }
        draft = {
            "schema_version": 1, "draft_id": draft_id, "artifact_id": artifact["id"],
            "session_id": session["session_id"], "created_at": _now(), "graph": graph,
            "inputs": {"request": artifact["content"]},
        }
        _atomic_json(os.path.join(self.workflows_dir, draft_id + ".json"), draft)
        return draft

    # ---------------- 索引、状态、迁移 ----------------
    @staticmethod
    def _session_key(session_id):
        return "session_" + _hash(session_id)[:24]

    def _index(self):
        value = _read_json(self.index_path, {"schema_version": SCHEMA_VERSION, "sessions": []})
        if not isinstance(value, dict) or not isinstance(value.get("sessions"), list):
            return {"schema_version": SCHEMA_VERSION, "sessions": []}
        return value

    @staticmethod
    def _apply_session_status(session, artifacts):
        pending = sum(item.get("status") == "pending_review" for item in artifacts)
        if pending:
            status = "pending_review"
        elif artifacts:
            status = "processed"
        else:
            status = "captured"
        session["status"] = status
        session["artifact_count"] = len(artifacts)
        session["pending_count"] = pending
        session["confirmed_count"] = sum(item.get("status") == "confirmed" for item in artifacts)
        session["rejected_count"] = sum(item.get("status") == "rejected" for item in artifacts)
        return session

    @staticmethod
    def _session_projection(session, artifacts):
        return {
            key: session.get(key) for key in (
                "session_id", "source", "title", "agent_id", "agent_name", "kind", "visibility",
                "status", "created_at", "updated_at", "last_sync_at", "message_count",
                "artifact_count", "pending_count", "confirmed_count", "rejected_count",
                "extraction_status", "extraction_error", "last_extracted_at", "conversation_summary",
                "checkpoint",
                "project_suggestion", "project_suggestion_status", "project_id", "project_confirmed_at",
            )
        }

    def _update_index(self, session, artifacts):
        index = self._index()
        projection = self._session_projection(session, artifacts)
        items = [item for item in index.get("sessions", []) if item.get("session_id") != session["session_id"]]
        items.append(projection)
        items.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
        index.update({"schema_version": SCHEMA_VERSION, "sessions": items[:1000], "updated_at": _now()})
        _atomic_json(self.index_path, index)

    def _migrate_legacy(self):
        marker = _read_json(self.migration_path, {})
        if marker.get("legacy_experience_version") == 1:
            return
        legacy_root = os.path.join(self.data_dir, "starmap", "experience", "智能体对话总结")
        imported = 0
        if os.path.isdir(legacy_root):
            for name in sorted(os.listdir(legacy_root)):
                directory = os.path.join(legacy_root, name)
                if not os.path.isdir(directory):
                    continue
                message_doc = _read_json(os.path.join(directory, "messages.json"), {})
                meta = _read_json(os.path.join(directory, "meta.json"), {})
                messages = message_doc.get("messages") or []
                if not isinstance(messages, list) or not messages:
                    continue
                normalized = []
                for index, message in enumerate(messages):
                    if isinstance(message, dict) and message.get("role") in {"user", "assistant"} and message.get("content"):
                        normalized.append({**message, "source_id": "legacy:%s:%d" % (name, index)})
                if not normalized:
                    continue
                try:
                    self.sync({
                        "source": "legacy",
                        "session": {
                            "session_id": "legacy:%s" % name,
                            "title": meta.get("title") or message_doc.get("title") or name,
                            "agent_name": "AI", "visibility": "public", "kind": "legacy",
                        },
                        "messages": normalized, "complete_turn": True,
                    })
                    imported += 1
                except ConversationValidationError:
                    continue
        _atomic_json(self.migration_path, {
            "schema_version": 1, "legacy_experience_version": 1,
            "imported_sessions": imported, "completed_at": _now(),
        })
