# 架构评审：Hana Code Atlas `pipeline/` Python 管线是否应改写为 Go / Rust

> 评审人：高见远（架构师）  ·  类型：**架构评审（不写代码）**  ·  语言：中文
> 评审对象：`plugins/hana-code-atlas/pipeline/`（adapter.py / enhance.py / overview.py / pipeline.py / hana_adapter.py）

---

## 0. 已亲自核实的事实（读源码确认）

| 事实 | 证据 | 对重写决策的含义 |
|------|------|------------------|
| **零第三方依赖** | 5 个文件的 import 全为 stdlib（argparse/hashlib/json/os/subprocess/time/shutil/fnmatch/math/collections/pathlib/typing/sys） | 不存在「Python 依赖地狱」问题 |
| **入口由 Node 子进程拉起** | hana_adapter.py 经 `execFile/spawn(shell:false)` 调用；进程内 `import adapter/enhance/overview`，**不二次 spawn** Python（pipeline.py 仅为等价 CLI 变体） | 与宿主的契约是「CLI 子进程 + JSON 文件」，与语言无关 |
| **重活在外部已编译二进制 `cbm`** | adapter.py: `subprocess.run([CBM_BIN, "cli", "query_graph", json.dumps(params)])` | Python 段无法优化图查询耗时 |
| **规模硬上限 1e5 行** | adapter.py:28 `QUERY_ROW_LIMIT = 100_000`，超限直接 raise | JSON 体积被锁定，系统语言无爆量空间 |
| **计算特征 = O(N) + dict 查重** | `used_ids` set、`qn_to_ua_id` 映射、`hashlib.sha1` 去重、`fnmatch` 过滤、`collections.Counter` 聚合 | 全在 CPython 的 C 加速路径内 |
| **单线程批处理** | 无 threading/asyncio；插件 `maxConcurrentBuilds` 默认 1 | 无并行需求，goroutine/rayon 无用武之地 |
| **需要 Python ≥ 3.10** | 配置项 `pythonBinary` 让用户指定解释器；代码用 `X | None` 注解（经 `from __future__ import annotations` 惰性化，实际对老版本更宽容） | 唯一真实「痛点」= Python 运行时依赖 |

**结论性观察**：这是一层**确定性的 JSON 重塑胶水**，而非计算/系统程序。真正占时间的（cbm 子进程）在 Python 控制范围之外；Python 自己负责的部分（解析/字典/哈希/JSON 序列化）绝大多数跑在 CPython 的 C 实现上。

---

## 1. 逐维度分析：Go / Rust 重写是否必要或有益？

| 维度 | 现状（Python） | Go 重写影响 | Rust 重写影响 | 维度结论 |
|------|----------------|-------------|---------------|----------|
| **原始性能（吞吐/延迟）** | 主导耗时 = cbm 子进程冷启动+图查询（秒级，Python 不可控）；Python 段 = C 加速 `json` / `hashlib` + O(N) dict（1e5 行下约数十~数百 ms） | `encoding/json` 为反射式，实测常**慢于** CPython `json`；需 jsoniter/sonic 才追平 | `serde` 最快，但需强类型 struct；松散 dict 反成负担 | **无收益**（适配段≈持平，外部段=0） |
| **并发 / 并行** | 单 build、单线程、`maxConcurrentBuilds=1` | goroutine 无处可用 | rayon/tokio 无处可用 | **无收益** |
| **内存占用** | 每 node dict 开销大，1e5 节点峰值约 50–150 MB | 可压到 10–30 MB | 可压到 10–30 MB | 理论收益，**但非瓶颈**（一次性批处理，非常驻） |
| **分发与运行时依赖** | 宿主需 Python ≥ 3.10（`pythonBinary` 已缓解） | 单静态二进制，消除该依赖 | 单二进制，消除该依赖 | **唯一真实痛点**；但可用「冻结 Python」实现，不必换语言 |
| **正确性 / 安全性** | 纯 stdlib、确定性、无网络；输入来自受信任本地二进制 + 用户自有 overlay；无内存不安全面 | 内存安全优势无对应风险可消除；强类型反而易在映射表/类型转换引入 bug | 同左，且对动态 JSON 更僵化 | **不提升，反增风险** |
| **维护成本** | 映射表/`fnmatch`/dict 重塑极简；overlay 语义（enhance/overview）最易变 | struct/typed-JSON 样板；每次 schema 变更需重编译（Go 编译快） | serde derive + 类型体操最多；重编译最慢 | **Python 最低** |

**维度小结**：六个维度中，五个维度下 Go/Rust 要么持平、要么负收益；唯一正向维度（运行时依赖）与「换语言」无关，用冻结即可解决。

---

## 2. 若迁移有理，Go 与 Rust 谁更契合？（注意：负载是 JSON 胶水，非计算/系统）

| 考量 | Go | Rust |
|------|----|------|
| JSON 性能 | 反射式，一般（需 jsoniter/sonic 追平） | 最快（serde） |
| 对「松散无类型 dict」的适配 | 尚可，样板中等 | **极差**，胶水代码样板最多 |
| 分发 / 交叉编译 | 极简（单静态二进制） | 可行，但需更多配置 |
| 团队产能与编译速度 | 上手快、编译快 | 学习曲线陡、编译慢 |
| 契合度判定 | **更契合「胶水脚本编译化」** | overkill，负收益 |

> 即便认定「需要单文件二进制」，Go 也是两者中更合理的选择；但本负载的本质（动态 JSON 重塑）恰恰是 Python 最舒服、Rust 最别扭的场景——这反过来说明**不需要换语言**。

---

## 3. 真正瓶颈在哪？系统语言能在哪些地方带来提升？

```mermaid
flowchart TD
    A[Node 调用 hana_adapter.py<br/>execFile/spawn shell:false] --> B[Python 启动 ~30-50ms<br/>★可优化空间≈0]
    B --> C[adapter.convert:<br/>循环 schema 的 label/edge_type<br/>各 spawn 一次 cbm CLI]
    C --> D{{cbm 子进程<br/>冷启动 + Cypher 图查询<br/>★主导瓶颈·Python 不可控}}
    D --> E[Python 解析 JSON<br/>json.loads · C 加速]
    E --> F[O(N) 重塑:<br/>dict 查重 / sha1 / fnmatch / Counter<br/>N≤100_000]
    F --> G[enhance 语义 overlay<br/>纯 JSON 操作]
    G --> H[overview 架构投影<br/>度数统计 + backbone 聚合]
    H --> I[materialize 拷贝源码<br/>shutil.copy2 · 单文件≤1MB]
    I --> J[json.dump 写出<br/>C 加速]
    style D fill:#f66,color:#fff
    style B fill:#ffd,color:#000
    style F fill:#dfd,color:#000
```

**瓶颈分解（按真实占比）**：

1. **外部 `cbm` 子进程（冷启动 + 图查询）** —— 绝对主导（秒级）。Python 无法触及；改写适配段语言对它**零影响**。优化只能：(a) 减少 `query_graph` 调用次数（adapter.py 当前按每个 node label / edge type 各发一次，典型 10–20 次，可合并为更少批量查询）；或 (b) 直接链接 cbm 的库而非走 CLI。
2. **JSON 解析 / 写入** —— 受 1e5 上限约束，CPython 的 C 路径已是最优；**非瓶颈**。
3. **(次要) cbm 调用次数** —— 与语言无关，批量化即可。

**系统语言「能」提升的地方**：几乎只在「把 1e5 上限放大 10–100 倍且 JSON 体积爆量」的假设场景下，Rust `serde` 的解析/序列化才显现差异——但那会先撞上 cbm 查询与磁盘 I/O，且需重新论证规模上限。当前规模下，**系统语言无任何真实提升点**。

---

## 4. 裁决与备选方案风险

### ✅ 一句话裁决

**改用方案 d（Nuitka/PyInstaller 冻结 Python 源码为原生二进制，并与 cbm 一并打包随插件分发），而非重写为 Go/Rust。** 更新：用户已明确本插件作为 Hana agent 插件需快速部署、减少外部依赖，等价于「宿主零 Python 运行时」已成为产品硬约束，故由方案 (a) 切换至方案 (d)；冻结与重写的构建/签名矩阵成本相同，但冻结保留 Python 源码为事实源与既有 pytest，规避 mapping/overlay 逻辑回归风险，且同样能产出「单文件二进制、零运行时依赖」的部署收益。

> 依据：本管线只是对已编译 `cbm` 二进制返回的 JSON 做 O(N) 重塑，重活在外部、体积被 1e5 行锁死，CPython 的 C 加速 JSON/哈希路径已无重写空间；Go/Rust 仅在「消除 Python 运行时依赖」这一与语言无关的目标上有边际收益，且会牺牲当前 Python 胶水的可读性与迭代速度。

### 各方案风险矩阵

| 方案 | 收益 | 风险 / 成本 | 评估 |
|------|------|-------------|------|
| **(a) 保持 Python** | 零重写成本；保留可读性与最快迭代；匹配当前负载 | 宿主需 Python≥3.10（已有 `pythonBinary` 配置缓解）；CPython 冷启动 ~30–50ms（相对 cbm 查询可忽略） | **最优·低风险·推荐** |
| **(b) 重写 Go** | 单二进制分发 | `encoding/json` 反射性能未必优于 CPython；松散 dict 需强类型样板；初期重写得不偿失 | 收益≈0，成本中高 · **不推荐** |
| **(c) 重写 Rust** | 最快最小二进制 | 对动态 JSON 胶水极不友好、样板最多、编译慢、团队 Rust 产能未知；正确性风险最高 | overkill，负收益 · **不推荐** |
| **(d) 冻结成原生二进制**<br/>（Nuitka / PyInstaller / shiv） | **消除 Python 运行时依赖**（唯一真实痛点）；保留现有 Python 逻辑与代码 | 引入构建/交叉编译步骤（需为 Hana 各宿主平台出包）；PyInstaller 产物 10–50MB、Nuitka 更瘦但构建慢；**shiv 仍需 Python 运行时，应排除**；需验证 `sys.path.insert` + `__file__` 路径解析在冻结后行为 | 当「去 Python 依赖」成为产品硬约束时的**正确解**；否则不必要 |

---

## 5. 建议的下一步（若采纳 a）

1. **无需重写**。把工程精力放在与语言无关的真正优化上：
   - 合并 adapter.py 中按 label/edge_type 多次 `query_graph` 的调用为更少批量查询（减少 cbm 子进程次数）。
   - 若未来 cbm 暴露库/API，考虑直接链接而非 CLI，消除子进程冷启动。
2. **产品风险监控**：仅当「宿主必须零 Python 运行时」被上升为产品硬约束时，启动方案 d（优先 Nuitka，因其产物更瘦且保留 Python 语义）；在此之前不要动语言。
3. **不变更接口契约**：Node 侧的 `execFile/spawn(shell:false)` + JSON 文件约定保持，确保方案 a/d 都可无感切换。

---

*附：本评审未对 `profiles/` 目录（overlay 数据）做分析——其为配置数据，不影响「是否换语言」的技术判断。*
