# -*- coding: utf-8 -*-
"""core/graph.py — 知识连接图谱（极简版，仅 kb.py 内部使用）。
"""
import json
import os
import tempfile


class ConnectionGraph:
    def __init__(self, path=None):
        self.path = path
        self.nodes = {}
        self.edges = []
        self._pending = set()
        self._dedup = set()

    def load(self, path=None):
        path = path or self.path
        if not path or not os.path.exists(path):
            return
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            self.nodes = data.get("nodes", {})
            self.edges = data.get("edges", [])
            self._dedup = set(f"{e['source']}->{e['target']}" for e in self.edges)
        except Exception:
            pass

    def save(self, path=None):
        path = path or self.path
        if not path:
            return
        fd, tmp = tempfile.mkstemp(prefix=".graph.", dir=os.path.dirname(path))
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"nodes": self.nodes, "edges": self.edges}, f, ensure_ascii=False)
        os.replace(tmp, path)

    def nodes(self):
        return list(self.nodes.keys())

    def add_node(self, doc_id, title=""):
        if doc_id not in self.nodes:
            self.nodes[doc_id] = title or doc_id

    def record(self, source, target, kind="reference", weight=1.0):
        key = f"{source}->{target}"
        if key in self._dedup:
            return
        self._dedup.add(key)
        self.edges.append({"source": source, "target": target, "kind": kind, "weight": weight})
        if source not in self.nodes:
            self.nodes[source] = source
        if target not in self.nodes:
            self.nodes[target] = target
        self._pending.add(source)
        self._pending.add(target)

    def record_mutual(self, a, b, kind="reference", weight=1.0):
        self.record(a, b, kind, weight)
        self.record(b, a, kind, weight)

    def degree(self, doc_id):
        count = 0
        for e in self.edges:
            if e["source"] == doc_id:
                count += 1
        return count

    def to_graph_json(self, title_of=None):
        return {"nodes": self.nodes, "edges": self.edges}
