import crypto from "node:crypto";
import { buildArchitectureContext, buildArchitecturePrompt } from "./architecture-context.js";
import { readArchitectureState, writeArchitectureDraft } from "./architecture-overlay.js";
import {
  buildArchitectureReviewPrompt,
  hashReviewPrompt,
  writeArchitectureReview,
} from "./architecture-review.js";
import { callHanaChat, listChatModels, parseJsonObject, selectChatModel } from "./llm-client.js";
import { readCurrentPointer } from "./storage.js";
import { getActiveTaskForProject } from "./build-manager.js";
import { isValidProjectId } from "./projects.js";
import { readConfig } from "./core.js";

const TERMINAL = new Set(["completed", "review_failed", "failed", "cancelled"]);
const COMMITTING = new Set(["committing_draft", "committing_review"]);
const tasks = new Map();
const activeByProject = new Map();
const RETENTION_MS = 60 * 60 * 1000;
const MAX_ACTIVE_GENERATIONS = 4;
const TASK_PROGRESS = Object.freeze({
  generation: Object.freeze({
    preparing: 5,
    generating: 20,
    validating: 45,
    committing_draft: 55,
    reviewing: 65,
    committing_review: 90,
    completed: 100,
  }),
  review: Object.freeze({
    preparing: 10,
    reviewing: 25,
    committing_review: 90,
    completed: 100,
  }),
});

function setTaskStatus(task, status) {
  task.status = status;
  const progress = TASK_PROGRESS[task.kind]?.[status];
  if (Number.isFinite(progress)) task.progress = Math.max(task.progress || 0, progress);
}

function publicTask(task) {
  return {
    taskId: task.taskId,
    projectId: task.projectId,
    kind: task.kind || "generation",
    status: task.status,
    progress: task.progress || 0,
    providerId: task.providerId || null,
    model: task.model || null,
    reviewerProviderId: task.reviewerProviderId || null,
    reviewerModel: task.reviewerModel || null,
    startedAt: task.startedAt,
    completedAt: task.completedAt || null,
    error: task.error || null,
    overlaySha256: task.overlaySha256 || null,
    reviewReportSha256: task.reviewReportSha256 || null,
    reviewVerdict: task.reviewVerdict || null,
    validation: task.validation || null,
    reviewValidation: task.reviewValidation || null,
    contextChars: task.contextChars || null,
  };
}

function finishTask(task, status, fields = {}) {
  if (TERMINAL.has(task.status)) return;
  const cancelledInstead = task.status === "cancelling" && status !== "cancelled";
  setTaskStatus(task, cancelledInstead ? "cancelled" : status);
  task.completedAt = new Date().toISOString();
  if (!cancelledInstead) Object.assign(task, fields);
  if (activeByProject.get(task.projectId) === task.taskId) activeByProject.delete(task.projectId);
}

export async function listArchitectureProviders(ctx) {
  return listChatModels(ctx);
}

export function getArchitectureTask(taskId) {
  const task = tasks.get(taskId);
  return task ? publicTask(task) : null;
}

export function getActiveArchitectureTask(projectId) {
  const taskId = activeByProject.get(projectId);
  return taskId ? getArchitectureTask(taskId) : null;
}

function startError(projectId) {
  const buildTask = getActiveTaskForProject(projectId);
  if (buildTask) return { ok: false, error: "project_build_active", taskId: buildTask.taskId };
  const active = getActiveArchitectureTask(projectId);
  if (active) return { ok: false, error: "architecture_generation_active", taskId: active.taskId };
  if (activeByProject.size >= MAX_ACTIVE_GENERATIONS) return { ok: false, error: "architecture_generation_limit" };
  return null;
}

function createTask(projectId, kind) {
  const taskId = crypto.randomUUID();
  const task = {
    taskId,
    projectId,
    kind,
    status: "preparing",
    progress: TASK_PROGRESS[kind]?.preparing || 0,
    providerId: null,
    model: null,
    reviewerProviderId: null,
    reviewerModel: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    controller: new AbortController(),
  };
  tasks.set(taskId, task);
  activeByProject.set(projectId, taskId);
  return task;
}

async function selectReviewer(ctx, providers, input, fallback = {}) {
  const configuredProviderId = await readConfig(ctx, "architectureReviewProviderId", "");
  const configuredModel = await readConfig(ctx, "architectureReviewModel", "");
  const providerId = input.reviewerProviderId || configuredProviderId || fallback.providerId || "";
  const model = input.reviewerModel || configuredModel
    || (providerId && providerId === fallback.providerId ? fallback.model : "");
  return selectChatModel(providers, providerId, model);
}

function llmParamsForModel(reasoning) {
  // Hana's provider:models-by-type currently omits the reasoning flag,
  // so reasoning is always false here. Use generous defaults that work
  // for both reasoning and non-reasoning models: reasoning models need
  // the larger budget; non-reasoning models simply use less of it.
  return { generateMaxTokens: 16384, reviewMaxTokens: 8192, timeoutMs: 300_000 };
}

async function runIndependentReview(ctx, task, context, overlay, draftMeta, reviewSelection) {
  task.reviewerProviderId = reviewSelection.providerId;
  task.reviewerModel = reviewSelection.model;
  setTaskStatus(task, "reviewing");
  const reviewPrompt = buildArchitectureReviewPrompt(context, overlay, {
    draftSha256: draftMeta.overlaySha256,
    sourceBuildId: draftMeta.sourceBuildId,
    generatorProviderId: draftMeta.providerId,
    generatorModel: draftMeta.model,
  });
  const reviewParams = llmParamsForModel(reviewSelection.reasoning);
  const reviewResult = await callHanaChat(ctx, {
    providerId: reviewSelection.providerId,
    model: reviewSelection.model,
    system: reviewPrompt.system,
    user: reviewPrompt.user,
    maxTokens: reviewParams.reviewMaxTokens,
    timeoutMs: reviewParams.timeoutMs,
    signal: task.controller.signal,
  });
  if (!reviewResult.ok) {
    return { ok: false, status: reviewResult.error === "llm_cancelled" ? "cancelled" : "review_failed", error: reviewResult.error };
  }
  if (task.controller.signal.aborted) return { ok: false, status: "cancelled" };
  const parsedReview = parseJsonObject(reviewResult.content);
  if (!parsedReview.ok) return { ok: false, status: "review_failed", error: "architecture_review_output_not_json" };
  setTaskStatus(task, "committing_review");
  const reviewed = await writeArchitectureReview(ctx.dataDir, task.projectId, parsedReview.value, {
    draftSha256: draftMeta.overlaySha256,
    sourceBuildId: draftMeta.sourceBuildId,
    reviewerProviderId: reviewSelection.providerId,
    reviewerModel: reviewSelection.model,
    reviewPromptSha256: hashReviewPrompt(reviewPrompt),
    usage: reviewResult.usage,
  });
  if (!reviewed.ok) return { ok: false, status: "review_failed", error: reviewed.error, reviewValidation: reviewed.validation || null };
  return {
    ok: true,
    reviewReportSha256: reviewed.reviewReportSha256,
    reviewVerdict: reviewed.validation.verdict,
    reviewValidation: reviewed.validation,
  };
}

export function startArchitectureGeneration(ctx, input = {}) {
  const projectId = String(input.projectId || "").trim();
  if (!isValidProjectId(projectId)) return { ok: false, error: "invalid_projectId" };
  const blocked = startError(projectId);
  if (blocked) return blocked;
  const task = createTask(projectId, "generation");

  (async () => {
    const contextResult = await buildArchitectureContext(ctx.dataDir, projectId);
    if (!contextResult.ok) return finishTask(task, "failed", { error: contextResult.error });
    task.contextChars = contextResult.contextChars;
    if (task.controller.signal.aborted) return finishTask(task, "cancelled");

    const providersResult = await listChatModels(ctx);
    if (task.controller.signal.aborted) return finishTask(task, "cancelled");
    const configuredProviderId = await readConfig(ctx, "architectureProviderId", "");
    const configuredModel = await readConfig(ctx, "architectureModel", "");
    const requestedProviderId = input.providerId || configuredProviderId;
    const requestedModel = input.model || configuredModel;
    if (!providersResult.ok && (!requestedProviderId || !requestedModel)) {
      return finishTask(task, "failed", { error: providersResult.error });
    }
    const providers = providersResult.ok ? providersResult.providers : [];
    const selection = selectChatModel(
      providers,
      requestedProviderId,
      requestedModel,
    );
    if (!selection.ok) return finishTask(task, "failed", { error: selection.error });
    const reviewSelection = await selectReviewer(ctx, providers, input, selection);
    if (!reviewSelection.ok) return finishTask(task, "failed", { error: reviewSelection.error });
    task.providerId = selection.providerId;
    task.model = selection.model;
    task.reviewerProviderId = reviewSelection.providerId;
    task.reviewerModel = reviewSelection.model;
    setTaskStatus(task, "generating");

    const prompt = buildArchitecturePrompt(contextResult.context);
    const genParams = llmParamsForModel(selection.reasoning);
    const llmResult = await callHanaChat(ctx, {
      providerId: selection.providerId,
      model: selection.model,
      system: prompt.system,
      user: prompt.user,
      maxTokens: genParams.generateMaxTokens,
      timeoutMs: genParams.timeoutMs,
      signal: task.controller.signal,
    });
    if (!llmResult.ok) {
      return finishTask(task, llmResult.error === "llm_cancelled" ? "cancelled" : "failed", { error: llmResult.error });
    }
    if (task.controller.signal.aborted) return finishTask(task, "cancelled");

    setTaskStatus(task, "validating");
    const parsed = parseJsonObject(llmResult.content);
    if (!parsed.ok) return finishTask(task, "failed", { error: parsed.error });
    if (task.controller.signal.aborted) return finishTask(task, "cancelled");
    const current = await readCurrentPointer(ctx.dataDir, projectId);
    if (task.controller.signal.aborted) return finishTask(task, "cancelled");
    setTaskStatus(task, "committing_draft");
    const stored = await writeArchitectureDraft(ctx.dataDir, projectId, parsed.value, {
      generatedAt: new Date().toISOString(),
      providerId: selection.providerId,
      model: selection.model,
      sourceBuildId: current?.buildId || null,
      sourceGitCommitHash: contextResult.context.project.gitCommitHash,
      usage: llmResult.usage,
    });
    if (!stored.ok) return finishTask(task, "failed", { error: stored.error, validation: stored.validation || null });
    task.overlaySha256 = stored.overlaySha256;
    task.validation = stored.validation;
    if (task.controller.signal.aborted) return finishTask(task, "cancelled");

    const reviewOutcome = await runIndependentReview(ctx, task, contextResult.context, parsed.value, {
      overlaySha256: stored.overlaySha256,
      sourceBuildId: current?.buildId || null,
      providerId: selection.providerId,
      model: selection.model,
    }, reviewSelection);
    if (!reviewOutcome.ok) return finishTask(task, reviewOutcome.status, { error: reviewOutcome.error || null, reviewValidation: reviewOutcome.reviewValidation || null });
    finishTask(task, "completed", reviewOutcome);
  })().catch((error) => finishTask(task, "failed", { error: error.message || "architecture_generation_failed" }));

  return { ok: true, taskId: task.taskId };
}

export function startArchitectureReview(ctx, input = {}) {
  const projectId = String(input.projectId || "").trim();
  if (!isValidProjectId(projectId)) return { ok: false, error: "invalid_projectId" };
  const blocked = startError(projectId);
  if (blocked) return blocked;
  const task = createTask(projectId, "review");

  (async () => {
    const contextResult = await buildArchitectureContext(ctx.dataDir, projectId);
    if (!contextResult.ok) return finishTask(task, "review_failed", { error: contextResult.error });
    task.contextChars = contextResult.contextChars;
    if (task.controller.signal.aborted) return finishTask(task, "cancelled");
    const state = await readArchitectureState(ctx.dataDir, projectId);
    if (!state.ok || !state.hasDraft || !state.draftMeta) return finishTask(task, "review_failed", { error: "overlay_draft_not_found" });
    if (state.draftMeta.status === "adopted") return finishTask(task, "review_failed", { error: "overlay_draft_already_adopted" });
    if (state.draftMeta.sourceBuildId !== contextResult.context.project.sourceBuildId) {
      return finishTask(task, "review_failed", { error: "overlay_source_build_changed" });
    }
    task.providerId = state.draftMeta.providerId || null;
    task.model = state.draftMeta.model || null;
    task.overlaySha256 = state.draftMeta.overlaySha256 || null;
    task.validation = state.draftMeta.validation || null;

    const providersResult = await listChatModels(ctx);
    if (task.controller.signal.aborted) return finishTask(task, "cancelled");
    const reviewSelection = await selectReviewer(ctx, providersResult.ok ? providersResult.providers : [], input, {
      providerId: state.draftMeta.providerId,
      model: state.draftMeta.model,
    });
    if (!reviewSelection.ok) return finishTask(task, "review_failed", { error: reviewSelection.error });
    const outcome = await runIndependentReview(ctx, task, contextResult.context, state.draft, state.draftMeta, reviewSelection);
    if (!outcome.ok) return finishTask(task, outcome.status, { error: outcome.error || null, reviewValidation: outcome.reviewValidation || null });
    finishTask(task, "completed", outcome);
  })().catch((error) => finishTask(task, "review_failed", { error: error.message || "architecture_review_failed" }));

  return { ok: true, taskId: task.taskId };
}

export function cancelArchitectureGeneration(taskId) {
  const task = tasks.get(taskId);
  if (!task) return { ok: false, error: "task_not_found" };
  if (TERMINAL.has(task.status) || COMMITTING.has(task.status)) return { ok: false, error: "task_not_cancellable" };
  setTaskStatus(task, "cancelling");
  task.controller.abort(new Error("cancelled"));
  return { ok: true };
}

export function cancelAllArchitectureTasks() {
  for (const task of tasks.values()) {
    if (!TERMINAL.has(task.status)) {
      setTaskStatus(task, "cancelling");
      task.controller.abort(new Error("plugin_unload"));
    }
  }
}

export function pruneArchitectureTasks(now = Date.now()) {
  for (const [taskId, task] of tasks) {
    if (!TERMINAL.has(task.status) || !task.completedAt) continue;
    if (now - Date.parse(task.completedAt) > RETENTION_MS) tasks.delete(taskId);
  }
}
