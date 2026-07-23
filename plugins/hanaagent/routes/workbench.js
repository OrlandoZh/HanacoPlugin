import { registerMissionRoutes } from "./workbench-routes-missions.js";
import {
  launchAssignmentWorkerSession,
  createMissionTasks,
  createWorkflowMission,
  dispatchAssignmentForMission,
  syncAssignmentHostTask,
  syncMissionHostTasks
} from "./workbench-routes-missions.js";
export { runAutopilotTick, triggerJob, syncHistoryCheckpoints } from "./workbench-routes-missions.js";

import { registerSwarmRoutes } from "./workbench-routes-swarm.js";
import { registerCoreRoutes } from "./workbench-routes-core.js";
import { registerSessionRoutes } from "./workbench-routes-sessions.js";
import {
  buildOverview,
  buildAgentOutputs,
  buildSwarmActivity,
  buildWorkerArtifacts,
  buildWorkerDrilldown,
  buildApprovalQueue,
  resolveApprovalRecord,
  buildWorkerCards,
  buildAssignmentActivityIndex,
  findActivityAssignment,
  assignmentStateToColumn
} from "./workbench-overview.js";
import { renderWorkbench, registerHermesPageAliases } from "./workbench-render.js";

export default function registerHanaAgentRoutes(app, ctx) {
  app.get("/workbench", async (c) => c.html(await renderWorkbench(c, ctx, {
    route: "/workbench",
    section: "workbench",
    label: "Workbench",
    target: "mobileSectionControl",
    note: "Native HanaAgent OpenHanako plugin route."
  })));
  registerHermesPageAliases(app, ctx, { includeFallback: false });

  registerCoreRoutes(app, ctx, {
    buildOverview,
    buildWorkerDrilldown,
    buildAgentOutputs,
    buildSwarmActivity,
    buildWorkerArtifacts,
    launchAssignmentWorkerSession,
    createMissionTasks,
    createWorkflowMission
  });

  registerSessionRoutes(app, ctx, {
    buildOverview
  });

  registerSwarmRoutes(app, ctx, {
    buildOverview,
    buildWorkerDrilldown,
    dispatchAssignmentForMission,
    createMissionTasks,
    syncAssignmentHostTask,
    syncMissionHostTasks,
    launchAssignmentWorkerSession,
    assignmentStateToColumn
  });

  registerMissionRoutes(app, ctx, {
    buildOverview,
    buildApprovalQueue,
    resolveApprovalRecord,
    assignmentStateToColumn
  });

  registerHermesPageAliases(app, ctx, { includeFallback: true, fallbackOnly: true });
}
