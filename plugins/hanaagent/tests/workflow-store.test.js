import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  listWorkflowTemplates,
  listWorkflows,
  previewWorkflowExecution,
  updateWorkflow,
  validateWorkflow,
  workflowToMissionInput
} from "../lib/workflow-store.js";

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-workflows-"));
}

test("workflow store creates templates, validates nodes, previews safely, and deletes", () => {
  const dataDir = tempDataDir();
  const templates = listWorkflowTemplates();
  assert.equal(templates.some((template) => template.id === "simple-agent-workflow"), true);
  assert.equal(templates.some((template) => template.nodes.some((node) => node.type === "user-approval")), true);

  const created = createWorkflow(dataDir, { templateId: "research-with-approval", name: "Route Research" });
  assert.equal(created.ok, true);
  assert.equal(created.workflow.name, "Route Research");
  assert.equal(validateWorkflow(created.workflow).length, 0);

  const workflows = listWorkflows(dataDir);
  assert.equal(workflows.length, 1);
  assert.equal(getWorkflow(dataDir, created.workflow.id).id, created.workflow.id);

  const preview = previewWorkflowExecution(created.workflow, { topic: "HanaAgent" });
  assert.equal(preview.ok, true);
  assert.equal(preview.execution.status, "paused");
  assert.equal(preview.execution.path.includes("approval"), true);
  assert.equal(preview.execution.nodeResults["research-agent"].output.kind, "agent");

  const mission = workflowToMissionInput(created.workflow, {
    goal: "Absorb workflow builder",
    sessionPath: "/sessions/primary.jsonl",
    agentId: "primary"
  });
  assert.equal(mission.ok, true);
  assert.equal(mission.missionInput.templateId, `workflow:${created.workflow.id}`);
  assert.equal(mission.missionInput.lanes.length, 2);
  assert.equal(mission.missionInput.lanes[0].reviewRequired, true);

  const updated = updateWorkflow(dataDir, created.workflow.id, {
    description: "Updated description",
    nodes: created.workflow.nodes.map((node) => node.id === "research-agent"
      ? { ...node, data: { ...node.data, instructions: "Research deeply." } }
      : node)
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.workflow.description, "Updated description");

  const deleted = deleteWorkflow(dataDir, created.workflow.id);
  assert.equal(deleted.ok, true);
  assert.equal(listWorkflows(dataDir).length, 0);
});

test("workflow validation reports missing start and disconnected nodes", () => {
  const workflow = {
    id: "invalid",
    name: "Invalid",
    nodes: [
      { id: "agent", type: "agent", position: { x: 1, y: 1 }, data: { label: "Agent", instructions: "" } },
      { id: "end", type: "end", position: { x: 2, y: 2 }, data: { label: "End" } }
    ],
    edges: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };

  const errors = validateWorkflow(workflow);
  assert.equal(errors.some((error) => error.nodeId === "workflow" && error.message.includes("Start")), true);
  assert.equal(errors.some((error) => error.nodeId === "agent" && error.field === "instructions"), true);
  assert.equal(errors.some((error) => error.nodeId === "agent" && error.field === "connections"), true);
});
