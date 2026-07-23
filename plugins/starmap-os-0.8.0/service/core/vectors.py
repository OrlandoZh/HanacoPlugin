# -*- coding: utf-8 -*-
"""core/vectors.py — 纯标准库向量与检索工具（零外部依赖）。
提供：中文/英文分词、TF-IDF 向量、余弦相似度、BM25，以及线性扫描检索。
用于知识库 RAG 的"向量化 + 向量检索"环节（无 numpy / 无外部 ML 库）。
"""
import re
import math

_TOKEN_RE = re.compile(r"[\u4e00-\u9fff]|[A-Za-z][A-Za-z0-9_]*")


def tokenize(text):
    """分词：英文/数字连续词 + CJK 单字与相邻二元组（提升中文相关性）。"""
    if not text:
        return []
    toks = [t.lower() for t in _TOKEN_RE.findall(text)]
    # 在连续 CJK 串上补充二元组，使"矛盾标记"类词可整词匹配
    cjk_runs = re.findall(r"[\u4e00-\u9fff]+", text or "")
    for run in cjk_runs:
        for i in range(len(run) - 1):
            toks.append(run[i:i + 2])
    return toks


def _norm(vec):
    vals = vec.values() if hasattr(vec, "values") else vec
    s = math.sqrt(sum(v * v for v in vals))
    return s or 1.0


class TfidfIndex:
    """增量式 TF-IDF 倒排索引。每个文档 = 一条向量（token -> weight）。"""

    def __init__(self):
        self.doc_count = 0
        self.df = {}                 # token -> 出现过的文档数
        self.idf = {}                # token -> idf
        self.docs = {}               # doc_id -> {token: tf_weight}
        self.doc_meta = {}           # doc_id -> 元信息

    def add(self, doc_id, text, meta=None):
        terms = tokenize(text)
        if not terms:
            return
        tf = {}
        for t in terms:
            tf[t] = tf.get(t, 0) + 1
        # 归一化 tf（亚线性），并计入 df
        for t in set(terms):
            self.df[t] = self.df.get(t, 0) + 1
        max_tf = max(tf.values())
        vec = {}
        for t, c in tf.items():
            vec[t] = (0.5 + 0.5 * (c / max_tf))
        self.docs[doc_id] = vec
        self.doc_meta[doc_id] = meta or {}
        self.doc_count += 1
        self._rebuild_idf()

    def _rebuild_idf(self):
        n = self.doc_count
        self.idf = {t: math.log((n + 1) / (df + 1)) + 1 for t, df in self.df.items()}

    def _vec_to_tfidf(self, vec):
        return {t: w * self.idf.get(t, 1.0) for t, w in vec.items()}

    def query_tfidf(self, text, top_k=5):
        """返回 [(doc_id, score)]，按 TF-IDF 余弦排序。"""
        terms = tokenize(text)
        if not terms:
            return []
        tf = {}
        for t in terms:
            tf[t] = tf.get(t, 0) + 1
        max_tf = max(tf.values())
        qvec = {t: (0.5 + 0.5 * (c / max_tf)) * self.idf.get(t, 1.0) for t, c in tf.items()}
        out = []
        for doc_id, vec in self.docs.items():
            dot = 0.0
            for t, w in qvec.items():
                if t in vec:
                    dot += w * vec[t]
            if dot <= 0:
                continue
            dnorm = _norm(vec)
            qnorm = _norm(list(qvec.values()))
            sim = dot / (dnorm * qnorm)
            out.append((doc_id, sim))
        out.sort(key=lambda x: -x[1])
        return out[:top_k]

    def save(self, path):
        import json
        with open(path, "w", encoding="utf-8") as f:
            json.dump({
                "doc_count": self.doc_count, "df": self.df, "docs": self.docs,
                "doc_meta": self.doc_meta,
            }, f, ensure_ascii=False)

    def load(self, path):
        import json
        with open(path, "r", encoding="utf-8") as f:
            d = json.load(f)
        self.doc_count = d["doc_count"]
        self.df = d["df"]
        self.docs = d["docs"]
        self.doc_meta = d.get("doc_meta", {})
        self._rebuild_idf()


def cosine(a, b):
    """两个 token->weight 向量的余弦相似度。"""
    if not a or not b:
        return 0.0
    common = set(a) & set(b)
    dot = sum(a[t] * b[t] for t in common)
    if dot == 0:
        return 0.0
    return dot / (_norm(a) * _norm(b))


def bm25_scores(query, docs, k1=1.5, b=0.75, avg_dl=None):
    """对一组 (doc_id, text) 计算 BM25 分数（用于重排阶段的辅助信号）。
    docs: list of (doc_id, text)。返回 {doc_id: score}。"""
    qterms = tokenize(query)
    if not qterms:
        return {}
    # 统计 df 与文档长度
    df = {}
    lengths = {}
    parsed = []
    for doc_id, text in docs:
        terms = tokenize(text)
        lengths[doc_id] = max(1, len(terms))
        tf_map = {}
        for t in terms:
            tf_map[t] = tf_map.get(t, 0) + 1
        for t in set(terms):
            df[t] = df.get(t, 0) + 1
        parsed.append((doc_id, tf_map))
    N = len(parsed)
    avg = avg_dl or (sum(lengths.values()) / max(1, N))
    out = {}
    for doc_id, tf_map in parsed:
        score = 0.0
        dl = lengths[doc_id]
        for t in qterms:
            if t not in tf_map:
                continue
            idf = math.log((N - df.get(t, 0) + 0.5) / (df.get(t, 0) + 0.5) + 1)
            tf = tf_map[t]
            denom = tf + k1 * (1 - b + b * (dl / avg))
            score += idf * (tf * (k1 + 1)) / denom
        out[doc_id] = score
    return out
