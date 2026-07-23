# -*- coding: utf-8 -*-
"""core/trash.py — 星图统一废纸篓（防误删）内核。

设计原则（与「神经树·数据平等」一致）：
  - 删除 = 移入废纸篓，绝不物理抹除；废纸篓内可一键恢复。
  - 支持两种数据形态：
    · object 模式：JSON 数组区（每日清单 / 目标方向）把整条记录序列化进 index.json。
    · files  模式：文件式区（知识库笔记 / 复盘周 / 经验对话 / 日记）把真实目录/文件搬进
                  trash/<trash_id>/，物理移出视图，恢复时搬回原处。
  - 纯本地优先、无外部依赖。
"""
import os
import json
import shutil
import tempfile
import datetime
import threading

import re


def _now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def _new_id():
    return "trash_%s" % datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f")


class TrashStore:
    def __init__(self, root):
        # root 应为 data/starmap
        self.dir = os.path.join(root, "trash")
        os.makedirs(self.dir, exist_ok=True)
        self.path = os.path.join(self.dir, "index.json")
        self._lock = threading.RLock()

    # ---------------- 底层 IO ----------------
    def _load(self):
        if os.path.exists(self.path):
            try:
                with open(self.path, encoding="utf-8") as handle:
                    d = json.load(handle)
                return d if isinstance(d, list) else []
            except Exception:
                pass
        return []

    def _save(self, items):
        fd, tmp = tempfile.mkstemp(prefix=".trash-", suffix=".tmp", dir=self.dir)
        try:
            if os.name == "posix":
                os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(items, handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, self.path)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    # ---------------- 写入 ----------------
    def add_object(self, zone, ref_id, label, payload):
        with self._lock:
            items = self._load()
            rec = {"trash_id": _new_id(), "zone": zone, "ref_id": str(ref_id),
                   "label": label, "deleted_at": _now(), "mode": "object", "payload": payload}
            items.insert(0, rec)
            self._save(items)
            return rec

    def add_files(self, zone, ref_id, label, file_map):
        """file_map: [(原始绝对路径, 相对名), ...] 把真实文件/目录搬进 trash/<trash_id>/。"""
        with self._lock:
            tid = _new_id()
            dest_dir = os.path.join(self.dir, tid)
            os.makedirs(dest_dir, exist_ok=True)
            moved = []
            for orig, rel in file_map:
                target = os.path.join(dest_dir, rel)
                if os.path.isdir(orig):
                    shutil.move(orig, target)
                elif os.path.exists(orig):
                    shutil.move(orig, target)
                moved.append({"from": orig, "to": target})
            items = self._load()
            rec = {"trash_id": tid, "zone": zone, "ref_id": str(ref_id),
                   "label": label, "deleted_at": _now(), "mode": "files", "files": moved}
            items.insert(0, rec)
            self._save(items)
            return rec

    # ---------------- 读取 ----------------
    def list(self):
        with self._lock:
            return self._load()

    def get(self, trash_id):
        with self._lock:
            return next((it for it in self._load() if it["trash_id"] == trash_id), None)

    def remove_record(self, trash_id):
        with self._lock:
            items = [it for it in self._load() if it["trash_id"] != trash_id]
            self._save(items)

    # ---------------- 恢复 / 永久删除 ----------------
    def restore_files(self, rec):
        """把 files 模式记录里的文件搬回原始路径（恢复）。"""
        for f in rec.get("files", []):
            target = f["to"]
            orig = f["from"]
            if os.path.exists(target):
                if os.path.isdir(target):
                    shutil.move(target, orig)
                else:
                    shutil.move(target, orig)

    def purge(self, trash_id):
        """永久删除：object 模式仅移除记录；files 模式额外删掉 trash/<id> 目录。"""
        with self._lock:
            rec = self.get(trash_id)
            if not rec:
                return False
            if rec.get("mode") == "files":
                d = os.path.join(self.dir, trash_id)
                if os.path.isdir(d):
                    shutil.rmtree(d)
            self.remove_record(trash_id)
            return True

    def empty(self):
        """清空废纸篓（永久删除全部）。"""
        with self._lock:
            for rec in self._load():
                if rec.get("mode") == "files":
                    d = os.path.join(self.dir, rec["trash_id"])
                    if os.path.isdir(d):
                        shutil.rmtree(d)
            self._save([])


# 区域中文名（用于废纸篓列表展示）
ZONE_LABELS = {
    "daily": "每日清单",
    "roadmap_goal": "目标方向",
    "knowledge_note": "知识库笔记",
    "calibration": "复盘日记",
    "experience_dialogue": "智能体对话",
    "experience_diary": "日记",
}
