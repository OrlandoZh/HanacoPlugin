# -*- coding: utf-8 -*-
"""core/providers.py — 多模型提供商注册表（OpenAI 兼容）。
支持：OpenAI / DeepSeek / 小米 Mimo / Ollama / 自定义。
配置以 base_url + api_key + 模型名 模式存储，与 openhanako 的提供商模型一致。
角色：chat(对话) / light(轻量工具→用于分类) / heavy(重度分析) / vision(视觉)。
"""
import os
import json
import threading
import urllib.request
import urllib.error
import ssl

# 预设：base_url 均可编辑
PRESETS = {
    "openai":   {"label": "OpenAI",       "base_url": "https://api.openai.com/v1",            "default_model": "gpt-4o-mini"},
    "deepseek": {"label": "DeepSeek",     "base_url": "https://api.deepseek.com/v1",          "default_model": "deepseek-chat"},
    "mimo":     {"label": "小米 Mimo",     "base_url": "https://api.xiaomimimo.com/v1",        "default_model": "mimo-v2.5-pro"},
    "custom":   {"label": "自定义",        "base_url": "",                                      "default_model": ""},
}
ROLES = ["chat", "light", "heavy", "vision"]
ROLE_LABELS = {"chat": "对话模型", "light": "轻量工具模型", "heavy": "重度分析模型", "vision": "视觉模型"}

_lock = threading.Lock()


class ProviderStore:
    def __init__(self, path):
        self.path = path
        self.data = {"providers": [], "roles": {}}
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    self.data = json.load(f)
            except Exception:
                self.data = {"providers": [], "roles": {}}
        if "providers" not in self.data:
            self.data["providers"] = []
        if "roles" not in self.data:
            self.data["roles"] = {}
        self._make_private()

    def _make_private(self):
        if not os.path.exists(self.path):
            return
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    def save(self):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            os.fchmod(fd, 0o600)
        except OSError:
            pass
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)

    def list(self):
        providers = [{**item, "api_key": "", "has_api_key": bool(item.get("api_key"))}
                     for item in self.data["providers"]]
        return {"providers": providers, "roles": self.data["roles"],
                "presets": [{"id": k, "label": v["label"]} for k, v in PRESETS.items()]}

    def add(self, provider):
        """provider: {id?, name, type, base_url, api_key, model, models?}"""
        pid = provider.get("id") or ("p_%d" % (len(self.data["providers"]) + 1))
        rec = {
            "id": pid,
            "name": provider.get("name") or provider.get("type") or "未命名",
            "type": provider.get("type", "openai-compatible"),
            "base_url": provider.get("base_url", ""),
            "api_key": provider.get("api_key", ""),
            "model": provider.get("model", ""),
            "models": provider.get("models", []),
        }
        # 覆盖同名/同 id
        existing = next((p for p in self.data["providers"] if p["id"] == pid), None)
        if existing:
            existing.update(rec)
        else:
            self.data["providers"].append(rec)
        self.save()
        return rec

    def delete(self, pid):
        self.data["providers"] = [p for p in self.data["providers"] if p["id"] != pid]
        for r in list(self.data["roles"].keys()):
            if self.data["roles"][r] == pid:
                self.data["roles"].pop(r, None)
        self.save()

    def set_role(self, role, pid):
        if role not in ROLES:
            raise ValueError("未知角色 %s" % role)
        if pid:
            ok = any(p["id"] == pid for p in self.data["providers"])
            if not ok:
                raise ValueError("提供商不存在")
        self.data["roles"][role] = pid
        self.save()

    def get_provider(self, pid):
        return next((p for p in self.data["providers"] if p["id"] == pid), None)

    def role_provider(self, role):
        pid = self.data["roles"].get(role)
        if pid:
            return self.get_provider(pid)
        # 回退：第一个提供商
        return self.data["providers"][0] if self.data["providers"] else None


def call_chat(provider, messages, model=None, temperature=0.7, timeout=40, **kwargs):
    """调用 OpenAI 兼容 /chat/completions。provider 为 dict（含 base_url/api_key/model）。"""
    base = (provider.get("base_url") or os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    api_key = provider.get("api_key") or os.environ.get("OPENAI_API_KEY") or ""
    model = model or provider.get("model") or os.environ.get("OPENAI_MODEL") or "gpt-4o-mini"
    if not api_key:
        return "[演示模式·未配置 API Key] 针对：%s" % (messages[-1]["content"] if messages else "")
    payload_data = {
        "model": model,
        "messages": messages,
        "temperature": float(temperature),
    }
    for key, val in kwargs.items():
        if key not in payload_data:
            payload_data[key] = val
    payload = json.dumps(payload_data).encode("utf-8")
    req = urllib.request.Request(base + "/chat/completions", data=payload,
                                 headers={"Authorization": "Bearer " + api_key,
                                          "Content-Type": "application/json"})
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            j = json.loads(resp.read().decode("utf-8"))
        return j["choices"][0]["message"]["content"]
    except urllib.error.HTTPError as e:
        return "[API 错误 %d] %s" % (e.code, e.read().decode("utf-8", "ignore")[:200])
    except Exception as e:
        return "[调用失败] %s" % str(e)
