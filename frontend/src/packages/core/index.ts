export type TaskStatus = "planned" | "in-progress" | "at-risk" | "blocked" | "done";
export type TaskPriority = "low" | "medium" | "high";
export type TaskType = string;

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
  taskType: TaskType;
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

const statusRank: Record<TaskStatus, number> = {
  blocked: 5,
  "at-risk": 4,
  "in-progress": 3,
  planned: 2,
  done: 1
};

const toDays = (startDate: string, endDate: string) => {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
};

export function rollupTaskTree(tasks: TaskNode[]): TaskNode[] {
  const childrenByParent = new Map<string | null, TaskNode[]>();
  for (const task of tasks) {
    const siblings = childrenByParent.get(task.parentId) ?? [];
    siblings.push(task);
    childrenByParent.set(task.parentId, siblings);
  }

  const byId = new Map(tasks.map((task) => [task.id, task]));
  const result = new Map<string, TaskNode>();

  function visit(task: TaskNode, trail: Set<string>): TaskNode {
    if (trail.has(task.id)) {
      throw new Error(`Cycle detected at task ${task.id}`);
    }

    const children = childrenByParent.get(task.id) ?? [];
    if (children.length === 0) {
      const actualEndDate = task.actualEndDate ?? task.endDate;
      const leaf = {
        ...task,
        rollupStartDate: task.startDate,
        rollupEndDate: task.endDate,
        rollupActualStartDate: task.actualStartDate,
        rollupActualEndDate: task.actualEndDate,
        rollupProgress: task.progress,
        rollupStatus: task.status,
        delayDays: Math.max(0, toDays(task.endDate, actualEndDate) - 1)
      };
      result.set(task.id, leaf);
      return leaf;
    }

    const nextTrail = new Set(trail);
    nextTrail.add(task.id);
    const rolledChildren = children.map((child) => visit(child, nextTrail));
    const startDate = rolledChildren.reduce((min, child) =>
      child.rollupStartDate! < min ? child.rollupStartDate! : min, rolledChildren[0].rollupStartDate!);
    const endDate = rolledChildren.reduce((max, child) =>
      child.rollupEndDate! > max ? child.rollupEndDate! : max, rolledChildren[0].rollupEndDate!);
    const actualStarts = rolledChildren.map((child) => child.rollupActualStartDate).filter(Boolean) as string[];
    const actualEnds = rolledChildren.map((child) => child.rollupActualEndDate).filter(Boolean) as string[];
    const work = rolledChildren.reduce((sum, child) => sum + toDays(child.rollupStartDate!, child.rollupEndDate!), 0);
    const weightedProgress = rolledChildren.reduce((sum, child) => {
      const duration = toDays(child.rollupStartDate!, child.rollupEndDate!);
      return sum + (child.rollupProgress ?? child.progress) * duration;
    }, 0);
    const rollupStatus = rolledChildren.reduce((winner, child) =>
      statusRank[child.rollupStatus ?? child.status] > statusRank[winner] ? child.rollupStatus ?? child.status : winner,
    rolledChildren[0].rollupStatus ?? rolledChildren[0].status);

    const rolled = {
      ...task,
      rollupStartDate: startDate,
      rollupEndDate: endDate,
      rollupActualStartDate: actualStarts.length ? actualStarts.reduce((min, value) => value < min ? value : min, actualStarts[0]) : undefined,
      rollupActualEndDate: actualEnds.length ? actualEnds.reduce((max, value) => value > max ? value : max, actualEnds[0]) : undefined,
      rollupProgress: Math.round(weightedProgress / work),
      rollupStatus,
      delayDays: Math.max(0, ...rolledChildren.map((child) => child.delayDays ?? 0))
    };
    result.set(task.id, rolled);
    return rolled;
  }

  for (const root of childrenByParent.get(null) ?? []) {
    visit(root, new Set());
  }

  for (const task of tasks) {
    if (!result.has(task.id)) {
      const parent = task.parentId ? byId.get(task.parentId) : null;
      if (!parent && task.parentId) {
        result.set(task.id, {
          ...task,
          rollupStartDate: task.startDate,
          rollupEndDate: task.endDate,
          rollupActualStartDate: task.actualStartDate,
          rollupActualEndDate: task.actualEndDate,
          rollupProgress: task.progress,
          rollupStatus: task.status,
          delayDays: Math.max(0, toDays(task.endDate, task.actualEndDate ?? task.endDate) - 1)
        });
      }
    }
  }

  return tasks.map((task) => result.get(task.id) ?? task);
}

export function assertNoCycles(tasks: Pick<TaskNode, "id" | "parentId">[]) {
  const parentById = new Map(tasks.map((task) => [task.id, task.parentId]));
  for (const task of tasks) {
    const seen = new Set<string>();
    let parentId = task.parentId;
    while (parentId) {
      if (seen.has(parentId) || parentId === task.id) {
        throw new Error(`Cycle detected at task ${task.id}`);
      }
      seen.add(parentId);
      parentId = parentById.get(parentId) ?? null;
    }
  }
}
