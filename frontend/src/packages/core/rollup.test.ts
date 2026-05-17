import { describe, expect, it } from "vitest";
import { assertNoCycles, rollupTaskTree, type TaskNode } from ".";

const base: TaskNode[] = [
  {
    id: "p",
    parentId: null,
    path: ["p"],
    depth: 0,
    wbsCode: "1",
    name: "Parent",
    owner: "AK",
    status: "planned",
    priority: "medium",
    taskType: "program",
    startDate: "2025-01-10",
    endDate: "2025-01-10",
    progress: 0,
    color: "#2563eb",
    resourceLoad: 20
  },
  {
    id: "a",
    parentId: "p",
    path: ["p", "a"],
    depth: 1,
    wbsCode: "1.1",
    name: "A",
    owner: "AK",
    status: "done",
    priority: "medium",
    taskType: "task",
    startDate: "2025-01-01",
    endDate: "2025-01-04",
    progress: 100,
    actualStartDate: "2025-01-01",
    actualEndDate: "2025-01-04",
    color: "#22c55e",
    resourceLoad: 40
  },
  {
    id: "b",
    parentId: "p",
    path: ["p", "b"],
    depth: 1,
    wbsCode: "1.2",
    name: "B",
    owner: "AK",
    status: "at-risk",
    priority: "high",
    taskType: "task",
    startDate: "2025-01-05",
    endDate: "2025-01-08",
    progress: 0,
    actualStartDate: "2025-01-05",
    actualEndDate: "2025-01-10",
    color: "#ef4444",
    resourceLoad: 80
  }
];

describe("rollupTaskTree", () => {
  it("rolls parent date, status, and duration-weighted progress from descendants", () => {
    const [parent] = rollupTaskTree(base);
    expect(parent.rollupStartDate).toBe("2025-01-01");
    expect(parent.rollupEndDate).toBe("2025-01-08");
    expect(parent.rollupProgress).toBe(50);
    expect(parent.rollupStatus).toBe("at-risk");
    expect(parent.rollupActualEndDate).toBe("2025-01-10");
    expect(parent.delayDays).toBe(2);
  });

  it("detects hierarchy cycles", () => {
    expect(() =>
      assertNoCycles([
        { id: "a", parentId: "b" },
        { id: "b", parentId: "a" }
      ])
    ).toThrow("Cycle detected");
  });
});
