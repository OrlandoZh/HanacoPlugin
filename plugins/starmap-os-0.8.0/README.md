# 星图（Starmap OS）

星图是 Hanako 的本地对话知识库工作台。它读取公开主对话，让用户按需调用 Hanako AI 提炼候选卡片，审核后沉淀为知识、共享项目记忆，以及周复盘和月复盘。

- 作者：[v20227](https://github.com/v20227)（羊）
- 项目主页：https://github.com/v20227/xingtujihua
- 问题反馈：https://github.com/v20227/xingtujihua/issues

## 安装要求

- HanaAgent `0.412.7` 或更高版本。
- Python `3.9` 或更高版本，命令名为 `python3`、`python`，Windows 也支持 `py -3`。
- 在 HanaAgent 设置 → 插件 → 权限中开启“允许全权插件”。
- 本机端口 `8790` 可用；也可以在插件设置中改成其他 `127.0.0.1` / `localhost` HTTP 端口。

## 安装

1. 下载发布页中的 `starmap-os-0.8.0.zip`。
2. 打开 HanaAgent → 设置 → 插件。
3. 把 zip 拖入安装区，或通过文件选择器安装。
4. 启用“星图”。插件会从自身安装目录启动内置服务，数据写入 Hanako 分配的插件数据目录，不依赖作者电脑路径。
5. 打开插件页面。插件会自动补读最近公开对话；需要手动重读时可点击“探索同步 Hanako 对话”。

## 使用流程

```text
探索同步原文 → 读取对话 → 单条 AI 提炼 → 审核保存
→ 知识星库 → 共享项目 → 周复盘 / 月复盘
```

- 探索不调用 AI，只同步原文。
- AI 提炼只在用户点击单条会话时发生。
- 删除星图对话副本不会删除 Hanako 原对话，再次探索可以恢复。
- 只有人工确认的内容进入知识星库、共享项目和复盘。

## 权限说明

本插件属于 `full-access`，因为它需要页面、HTTP 路由和生命周期服务。声明的能力只有：

- `session.read`：读取公开 Hanako 对话。
- `model.sample`：用户主动提炼时调用当前 Hanako 模型。
- `network.fetch`：只访问 `127.0.0.1` / `localhost` 的星图服务。

插件会启动随包附带的 Python 子进程，只监听本机回环地址。不会访问第三方服务器，不包含 API Key，也不会写入用户工作区。

## 数据位置

所有用户数据写入 `${HANA_HOME}/plugin-data/starmap-os/starmap-data/`。卸载插件代码时 Hanako 默认保留插件数据，重新安装后可以继续使用。

## 常见问题

- 页面空白：检查 Python 版本和插件日志中的 `[service]` 信息。
- 端口占用：在插件设置中把服务地址改为其他本机端口，然后重新启用插件。
- AI 提炼失败：确认 Hanako 当前模型可用后重试；原文不会丢失。
- 探索后没有卡片：探索只同步原文，需要对目标会话点击“AI 提炼”。

## 许可证

MIT License。详见 `LICENSE`。
