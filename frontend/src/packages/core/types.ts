export type TaskStatus = "planned" | "in-progress" | "at-risk" | "blocked" | "done";
export type TaskPriority = "low" | "medium" | "high";

export interface TaskNode {
  id: string;
  parentId: string | null;
  path: string[];
  depth: number;
  wbsCode: string;
  name: string;
  owner: string;
  status: TaskStatus;
  priority: TaskPriority;
  taskType: string;
  startDate: string;
  endDate: string;
  actualStartDate?: string;
  actualEndDate?: string;
  progress: number;
  color: string;
  resourceLoad: number;
  kind?: "group" | "leaf";
  rollupStartDate?: string;
  rollupEndDate?: string;
  rollupActualStartDate?: string;
  rollupActualEndDate?: string;
  rollupProgress?: number;
  rollupStatus?: TaskStatus;
  delayDays?: number;
}

export type ZoomLevel = "day" | "week" | "month" | "quarter" | "year";
