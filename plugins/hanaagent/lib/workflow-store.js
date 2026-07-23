import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Workflow shape, validation ideas, and palette semantics are adapted from
// Open Agent Builder's MIT-licensed workflow model, translated to HanaAgent's
// local JSON store and zero-dependency runtime.

const VALID_NODE_TYPES = new Set([
  "start",
  "agent",
  "mcp",
  "if-else",
  "while",
  "user-approval",
  "transform",
  "set-state",
  "end",
  "note"
]);

const NODE_LABELS = {
  start: "开始（Start）",
  agent: "智能体（Agent）",
  mcp: "MCP",
  "if-else": "条件（Condition）",
  while: "循环（While）",
  "user-approval": "用户审批（User approval）",
  transform: "转换（Transform）",
  "set-state": "设置状态（Set state）",
  end: "结束（End）",
  note: "备注（Note）"
};

const WORKFLOW_SCHEMA = "hanaagent.workflow.v1";

export function listWorkflowTemplates() {
  return deepClone(defaultWorkflowTemplates());
}

export function listWorkflows(dataDir, filters = {}) {
  let workflows = readWorkflowFile(dataDir).workflows.map(normalizeWorkflow).filter(Boolean);
  if (filters.category) workflows = workflows.filter((workflow) => workflow.category === clean(filters.category));
  if (filters.query) {
    const needle = clean(filters.query).toLowerCase();
    workflows = workflows.filter((workflow) => [
      workflow.name,
      workflow.description,
      workflow.category,
      ...(workflow.tags || [])
    ].join(" ").toLowerCase().includes(needle));
  }
  return workflows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getWorkflow(dataDir, workflowId) {
  const id = clean(workflowId);
  return listWorkflows(dataDir, { includeArchived: true }).find((workflow) => workflow.id === id) || null;
}

export function createWorkflow(dataDir, input = {}) {
  const templateId = clean(input.templateId || input.template || input.fromTemplate);
  const template = templateId ? listWorkflowTemplates().find((item) => item.id === templateId) : null;
  const base = template || simpleAgentTemplate();
  const now = new Date().toISOString();
  const workflow = normalizeWorkflow({
    ...base,
    ...pickWorkflowFields(input),
    id: clean(input.id) || randomUUID(),
    name: clean(input.name || input.title) || (template ? template.name : base.name),
    description: clean(input.description) || clean(base.description),
    category: clean(input.category) || clean(base.category) || "HanaAgent",
    tags: Array.isArray(input.tags) ? normalizeTags(input.tags) : normalizeTags(base.tags),
    nodes: Array.isArray(input.nodes) ? input.nodes : base.nodes,
    edges: Array.isArray(input.edges) ? input.edges : base.edges,
    createdAt: now,
    updatedAt: now,
    sourceTemplateId: template ? template.id : clean(input.sourceTemplateId)
  });
  if (!workflow.name) return { ok: false, error: "workflow_name_required" };
  const file = readWorkflowFile(dataDir);
  file.workflows.push(workflow);
  writeWorkflowFile(dataDir, file);
  return { ok: true, workflow, validation: validateWorkflow(workflow) };
}

export function updateWorkflow(dataDir, workflowId, updates = {}) {
  const id = clean(workflowId);
  const file = readWorkflowFile(dataDir);
  const index = file.workflows.findIndex((workflow) => clean(workflow.id) === id);
  if (index === -1) return { ok: false, error: "workflow_not_found" };
  const current = normalizeWorkflow(file.workflows[index]);
  const next = normalizeWorkflow({
    ...current,
    ...pickWorkflowFields(updates),
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
    nodes: Array.isArray(updates.nodes) ? updates.nodes : current.nodes,
    edges: Array.isArray(updates.edges) ? updates.edges : current.edges
  });
  file.workflows[index] = next;
  writeWorkflowFile(dataDir, file);
  return { ok: true, workflow: next, validation: validateWorkflow(next) };
}

export function deleteWorkflow(dataDir, workflowId) {
  const id = clean(workflowId);
  const file = readWorkflowFile(dataDir);
  const before = file.workflows.length;
  file.workflows = file.workflows.filter((workflow) => clean(workflow.id) !== id);
  if (file.workflows.length === before) return { ok: false, error: "workflow_not_found" };
  writeWorkflowFile(dataDir, file);
  return { ok: true, deleted: true, workflowId: id };
}

export function validateWorkflow(workflow) {
  const normalized = normalizeWorkflow(workflow);
  const errors = [];
  if (!normalized) {
    return [{ nodeId: "workflow", field: "workflow", message: "Workflow 无效" }];
  }
  const nodeIds = new Set();
  let hasStart = false;
  let hasEnd = false;
  for (const node of normalized.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push({ nodeId: node.id, field: "id", message: "节点 ID 必须唯一" });
    }
    nodeIds.add(node.id);
    if (node.type === "start") hasStart = true;
    if (node.type === "end") hasEnd = true;
    errors.push(...validateWorkflowNode(node));
  }
  if (!hasStart) errors.push({ nodeId: "workflow", field: "nodes", message: "Workflow 必须包含开始（Start）节点" });
  if (!hasEnd) errors.push({ nodeId: "workflow", field: "nodes", message: "Workflow 应以结束（End）节点收尾" });

  const edgeIds = new Set();
  for (const edge of normalized.edges) {
    if (!edge.id) errors.push({ nodeId: "workflow", field: "edges", message: "边 ID 必填" });
    if (edgeIds.has(edge.id)) errors.push({ nodeId: edge.id, field: "id", message: "边 ID 必须唯一" });
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source)) errors.push({ nodeId: edge.id || "edge", field: "source", message: "边的源节点不存在" });
    if (!nodeIds.has(edge.target)) errors.push({ nodeId: edge.id || "edge", field: "target", message: "边的目标节点不存在" });
  }

  for (const node of normalized.nodes) {
    if (node.type === "start" || node.type === "note") continue;
    const incoming = normalized.edges.some((edge) => edge.target === node.id);
    if (!incoming) errors.push({ nodeId: node.id, field: "connections", message: "节点未连接到 Workflow" });
  }
  return errors;
}

export function validateWorkflowNode(node) {
  const normalized = normalizeWorkflowNode(node);
  if (!normalized) return [{ nodeId: "node", field: "node", message: "节点无效" }];
  const errors = [];
  const data = normalized.data || {};
  if (!VALID_NODE_TYPES.has(normalized.type)) {
    errors.push({ nodeId: normalized.id, field: "type", message: "不支持的节点类型" });
  }
  if (normalized.type === "agent") {
    if (!clean(data.instructions)) errors.push({ nodeId: normalized.id, field: "instructions", message: "智能体（Agent）节点必须填写指令" });
  }
  if (normalized.type === "mcp") {
    if (!clean(data.mcpAction || data.mcpTool) && !normalizeMcpServers(data.mcpServers || data.mcpTools).length) {
      errors.push({ nodeId: normalized.id, field: "mcp", message: "MCP 节点应指定工具或服务器" });
    }
  }
  if (normalized.type === "if-else" && !clean(data.condition)) {
    errors.push({ nodeId: normalized.id, field: "condition", message: "条件（Condition）节点必须包含条件" });
  }
  if (normalized.type === "while" && !clean(data.whileCondition || data.condition)) {
    errors.push({ nodeId: normalized.id, field: "condition", message: "循环（While）节点必须包含条件" });
  }
  if (normalized.type === "transform" && !clean(data.transformScript) && !clean(data.outputMapping)) {
    errors.push({ nodeId: normalized.id, field: "transformScript", message: "转换（Transform）节点应填写转换脚本或映射" });
  }
  if (normalized.type === "set-state" && !clean(data.stateKey)) {
    errors.push({ nodeId: normalized.id, field: "stateKey", message: "设置状态（Set state）节点必须填写变量名" });
  }
  return errors;
}

export function previewWorkflowExecution(workflow, input = {}) {
  const normalized = normalizeWorkflow(workflow);
  if (!normalized) return { ok: false, error: "workflow_invalid" };
  const validation = validateWorkflow(normalized);
  const warnings = validation.filter((item) => item.field !== "connections");
  const startedAt = new Date().toISOString();
  const nodeResults = {};
  const path = [];
  const variables = { input: input && typeof input === "object" ? input : {}, state: {} };
  let current = normalized.nodes.find((node) => node.type === "start") || normalized.nodes[0] || null;
  let lastOutput = input && typeof input === "object" ? input : {};
  let status = "completed";
  let guard = 0;

  while (current && guard < 80) {
    guard += 1;
    path.push(current.id);
    const result = previewNode(current, {
      input,
      variables,
      lastOutput,
      iteration: countVisits(path, current.id)
    });
    nodeResults[current.id] = result;
    lastOutput = result.output || lastOutput;
    if (current.type === "user-approval") status = "paused";
    if (current.type === "end") break;
    current = nextNodeForPreview(normalized, current, result);
  }

  if (guard >= 80) {
    status = "failed";
    warnings.push({ nodeId: "workflow", field: "execution", message: "为防止循环，预览在 80 个节点后停止" });
  }

  const completedAt = new Date().toISOString();
  return {
    ok: true,
    execution: {
      id: randomUUID(),
      workflowId: normalized.id,
      status,
      currentNodeId: status === "paused" ? path[path.length - 1] : "",
      nodeResults,
      path,
      startedAt,
      completedAt: status === "paused" ? "" : completedAt,
      warnings
    },
    state: variables,
    validation
  };
}

export function workflowToMissionInput(workflow, input = {}) {
  const normalized = normalizeWorkflow(workflow);
  if (!normalized) return { ok: false, error: "workflow_invalid" };
  const agentNodes = workflowExecutionOrder(normalized).filter((node) => node.type === "agent");
  const mcpNodes = normalized.nodes.filter((node) => node.type === "mcp");
  const approvalNodes = normalized.nodes.filter((node) => node.type === "user-approval");
  const lanes = agentNodes.map((node, index) => {
    const data = node.data || {};
    const tools = [
      ...normalizeStringList(data.tools),
      ...normalizeStringList(data.mcpServers).map((server) => `mcp:${server}`),
      ...mcpNodes.map((mcp) => clean(mcp.data?.mcpAction || mcp.data?.mcpTool || mcp.data?.label)).filter(Boolean)
    ];
    return {
      id: clean(data.roleId || node.id) || `workflow-agent-${index + 1}`,
      roleId: clean(data.roleId || node.id) || `workflow-agent-${index + 1}`,
      label: clean(data.label || data.nodeName || data.name) || `智能体（Agent）${index + 1}`,
      lane: clean(data.lane || data.roleId || node.id) || `workflow-agent-${index + 1}`,
      mission: clean(data.instructions) || clean(data.systemPrompt) || "使用带检查点（Checkpoint）证据的方式执行此 Workflow 步骤。",
      model: clean(data.model),
      tools,
      mcpServers: normalizeMcpServers(data.mcpServers || data.mcpTools),
      reviewRequired: approvalNodes.length > 0 || Boolean(data.reviewRequired),
      priority: index === 0 ? "high" : "medium"
    };
  });
  const inputVariables = normalized.nodes.find((node) => node.type === "start")?.data?.inputVariables || [];
  const goal = clean(input.goal || input.mission || input.prompt)
    || workflowGoalFromNodes(normalized)
    || normalized.description
    || normalized.name;
  return {
    ok: true,
    missionInput: {
      goal,
      title: clean(input.title) || normalized.name,
      notes: [
        clean(input.notes),
        workflowMissionNotes(normalized, inputVariables)
      ].filter(Boolean).join("\n\n"),
      mode: clean(input.mode) || "dispatch",
      templateId: `workflow:${normalized.id}`,
      templateLabel: `Workflow：${normalized.name}`,
      sessionPath: clean(input.sessionPath),
      agentId: clean(input.agentId),
      maxWorkers: lanes.length || 1,
      lanes: lanes.length ? lanes : [{
        id: "workflow-runner",
        roleId: "workflow-runner",
        label: "Workflow 运行器（Workflow Runner）",
        lane: "workflow",
        mission: goal,
        priority: "high"
      }],
      workflow: {
        id: normalized.id,
        name: normalized.name,
        nodeCount: normalized.nodes.length,
        edgeCount: normalized.edges.length
      }
    }
  };
}

export function autoLayoutWorkflow(workflow) {
  const normalized = normalizeWorkflow(workflow);
  if (!normalized) return null;
  const layers = new Map();
  const queue = [];
  const start = normalized.nodes.find((node) => node.type === "start") || normalized.nodes[0];
  if (start) {
    layers.set(start.id, 0);
    queue.push(start.id);
  }
  while (queue.length) {
    const nodeId = queue.shift();
    const layer = layers.get(nodeId) || 0;
    for (const edge of normalized.edges.filter((item) => item.source === nodeId)) {
      if (!layers.has(edge.target)) {
        layers.set(edge.target, layer + 1);
        queue.push(edge.target);
      }
    }
  }
  for (const node of normalized.nodes) {
    if (!layers.has(node.id)) layers.set(node.id, Math.max(0, ...layers.values()) + 1);
  }
  const byLayer = new Map();
  for (const node of normalized.nodes) {
    const layer = layers.get(node.id) || 0;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(node);
  }
  const nodes = [];
  for (const [layer, layerNodes] of byLayer.entries()) {
    const offsetY = Math.max(80, 230 - ((layerNodes.length - 1) * 72));
    layerNodes.forEach((node, index) => {
      nodes.push({
        ...node,
        position: { x: 80 + layer * 240, y: offsetY + index * 150 }
      });
    });
  }
  return { ...normalized, nodes, updatedAt: new Date().toISOString() };
}

function previewNode(node, context) {
  const now = new Date().toISOString();
  const data = node.data || {};
  const base = {
    nodeId: node.id,
    status: "completed",
    input: context.lastOutput || context.input || {},
    startedAt: now,
    completedAt: now,
    toolCalls: []
  };
  if (node.type === "start") {
    const variables = {};
    for (const variable of Array.isArray(data.inputVariables) ? data.inputVariables : []) {
      const name = clean(variable.name);
      if (!name) continue;
      variables[name] = context.input?.[name] ?? variable.defaultValue ?? "";
    }
    context.variables.input = { ...variables, ...(context.input && typeof context.input === "object" ? context.input : {}) };
    return { ...base, output: context.variables.input };
  }
  if (node.type === "agent") {
    return {
      ...base,
      output: {
        preview: true,
        kind: "agent",
        label: data.label || data.name || node.id,
        model: data.model || "",
        instructions: data.instructions || "",
        outputFormat: data.outputFormat || "text"
      }
    };
  }
  if (node.type === "mcp") {
    const toolName = data.mcpAction || data.mcpTool || data.label || "mcp-tool";
    return {
      ...base,
      output: { preview: true, kind: "mcp", action: toolName, servers: normalizeMcpServers(data.mcpServers || data.mcpTools) },
      toolCalls: [{ name: toolName, arguments: data.mcpParams || {}, output: "preview-only" }]
    };
  }
  if (node.type === "transform") {
    return {
      ...base,
      output: {
        preview: true,
        kind: "transform",
        safeMode: true,
        mapping: data.outputMapping || "",
        scriptSummary: firstLine(data.transformScript || "转换（Transform）已记录，但预览不会执行。")
      }
    };
  }
  if (node.type === "set-state") {
    const key = clean(data.stateKey);
    const value = interpolate(data.stateValue || "", context.variables);
    if (key) context.variables.state[key] = value;
    return { ...base, output: { key, value } };
  }
  if (node.type === "if-else") {
    const value = evaluatePreviewCondition(data.condition, context);
    return { ...base, output: { condition: data.condition || "", result: value, branch: value ? "if" : "else" } };
  }
  if (node.type === "while") {
    const maxIterations = clampInt(data.maxIterations || data.timeoutMinutes || 1, 1, 12, 1);
    return { ...base, output: { condition: data.whileCondition || data.condition || "", previewIterations: Math.min(context.iteration || 1, maxIterations), maxIterations } };
  }
  if (node.type === "user-approval") {
    return {
      ...base,
      status: "pending-approval",
      completedAt: "",
      output: { approvalMessage: data.approvalMessage || data.label || "在继续前需要审批。" }
    };
  }
  if (node.type === "note") {
    return { ...base, output: { note: data.noteText || data.label || "" } };
  }
  if (node.type === "end") {
    return { ...base, output: { completed: true, result: context.lastOutput || {} } };
  }
  return { ...base, output: { preview: true, kind: node.type } };
}

function nextNodeForPreview(workflow, node, result) {
  let edges = workflow.edges.filter((edge) => edge.source === node.id);
  if (!edges.length) return null;
  if (node.type === "if-else") {
    const branch = result.output?.branch === "else" ? "else" : "if";
    const branchEdge = edges.find((edge) => clean(edge.sourceHandle) === branch || clean(edge.label).toLowerCase() === branch || clean(edge.label).toLowerCase() === (branch === "if" ? "true" : "false"));
    if (branchEdge) return workflow.nodes.find((item) => item.id === branchEdge.target) || null;
  }
  if (node.type === "while") {
    const maxIterations = clampInt(node.data?.maxIterations, 1, 12, 1);
    if (Number(result.output?.previewIterations || 1) >= maxIterations) {
      const breakEdge = edges.find((edge) => clean(edge.sourceHandle) === "break" || clean(edge.label).toLowerCase() === "break");
      if (breakEdge) return workflow.nodes.find((item) => item.id === breakEdge.target) || null;
    }
  }
  edges = edges.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return workflow.nodes.find((item) => item.id === edges[0].target) || null;
}

function workflowExecutionOrder(workflow) {
  const ordered = [];
  const visited = new Set();
  let current = workflow.nodes.find((node) => node.type === "start") || workflow.nodes[0] || null;
  let guard = 0;
  while (current && guard < workflow.nodes.length + 20) {
    guard += 1;
    if (!visited.has(current.id)) {
      ordered.push(current);
      visited.add(current.id);
    }
    const edge = workflow.edges.find((item) => item.source === current.id && item.sourceHandle !== "else")
      || workflow.edges.find((item) => item.source === current.id);
    current = edge ? workflow.nodes.find((node) => node.id === edge.target) || null : null;
  }
  for (const node of workflow.nodes) {
    if (!visited.has(node.id)) ordered.push(node);
  }
  return ordered;
}

function workflowGoalFromNodes(workflow) {
  const firstAgent = workflowExecutionOrder(workflow).find((node) => node.type === "agent");
  return clean(firstAgent?.data?.instructions || firstAgent?.data?.label);
}

function workflowMissionNotes(workflow, inputVariables) {
  const lines = [
    `Workflow：${workflow.name}`,
    workflow.description ? `描述：${workflow.description}` : "",
    inputVariables.length ? `输入：${inputVariables.map((item) => item.name).filter(Boolean).join(", ")}` : "",
    "由 HanaAgent Workflow Builder 编译。保持可见节点顺序，报告阻塞项，并以检查点（Checkpoint）契约结束。"
  ].filter(Boolean);
  const nonAgentNodes = workflow.nodes.filter((node) => !["start", "agent", "end", "note"].includes(node.type));
  for (const node of nonAgentNodes) {
    lines.push(`节点 ${node.id}（${node.type}）：${node.data?.label || node.data?.condition || node.data?.stateKey || ""}`);
  }
  return lines.join("\n");
}

function normalizeWorkflow(value) {
  if (!value || typeof value !== "object") return null;
  const id = clean(value.id);
  const name = clean(value.name || value.title);
  if (!id || !name) return null;
  const createdAt = clean(value.createdAt || value.created_at) || new Date().toISOString();
  const nodes = Array.isArray(value.nodes) ? value.nodes.map(normalizeWorkflowNode).filter(Boolean) : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(value.edges)
    ? value.edges.map((edge, index) => normalizeWorkflowEdge(edge, index)).filter((edge) => edge && nodeIds.has(edge.source) && nodeIds.has(edge.target))
    : [];
  return {
    schema: clean(value.schema) || WORKFLOW_SCHEMA,
    id,
    name,
    description: clean(value.description),
    category: clean(value.category) || "HanaAgent",
    tags: normalizeTags(value.tags),
    estimatedTime: clean(value.estimatedTime || value.estimated_time),
    difficulty: clean(value.difficulty),
    sourceTemplateId: clean(value.sourceTemplateId || value.source_template_id),
    nodes,
    edges,
    createdAt,
    updatedAt: clean(value.updatedAt || value.updated_at) || createdAt
  };
}

function normalizeWorkflowNode(value) {
  if (!value || typeof value !== "object") return null;
  const type = normalizeNodeType(value.type || value.data?.nodeType);
  const id = clean(value.id) || randomUUID();
  const data = value.data && typeof value.data === "object" ? value.data : {};
  return {
    id,
    type,
    position: normalizePosition(value.position),
    data: {
      ...data,
      nodeType: type,
      label: clean(data.label || data.nodeName || NODE_LABELS[type]) || NODE_LABELS[type] || type,
      nodeName: clean(data.nodeName || data.label || NODE_LABELS[type]) || NODE_LABELS[type] || type
    }
  };
}

function normalizeWorkflowEdge(value, index = 0) {
  if (!value || typeof value !== "object") return null;
  const source = clean(value.source);
  const target = clean(value.target);
  if (!source || !target) return null;
  return {
    id: clean(value.id) || `edge-${source}-${target}-${index}`,
    source,
    target,
    type: clean(value.type) || "smoothstep",
    label: clean(value.label),
    sourceHandle: clean(value.sourceHandle || value.source_handle)
  };
}

function normalizeNodeType(value) {
  const normalized = clean(value).toLowerCase();
  if (normalized === "condition" || normalized === "if / else" || normalized === "if") return "if-else";
  if (normalized === "approval") return "user-approval";
  if (normalized === "set state") return "set-state";
  return VALID_NODE_TYPES.has(normalized) ? normalized : "note";
}

function normalizePosition(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  return {
    x: Number.isFinite(x) ? Math.round(x) : 80,
    y: Number.isFinite(y) ? Math.round(y) : 80
  };
}

function normalizeMcpServers(value) {
  if (!Array.isArray(value)) return [];
  return value.map((server) => {
    if (typeof server === "string") return { id: clean(server), name: clean(server), label: clean(server) };
    if (!server || typeof server !== "object") return null;
    const id = clean(server.id || server.name || server.label || server.url);
    if (!id) return null;
    return {
      id,
      name: clean(server.name) || id,
      label: clean(server.label) || clean(server.name) || id,
      url: clean(server.url),
      description: clean(server.description),
      authType: clean(server.authType || server.auth_type) || "host"
    };
  }).filter(Boolean);
}

function pickWorkflowFields(input = {}) {
  const output = {};
  for (const key of ["name", "description", "category", "estimatedTime", "difficulty", "sourceTemplateId"]) {
    if (typeof input[key] === "string") output[key] = input[key];
  }
  if (Array.isArray(input.tags)) output.tags = input.tags;
  return output;
}

function readWorkflowFile(dataDir) {
  ensureWorkflowFile(dataDir);
  try {
    const raw = fs.readFileSync(workflowFilePath(dataDir), "utf8").trim();
    if (!raw) return { workflows: [] };
    const parsed = JSON.parse(raw);
    return { workflows: Array.isArray(parsed?.workflows) ? parsed.workflows : [] };
  } catch {
    return { workflows: [] };
  }
}

function writeWorkflowFile(dataDir, data) {
  ensureWorkflowFile(dataDir);
  const file = workflowFilePath(dataDir);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ workflows: data.workflows || [] }, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function ensureWorkflowFile(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = workflowFilePath(dataDir);
  if (!fs.existsSync(file)) fs.writeFileSync(file, `${JSON.stringify({ workflows: [] }, null, 2)}\n`, "utf8");
}

function workflowFilePath(dataDir) {
  return path.join(dataDir, "workflows.json");
}

function defaultWorkflowTemplates() {
  const now = "2026-01-01T00:00:00.000Z";
  return [
    simpleAgentTemplate(now),
    {
      id: "research-with-approval",
      name: "带审批的研究工作流",
      description: "进行研究，等待人工审批，然后给出最终答案。",
      category: "HanaAgent",
      tags: ["research", "approval", "mission"],
      difficulty: "simple",
      estimatedTime: "3-5 分钟",
      createdAt: now,
      updatedAt: now,
      nodes: [
        node("start", "start", 80, 190, { inputVariables: [{ name: "topic", type: "string", required: true, description: "研究主题", defaultValue: "HanaAgent workflow 吸收" }] }),
        node("research-agent", "agent", 330, 190, { label: "研究智能体（Research Agent）", instructions: "研究 {{input.topic}}。总结有用的事实、未解决的问题和推荐的下一步。", model: "default", outputFormat: "markdown" }),
        node("approval", "user-approval", 590, 190, { label: "审阅关卡（Review Gate）", approvalMessage: "在最终综合前审批研究方向。" }),
        node("final-agent", "agent", 850, 190, { label: "最终撰写者（Final Writer）", instructions: "使用已审批的研究结果，创建包含风险和验证说明的简洁最终报告。", model: "default", outputFormat: "markdown" }),
        node("end", "end", 1110, 190)
      ],
      edges: [
        edge("start", "research-agent"),
        edge("research-agent", "approval"),
        edge("approval", "final-agent"),
        edge("final-agent", "end")
      ]
    },
    {
      id: "mission-dispatch-pipeline",
      name: "任务分派流程",
      description: "将规划、构建、审阅 Workflow 编译为原生 HanaAgent 任务。",
      category: "HanaAgent",
      tags: ["mission", "planner", "review"],
      difficulty: "intermediate",
      estimatedTime: "5-10 分钟",
      createdAt: now,
      updatedAt: now,
      nodes: [
        node("start", "start", 80, 220, { inputVariables: [{ name: "goal", type: "string", required: true, description: "任务目标", defaultValue: "交付 workflow 面板" }] }),
        node("planner", "agent", 320, 120, { label: "规划者（Planner）", roleId: "orchestrator", instructions: "将 {{input.goal}} 拆分为一份小型有序的实施计划。标明依赖和验收标准。", model: "default" }),
        node("set-plan", "set-state", 560, 120, { label: "存储计划（Store Plan）", stateKey: "plan", stateValue: "{{lastOutput}}" }),
        node("builder", "agent", 800, 220, { label: "构建者（Builder）", roleId: "builder", instructions: "执行 {{input.goal}} 的计划。保持变更范围可控，并记录验证证据。", model: "default" }),
        node("condition", "if-else", 1040, 220, { label: "需要审阅？", condition: "true" }),
        node("reviewer", "agent", 1280, 120, { label: "审阅者（Reviewer）", roleId: "reviewer", instructions: "审查构建者输出中的缺陷、缺失的测试和集成风险。", model: "default", outputFormat: "markdown" }),
        node("end", "end", 1520, 220)
      ],
      edges: [
        edge("start", "planner"),
        edge("planner", "set-plan"),
        edge("set-plan", "builder"),
        edge("builder", "condition"),
        edge("condition", "reviewer", "if", "true"),
        edge("condition", "end", "else", "false"),
        edge("reviewer", "end")
      ]
    }
  ];
}

function simpleAgentTemplate(now = "2026-01-01T00:00:00.000Z") {
  return {
    id: "simple-agent-workflow",
    name: "简单智能体工作流",
    description: "接收输入，执行一次 HanaAgent 任务，并生成报告。",
    category: "HanaAgent",
    tags: ["agent", "starter"],
    difficulty: "simple",
    estimatedTime: "1-2 分钟",
    createdAt: now,
    updatedAt: now,
    nodes: [
      node("start", "start", 80, 180, { inputVariables: [{ name: "request", type: "string", required: true, description: "用户请求", defaultValue: "总结当前项目" }] }),
      node("agent", "agent", 340, 180, { label: "主智能体（Primary Agent）", roleId: "builder", instructions: "处理 {{input.request}}。返回清晰的输出、证据、风险和下一步行动。", model: "default", outputFormat: "markdown" }),
      node("end", "end", 600, 180)
    ],
    edges: [edge("start", "agent"), edge("agent", "end")]
  };
}

function node(id, type, x, y, data = {}) {
  return {
    id,
    type,
    position: { x, y },
    data: {
      nodeType: type,
      label: data.label || NODE_LABELS[type] || type,
      nodeName: data.nodeName || data.label || NODE_LABELS[type] || type,
      ...data
    }
  };
}

function edge(source, target, sourceHandle = "", label = "") {
  return {
    id: `edge-${source}-${target}${sourceHandle ? `-${sourceHandle}` : ""}`,
    source,
    target,
    type: "smoothstep",
    label,
    sourceHandle
  };
}

function countVisits(items, id) {
  return (Array.isArray(items) ? items : []).filter((item) => item === id).length;
}

function evaluatePreviewCondition(condition, context) {
  const text = interpolate(clean(condition).toLowerCase(), context.variables);
  if (!text) return true;
  if (["false", "no", "0", "else"].includes(text)) return false;
  if (["true", "yes", "1", "if"].includes(text)) return true;
  const equals = text.match(/^([a-z0-9_.-]+)\s*(==|=|is)\s*["']?([^"']+)["']?$/i);
  if (equals) {
    const left = readPath(context.variables, equals[1]);
    return String(left ?? "").toLowerCase() === String(equals[3] ?? "").toLowerCase();
  }
  const contains = text.match(/^([a-z0-9_.-]+)\s+contains\s+["']?([^"']+)["']?$/i);
  if (contains) {
    const left = readPath(context.variables, contains[1]);
    return String(left ?? "").toLowerCase().includes(String(contains[2] ?? "").toLowerCase());
  }
  return !/\b(false|blocked|reject|no)\b/.test(text);
}

function interpolate(value, variables) {
  return String(value || "").replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    const found = readPath(variables, key);
    if (found === undefined || found === null) return "";
    if (typeof found === "object") return JSON.stringify(found);
    return String(found);
  });
}

function readPath(source, key) {
  const parts = String(key || "").split(".").filter(Boolean);
  let current = source;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

function normalizeTags(value) {
  return normalizeStringList(value).slice(0, 20);
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => clean(typeof item === "string" ? item : item?.id || item?.name || item?.label)).filter(Boolean);
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function firstLine(value) {
  return clean(value).split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
}

function clean(value) {
  return String(value ?? "").trim();
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
