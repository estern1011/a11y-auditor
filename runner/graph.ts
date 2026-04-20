import { StateGraph, START, END } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";

import { State } from "./state.ts";
import { bootNode } from "./nodes/boot.ts";
import { discoverNode } from "./nodes/discover.ts";
import { authNode } from "./nodes/auth.ts";
import { baselineNode } from "./nodes/baseline.ts";
import { keyboardNode } from "./nodes/keyboard.ts";
import { visualNode } from "./nodes/visual.ts";
import { reportNode } from "./nodes/report.ts";

export interface BuildGraphOptions {
  checkpointer?: BaseCheckpointSaver;
}

export function buildGraph(opts: BuildGraphOptions = {}) {
  const g = new StateGraph(State)
    .addNode("boot", bootNode)
    .addNode("discover", discoverNode)
    .addNode("auth", authNode)
    .addNode("baseline", baselineNode)
    .addNode("keyboard", keyboardNode)
    .addNode("visual", visualNode)
    .addNode("report", reportNode)
    .addEdge(START, "boot")
    .addEdge("boot", "discover")
    .addConditionalEdges("discover", (s) => (s.needsAuth ? "auth" : "baseline"), {
      auth: "auth",
      baseline: "baseline",
    })
    .addEdge("auth", "baseline")
    .addConditionalEdges(
      "baseline",
      (s) => (s.hasInteractive ? "keyboard" : s.treeEmpty ? "report" : "visual"),
      { keyboard: "keyboard", visual: "visual", report: "report" },
    )
    .addConditionalEdges("keyboard", (s) => (s.treeEmpty ? "report" : "visual"), {
      visual: "visual",
      report: "report",
    })
    .addEdge("visual", "report")
    .addEdge("report", END);

  return g.compile({ checkpointer: opts.checkpointer });
}
