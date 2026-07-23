# -*- coding: utf-8 -*-
"""core/kb.py — 星图知识库（Dify 式 RAG 引擎，纯标准库）。
能力：对话卡片索引 → TF-IDF/BM25 关键词检索 → 检索重排 → 引用溯源（连接图谱）。
连接图谱记录 [[引用]] 之间的关系边，连接数（degree）用于排序展示。
"""
import os
import re
import json
import datetime

from vectors import TfidfIndex, bm25_scores
from graph import ConnectionGraph  # 数据平等：连接图谱（不写重要性标签）

_SENT_RE = re.compile(r"[^。！？!?\n]+[。！？!?\n]?")
_WIKI_LINK_RE = re.compile(r"\[\[([^\[\]]+?)\]\]")  # 文档内 [[标题]] 引用


def chunk_text(text, size=320, overlap=60):
    """按句子切分并聚合成带重叠的片段（自动文档分割）。"""
    text = re.sub(r"[ \t]+", " ", text).strip()
    if not text:
        return []
    sents = [s.strip() for s in _SENT_RE.findall(text) if s.strip()]
    if not sents:
        sents = [text]
    chunks, buf, buf_len = [], [], 0
    for s in sents:
        if buf_len + len(s) > size and buf:
            chunk = " ".join(buf)
            chunks.append(chunk)
            # 重叠：保留末尾若干句
            keep = []
            kl = 0
            for old in reversed(buf):
                if kl + len(old) > overlap:
                    break
                keep.insert(0, old)
                kl += len(old)
            buf, buf_len = keep, kl
        buf.append(s)
        buf_len += len(s)
    if buf:
        chunks.append(" ".join(buf))
    return chunks


class KnowledgeBase:
    def __init__(self, index_path=None, graph_path=None):
        self.index = TfidfIndex()
        self.chunks = {}          # chunk_id -> {doc_id,title,source,idx,text,offset}
        self.docs = {}            # doc_id -> {title, source, kind, added, chunks:[chunk_id]}
        self.index_path = index_path
        # 数据平等：连接图谱单独存储，绝不向 docs 写入任何重要性标签
        self.graph_path = graph_path or (
            index_path.replace(".json", ".graph.json") if index_path else None
        )
        self.graph = ConnectionGraph(self.graph_path)
        # 数据平等 · 连接账本：以下三者只记"连接来源"，绝不含任何重要性标签
        self.pending_refs = {}     # doc_id -> [目标标题]，支撑顺序无关的二次解析
        self._wiki_edges = set()   # 已落地的 [[链接]] 引用边 (src,dst)，幂等防重复记权
        self._sim_pairs = set()    # 已自动连过的相似对 frozenset({a,b})，幂等防重复记权
        # 语义检索（可选层）：进程内缓存的语义索引；依赖缺失时自动降级为纯关键词
        self._sem = None
        self._sem_disabled = False
        if index_path and os.path.exists(index_path):
            self.load(index_path)

    # ---------------- 摄入 ----------------
    def add_text(self, doc_id, text, title=None, source="local", kind="text"):
        title = title or doc_id
        parts = chunk_text(text)
        cids = []
        offset = 0
        for i, p in enumerate(parts):
            cid = "%s#%d" % (doc_id, i)
            self.chunks[cid] = {
                "doc_id": doc_id, "title": title, "source": source,
                "idx": i, "text": p, "offset": offset, "len": len(p),
            }
            self.index.add(cid, p, meta={"title": title, "source": source, "doc_id": doc_id, "idx": i})
            cids.append(cid)
            offset += len(p)
        # 重建时保留已有人工分类/标签
        prev = self.docs.get(doc_id, {})
        self.docs[doc_id] = {
            "title": title, "source": source, "kind": kind,
            "added": datetime.date.today().isoformat(), "chunks": cids,
            "category": prev.get("category", ""),
            "tags": prev.get("tags", []),
        }
        # 数据平等：登记节点 + 自动抽取 [[标题]] 引用，记入连接图谱
        # （只记连接，不写任何"重要性"永久标签）
        self.graph.add_node(doc_id)
        self._index_references(doc_id, text)
        return len(cids)

    def _index_references(self, doc_id, text):
        """抽取正文里的 [[标题]] 目标，登记到 pending_refs，并即时解析可解析的部分。
        解析与摄入顺序无关：即便"先加引用方、后加被引方"，也会在 resolve_references()
        或后续摄入时被补上，不会丢引用。
        """
        targets = [m.group(1).strip() for m in _WIKI_LINK_RE.finditer(text or "") if m.group(1).strip()]
        if targets:
            self.pending_refs[doc_id] = targets
        self._resolve_doc_refs(doc_id)

    def _resolve_doc_refs(self, doc_id):
        """把某文档已登记但尚未落地的 [[链接]] 目标解析成引用边（幂等）。"""
        added = 0
        for target in self.pending_refs.get(doc_id, []):
            dst = None
            for did, d in self.docs.items():
                if d.get("title") == target or did == target:
                    dst = did
                    break
            if dst and dst != doc_id and (doc_id, dst) not in self._wiki_edges:
                self.graph.record(doc_id, dst, kind="reference", weight=1.0)
                self._wiki_edges.add((doc_id, dst))
                added += 1
        return added

    def resolve_references(self):
        """【限制修复】顺序无关的二次扫描：把所有已登记的 [[链接]] 目标解析成引用边。
        修复"先加引用方、后加被引方"导致引用丢失的问题；幂等，可反复调用。
        建议在 build_index 结束后调用一次。
        返回本次新落地的引用边数量。
        """
        total = 0
        for doc_id in list(self.pending_refs.keys()):
            total += self._resolve_doc_refs(doc_id)
        return total

    def auto_link_similar(self, per_doc=3, min_sim=0.03, rebuild=False):
        """【限制修复】连接自举：用现有关键词引擎给内容相近的文档自动连"相似"边，
        让连接图谱在没有任何人工 [[链接]] 时也不为空。

        * 现由 TF-IDF 相似度驱动（零依赖）；接入本机语义模型后可无缝换成真向量
          相似（复用同一条 semantic 连接通道），进一步消解"词汇种姓"。
        * 只记连接，绝不给文档写任何"重要性 / 重要 / 琐碎"标签。
        * 幂等：同一对文档不会重复记权（靠 _sim_pairs 账本）。
        返回本次新增的相似连接数。
        """
        if rebuild:
            # 只清理"自动相似"账本，人工引用 / [[链接]] 边一概不动
            self._sim_pairs = set()
        added = 0
        for did in list(self.docs.keys()):
            d = self.docs[did]
            cids = d.get("chunks", [])
            rep = d.get("title", "")
            if cids:
                rep += " " + self.chunks.get(cids[0], {}).get("text", "")
            if not rep.strip():
                continue
            hits = self.retrieve(rep, top_k=per_doc * 4)
            seen = set()
            linked = 0
            for h in hits:
                tgt = h["doc_id"]
                if tgt == did or tgt in seen:
                    continue
                seen.add(tgt)
                if h.get("tfidf", 0.0) < min_sim:
                    continue
                pair = frozenset((did, tgt))
                if pair in self._sim_pairs:
                    # 已连过的相似对也占用本文档的 per_doc 配额，
                    # 否则重复调用时会不断向更远的文档扩边（破坏幂等）。
                    linked += 1
                    if linked >= per_doc:
                        break
                    continue
                self._sim_pairs.add(pair)
                self.graph.record_mutual(did, tgt, kind="semantic", weight=1.0)
                added += 1
                linked += 1
                if linked >= per_doc:
                    break
        return added

    # ---------------- 检索 / 重排 / 引用 ----------------
    def retrieve(self, query, top_k=6):
        hits = self.index.query_tfidf(query, top_k=top_k * 3)
        results = []
        for cid, score in hits:
            c = self.chunks.get(cid)
            if not c:
                continue
            doc = self.docs.get(c["doc_id"], {})
            results.append({
                "chunk_id": cid, "doc_id": c["doc_id"], "title": c["title"],
                "source": c["source"], "idx": c["idx"], "text": c["text"],
                "tfidf": score, "category": doc.get("category", ""),
                "tags": doc.get("tags", []),
            })
        return results

    def list_categories(self):
        cats = {}
        for d in self.docs.values():
            c = d.get("category") or "未分类"
            cats[c] = cats.get(c, 0) + 1
        return [{"category": k, "count": v} for k, v in sorted(cats.items(), key=lambda x: -x[1])]

    def rerank(self, results, query):
        """检索重排：融合 TF-IDF 与 BM25 双信号后重新排序。"""
        if not results:
            return results
        docs = [(r["chunk_id"], r["text"]) for r in results]
        bm25 = bm25_scores(query, docs)
        max_t = max((r["tfidf"] for r in results), default=1) or 1
        max_b = max(bm25.values(), default=1) or 1
        for r in results:
            b = bm25.get(r["chunk_id"], 0.0)
            # 0.6 * tfidf 归一 + 0.4 * bm25 归一
            r["bm25"] = b
            r["rerank_score"] = 0.6 * (r["tfidf"] / max_t) + 0.4 * (b / max_b)
        results.sort(key=lambda r: -r["rerank_score"])
        return results

    def cite(self, results):
        """引用溯源：为每个片段补全来源定位，降低 AI 幻觉。"""
        for r in results:
            r["citation"] = "《%s》 片段#%d · 来源 %s" % (r["title"], r["idx"], r["source"])
        return results

    # ---------------- 可选·本地语义向量检索（可降级） ----------------
    def ensure_semantic(self):
        """确保语义索引可用并已构建（进程内缓存）。
        依赖缺失或构建失败时返回 False，检索自动降级为纯关键词（不报错）。"""
        if self._sem_disabled:
            return False
        if self._sem is not None:
            return True
        try:
            from semantic import SemanticIndex
        except Exception:
            self._sem_disabled = True
            return False
        if not self.chunks:
            return False
        idx = SemanticIndex()
        for cid, c in self.chunks.items():
            idx.add(cid, c["text"])
        try:
            idx.build()
        except Exception:
            self._sem_disabled = True
            return False
        self._sem = idx
        return True

    def semantic_search(self, query, top_k=15):
        """语义向量召回（本机 bge-small-zh）。不可用时返回 []，由调用方降级。"""
        if not self.ensure_semantic():
            return []
        return self._sem.search(query, top_k=top_k)

    def search(self, query, top_k=6, category=None, blend_importance=0.0,
               record_cooccur=False, fusion=0.0):
        results = self.retrieve(query, top_k=max(top_k, 12))
        if category:
            results = [r for r in results if (r.get("category") or "未分类") == category]
        results = self.rerank(results, query)
        results = self.cite(results)
        # 混合检索：向量语义召回 + 关键词重排，RRF 融合。fusion=0 时完全走原路径。
        if fusion and 0 < fusion <= 1:
            sem = self.semantic_search(query, top_k=max(top_k, 15))
            if sem:
                kw_rank = {r["chunk_id"]: i for i, r in enumerate(results)}
                sem_rank = {cid: i for i, (cid, _) in enumerate(sem)}
                fused = []
                for c in set(kw_rank) | set(sem_rank):
                    info = self.chunks.get(c)
                    if not info:
                        continue
                    if c in kw_rank:
                        r = dict(results[kw_rank[c]])
                    else:
                        doc = self.docs.get(info["doc_id"], {})
                        r = {
                            "chunk_id": c, "doc_id": info["doc_id"], "title": info["title"],
                            "source": info["source"], "idx": info["idx"], "text": info["text"],
                            "tfidf": 0.0, "category": doc.get("category", ""), "tags": doc.get("tags", []),
                        }
                        r = self.cite([r])[0]
                    rk = kw_rank.get(c, 10 ** 9)
                    rs = sem_rank.get(c, 10 ** 9)
                    r["rerank_score"] = (1 - fusion) * (1.0 / (60 + rk)) + fusion * (1.0 / (60 + rs))
                    fused.append(r)
                fused.sort(key=lambda r: -r["rerank_score"])
                results = fused
        # 数据平等：blend_importance>0 时，将"连接重要性"混入排序。
        # 注意：这是"针对本次查询的临时视图"，重要性从不写回文档。
        if blend_importance and 0 < blend_importance <= 1:
            imp = []
            if imp:
                mx = max(imp.values()) or 1.0
                for r in results:
                    r["connections"] = self.graph.degree(r["doc_id"])
                    iscore = imp.get(r["doc_id"], 0.0) / mx
                    r["importance"] = round(iscore, 4)
                    r["rerank_score"] = (
                        (1 - blend_importance) * r["rerank_score"]
                        + blend_importance * iscore
                    )
                results.sort(key=lambda r: -r["rerank_score"])
        final = results[:top_k]
        # 连接自举来源③：共现召回。默认关闭；开启后让"常被一起搜出来"的文档随
        # 使用逐步长出连接（弱权重、只记前若干名，避免图谱过密）。只记连接，不写重要性。
        if record_cooccur and len(final) >= 2:
            top_docs = []
            for r in final:
                if r["doc_id"] not in top_docs:
                    top_docs.append(r["doc_id"])
                if len(top_docs) >= 3:
                    break
            for i in range(len(top_docs)):
                for j in range(i + 1, len(top_docs)):
                    self.graph.record_mutual(top_docs[i], top_docs[j], kind="coretr", weight=0.25)
        return final

    # ---------------- 连接（从不存储重要性） ----------------
    def record_reference(self, src_id, dst_id, weight=1.0):
        """显式记录一条引用连接（UI 手动 @ 引用时调用）。"""
        self.graph.record(src_id, dst_id, kind="reference", weight=weight)

    def connection_count(self, doc_id):
        """某文档的连接总数（派生值，不存储）。"""
        return self.graph.degree(doc_id)

    # ---------------- 持久化 ----------------
    def save(self, path=None):
        path = path or self.index_path
        if not path:
            return
        self.index.save(path)
        meta = path.replace(".json", ".meta.json")
        with open(meta, "w", encoding="utf-8") as f:
            json.dump({
                "docs": self.docs, "chunks": self.chunks,
                # 连接账本一并持久化，保证重启后"顺序无关解析 / 自举去重"仍成立
                "pending_refs": self.pending_refs,
                "wiki_edges": ["%s\x1f%s" % (a, b) for (a, b) in self._wiki_edges],
                "sim_pairs": ["\x1f".join(sorted(p)) for p in self._sim_pairs],
            }, f, ensure_ascii=False)
        if self.graph_path:
            self.graph.save(self.graph_path)

    def load(self, path):
        self.index.load(path)
        meta = path.replace(".json", ".meta.json")
        if os.path.exists(meta):
            with open(meta, "r", encoding="utf-8") as f:
                d = json.load(f)
            self.docs = d.get("docs", {})
            self.chunks = d.get("chunks", {})
            self.pending_refs = d.get("pending_refs", {})
            self._wiki_edges = set(
                tuple(s.split("\x1f", 1)) for s in d.get("wiki_edges", []) if "\x1f" in s
            )
            self._sim_pairs = set(
                frozenset(s.split("\x1f")) for s in d.get("sim_pairs", []) if s
            )
        if self.graph_path:
            self.graph.load(self.graph_path)
        # 语义索引为进程内缓存，载入新文档后作废，下次检索按需重建
        self._sem = None
        self._sem_disabled = False

    def reset(self):
        """清空索引、文档与片段（用于干净重建，避免删源后残留）。"""
        self.index = TfidfIndex()
        self.chunks = {}
        self.docs = {}
        self.graph = ConnectionGraph(self.graph_path)
        self.pending_refs = {}
        self._wiki_edges = set()
        self._sim_pairs = set()
        if self.graph_path and os.path.exists(self.graph_path):
            try:
                os.remove(self.graph_path)
            except OSError:
                pass
        self._sem = None
        self._sem_disabled = False

