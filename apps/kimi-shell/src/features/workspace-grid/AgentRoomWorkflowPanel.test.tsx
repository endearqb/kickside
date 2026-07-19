import { describe, expect, it } from "vitest";
import { buildWorkflowDefinition } from "./AgentRoomWorkflowPanel";

describe("AgentRoomWorkflowPanel templates", () => {
  it("builds Parallel Review with explicit members and dependencies", () => {
    const definition = buildWorkflowDefinition("parallel_review", {
      review: ["reviewer-a", "reviewer-b", "reviewer-a"],
      synthesize: ["lead"],
    });
    expect(definition).toEqual({
      version: "1",
      stages: [
        expect.objectContaining({ stageId: "review", targetMemberIds: ["reviewer-a", "reviewer-b"], failurePolicy: "stop" }),
        expect.objectContaining({ stageId: "synthesize", targetMemberIds: ["lead"], dependsOn: ["review"] }),
      ],
    });
  });

  it("keeps the delivery workflow linear", () => {
    const definition = buildWorkflowDefinition("delivery_chain", {
      architect: ["a"], developer: ["d"], reviewer: ["r"],
    });
    expect(definition.stages.map((stage) => stage.dependsOn ?? [])).toEqual([[], ["architect"], ["developer"]]);
  });
});
