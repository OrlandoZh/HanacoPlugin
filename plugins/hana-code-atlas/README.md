# Hana Code Atlas

HanaAgent 原生代码架构可视化插件：以 codebase-memory-mcp（cbm）提供确定性结构事实，使用 Python cbm2ua 管线生成 Full/Architecture 双 Bundle，并在 Hana 内嵌的 Understand Anything 2.9.0 Human Layout Viewer 中浏览、检索和追踪源码。

当前版本：`0.2.5`  
最低 HanaAgent：`0.407.15`  
验证记录：[docs/VALIDATION.md](docs/VALIDATION.md)

Viewer 固定启用 UA 2.9.0 内置的简体中文 locale，并以离线 Pixelarticons 为概览、学习、深入、文件、类和路径等高频控件提供像素农场风格图标。图标只增强导航，不改变图数据、布局算法或交互状态。

## 架构

| 层 | 实现 | 职责 |
|---|---|---|
| 结构事实 | codebase-memory-mcp 0.8.1+ | 确定性索引、依赖与影响关系 |
| 语义投影 | `pipeline/*.py` | cbm 到 UA schema、中文 overlay、架构聚合 |
| 交互展现 | UA Viewer 2.9.0 + Human Layout | 搜索、Path Finder、源码预览、ELK 布局 |

派生 Bundle 用于导航和解释，不替代 cbm 图数据库或项目源码这一事实源。插件不启动独立 Viewer HTTP 服务，不在运行时下载资源，也不内置 cbm 二进制。

## Bundle

| Bundle | 用途 | Hermes 实测规模 |
|---|---|---|
| Architecture | 宏观域、主干关系和导览 | 39 节点 / 41 边 / 6 层 |
| Full | 搜索、Path Finder、影响分析和源码定位 | 8,864 节点 / 20,604 边 / 11 层 |

有兼容 overlay 时生成双 Bundle；没有 overlay 时只生成结构化 Full Bundle。

`0.2.1` 支持在控制台调用 Hana 已配置的 chat Provider 生成 Architecture overlay 草稿，并在确定性校验后调用可独立选择的第二个模型进行语义复审。复审只生成绑定草稿 SHA、源 Full Build 和 reviewer 身份的报告，不修改 overlay；用户必须阅读 verdict、置信度、findings 和路径证据后显式确认采用。采用后仍需重新构建，任一模型输出都不会直接成为当前图谱。

`0.2.2` 补齐 Hana Provider 发现与临时凭据读取能力声明，并让发现失败可见；完整手动 Provider/模型 pair 可继续交给 Hana 临时凭据接口验证。

`0.2.3` 恢复生成与复审的 Provider/模型联动下拉：Provider 选项显示模型数量，选择后只列出该 Provider 的 chat 模型。手动 ID 收入显式的“使用自定义 ID”高级开关。Architecture generator 同时改用版本化 runtime 入口，隔离特定的旧 generator 导出；HanaAgent 0.412.7 的传递依赖仍可能被热加载缓存，升级后必须完整重启 Hana。

`0.2.4` 为 Architecture 生成和仅复审任务增加后端状态机驱动的阶段百分比进度。页面显示当前阶段、百分比和原生进度条；刷新后从 `activeTask.progress` 恢复。Provider 不提供模型内部 token 进度，因此模型生成和复审阶段不会使用定时器伪造连续增长。

`0.2.5` 将 Architecture 正常路径收敛为四步状态和一个动态主操作：生成、AI 复审、人工确认、重建。人工双 SHA 确认成功后由前端立即启动独立构建任务；启动失败仍保留 adopted overlay，并把主操作切换为重建恢复。构建成功后自动打开 Architecture，重新生成等低频操作收入高级区域。

## 安装

源码目录执行：

```bash
npm run test:all
npm run pack:plugin
```

产物位于：

```text
dist/hana-code-atlas-0.2.5.zip
dist/hana-code-atlas-0.2.5.zip.sha256
```

在 HanaAgent 插件设置中安装 zip，并批准 `full-access`。安装包内嵌离线 Viewer 资产，不需要 `npm install`。

## 依赖与配置

| Key | 默认值 | 说明 |
|---|---:|---|
| `cbmBinary` | `""` | cbm CLI 路径；空值优先复用 Hana MCP connector，再使用 PATH |
| `cbmCacheDir` | `""` | cbm registry/cache 目录，对应 `CBM_CACHE_DIR`；空值自动复用进程环境或 Hana MCP connector |
| `pythonBinary` | `python3` | Python 3.10+ 可执行文件 |
| `pipelineTimeoutSeconds` | `300` | 整体管线超时，范围 30–3600 秒 |
| `cbmTimeoutSeconds` | `120` | 单条 cbm 命令超时，范围 5–900 秒且不超过整体超时 |
| `maxConcurrentBuilds` | `1` | 全局并发，范围 1–4 |
| `architectureProviderId` | `""` | 可选的默认 Hana chat Provider；界面选择优先 |
| `architectureModel` | `""` | 可选的默认 Architecture 生成模型；界面选择优先 |
| `architectureReviewProviderId` | `""` | 可选的默认 AI 复审 Provider；留空复用生成 Provider |
| `architectureReviewModel` | `""` | 可选的默认 AI 复审模型；留空复用生成模型 |

cbm 的项目 registry 可能由 `CBM_CACHE_DIR` 选择，并不一定是全局唯一状态。插件按“插件设置 → 进程环境 → Hana MCP connector → cbm 默认目录”解析 cbm 命令与 registry；一般无需重复填写。需要覆盖自动发现结果时，可把目标 cache 目录显式填入 `cbmCacheDir`。例如：

```text
<workspace>/reference-pool/.graph/codebase-memory-mcp
```

缺少 cbm 或 Python 时，已有 Bundle 仍可只读浏览，但不能新建构建。

## 使用

1. 先用 cbm 索引目标项目。
2. 在插件页使用“已索引项目”搜索表按项目名、cbm 标识或路径筛选；未注册项可选择并填入根目录，已注册项可直接打开。也可以手工输入项目绝对路径。插件通过 realpath 建立 opaque `projectId`，并按 `root_path` 匹配 cbm 项目名。
3. 点击“开始构建”，先生成作为事实基线的 Full Bundle。
4. 需要 Architecture 时，分别选择生成模型和 AI 复审模型，按四步状态中的唯一主操作推进。系统依次完成生成、确定性校验和独立语义复审；复审失败时主操作自动变为“仅重试 AI 复审”，不会重新生成草稿。
5. 在审查窗口阅读 verdict、置信度、findings 和路径证据，核对语义层、宏观域及路径规则后勾选确认。点击“采用并开始重建”会先完成双 SHA adopt，再启动独立构建任务；构建成功后自动打开 Architecture。若构建启动或执行失败，adopted overlay 保持不变，主操作会提供重建恢复。Full 继续支持搜索、Path Finder 和源码快照预览。

成功构建写入不可变 `builds/<buildId>`，再原子更新 `current.json`。每个任务在 spawn 前把已采用 overlay 快照为 `staging/<taskId>/overlay.input.json`，运行中的构建不再读取可变的项目级 overlay。只保留 current 与 previous；失败构建不会切换当前指针。

## 安全边界

- 浏览器后续请求仅接收严格的 16 位十六进制 `projectId`，不接收任意项目路径。
- Python 通过参数数组、`shell: false` 和受限配置启动；POSIX 下使用进程组取消，timeout/cancel 不提前释放并发槽。
- `pipelineTimeoutSeconds`、`cbmTimeoutSeconds` 和并发数在 manifest 与代码中双重限界。
- 源码 API 只读取当前构建中 `source-preview/` 的物化文件，并要求路径出现在 `source-preview-meta.json`。
- UA JSON 文件名和 Bundle 名均使用 allowlist。
- `pluginSurfaceSession` 由 Hana 宿主验证并剥离；控制页优先使用 `hana.api`，兼容路径通过同一 surface header，不实现第二套认证。
- Viewer 资产固定为 UA 2.9.0 commit `f08763d11d0202a8a8f52b5dedda6d1b2e2ebac8`，以完整 asset-set SHA-256 验证。
- 锁定 Viewer dist 额外派生单文件 JS/CSS，并用独立 manifest 绑定源 asset-set、生成器版本、输出大小与 SHA-256；原始 18 个文件保持不变。
- 控制页通过认证 API 获取自包含 frame HTML，再写入 `iframe.srcdoc`；UA JS/CSS 不再从嵌套 iframe 发起二次网络请求。
- 兼容静态路由只服务 Viewer manifest 登记文件，拒绝路径穿越和未登记资源；当前 frame 不依赖该路由。
- wrapper 将 Viewer 的 `config.json.outputLanguage` 固定覆盖为 `zh`，复用 UA 自带中文词典，不修改锁定 dist 或已生成 Bundle。
- Architecture LLM 请求只复用 Hana `provider:models-by-type` 与 `provider:credentials`；插件不保存或返回凭据，响应正文限 256 KiB，调用有超时和取消，重定向被拒绝。
- 仓库文本作为不可信数据进入提示词，不能改变任务或触发工具；生成模型只写 `overlay-draft.json`，复审模型只写 `overlay-review.json`。采用同时校验草稿 SHA、复审报告 SHA 和源 Full Build，最终仍需人工确认。overlay SHA 在 Node 与 Python 间统一使用递归键排序、无空白 UTF-8 JSON；项目元数据记录实际 adopted overlay 的 SHA。
- 像素导航图标来自 MIT 许可的 Pixelarticons，SVG path、运行时 overlay 和许可证均随插件离线打包；不复制游戏素材，也不发起外部资源请求。

## 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/viewer` | Hana 控制页 |
| GET | `/frame?projectId&bundle` | 内联单文件 JS/CSS 的自包含 UA Viewer frame |
| GET | `/assets/ua/viewer/*` | manifest allowlist 内的兼容静态资源路由，当前 frame 不依赖 |
| GET / POST | `/api/projects` | 已注册项目列表与注册 |
| GET | `/api/project-candidates` | 从解析后的 cbm registry 返回仍可访问的索引根目录、规模和来源诊断 |
| DELETE | `/api/projects/:projectId` | 删除插件登记和派生数据，不删除源码 |
| GET | `/api/status?projectId&bundle` | Bundle 与 current/previous 状态 |
| POST | `/api/build` | 启动异步构建 |
| GET | `/api/tasks/:taskId` | 查询任务 |
| POST | `/api/tasks/:taskId/cancel` | 取消运行中的进程树 |
| GET | `/api/architecture/providers` | 列出 Hana chat Provider 与模型 |
| GET | `/api/architecture?projectId` | 读取语义草稿、采用态和活动任务状态 |
| POST | `/api/architecture/generate` | 启动有界 Architecture 草稿生成、确定性校验和独立 AI 复审 |
| POST | `/api/architecture/review` | 对现有确定性草稿单独重试 AI 复审，不重新生成 overlay |
| GET / POST | `/api/architecture/tasks/:taskId[/cancel]` | 查询或取消语义生成/复审任务；原子提交态不可取消 |
| POST | `/api/architecture/adopt` | 以草稿与复审报告双 SHA-256 确认采用 |
| GET | `/api/ua/:fileName` | 读取 allowlisted UA JSON |
| GET | `/api/source` | 读取登记的源码快照 |

`routes/*.js` 和 `tools/*.js` 由 Hana PluginManager 自动发现；`index.js` 只处理生命周期初始化和卸载取消。

## Agent 工具

| 工具 | 说明 |
|---|---|
| `code_atlas_project` | 注册或移除项目 |
| `code_atlas_status` | 检测依赖并查询项目/Bundle 状态 |
| `code_atlas_build` | 启动构建并返回 `taskId` |
| `code_atlas_validate` | 校验当前 Full 或 Architecture Bundle |

## 开发与验证

```bash
npm test                 # Node 测试
npm run test:python      # Python 测试
npm run test:all         # 两者
npm run pack:plugin      # 可重现 zip + SHA-256 sidecar
```

打包采用显式 allowlist、固定 mtime、排序文件列表和 `zip -X`；连续使用相同输入打包应产生相同 SHA-256。`scripts/`、`tests/`、缓存、symlink 和运行时产物不会进入安装包。

详细设计见 [docs/DESIGN.md](docs/DESIGN.md)，原型问题闭合情况见 [docs/INITIAL_AUDIT.md](docs/INITIAL_AUDIT.md)。

## 已知边界

- LLM 只生成待审草稿，不自动采用、不直接更新当前 Bundle；Architecture 的语义正确性仍需人工负责。
- 生成与构建任务历史只保存在当前 Hana 进程内；中断恢复属于后续阶段。
- 当前只在 macOS/HanaAgent 0.407.15 上完成真实宿主与浏览器验收；Windows 进程树行为尚未做实机验证。
- 超大图谱可能需要后续增加范围化构建或分层加载策略。
