export type TaskKind = "group" | "task";

export interface Task {
  name: string;
  task_name: string;
  kind: TaskKind;
  parent_task: string | null;
  start_date: string | null; // YYYY-MM-DD
  end_date: string | null;
  actual_start: string | null;
  actual_end: string | null;
  sort_order: number;
  progress: number; // 0–100
  fields: Record<string, unknown>;
}

export interface GanttMeta {
  name: string;
  title: string;
  field_map: Record<string, string>;
  grouping: string[];
  display_columns: string[];
  has_source: 0 | 1;
  parsed_at?: string;
  owner?: string;
}

export interface GanttCard {
  name: string;
  title: string;
  task_count: number;
  modified: string;
  has_source: 0 | 1;
  shares: number;
}

export interface MatrixSegment {
  phase: string;
  start: string; // YYYY-MM-DD (first day of first month)
  end: string; // YYYY-MM-DD (last day of last month)
}

export interface MatrixModulePreview {
  module: string;
  segments: MatrixSegment[];
}

export interface AnalyzeResult {
  headers: string[];
  preview_rows: (string | null)[][];
  detected: {
    mode?: "table" | "matrix";
    field_map: Record<string, string>;
    grouping: string[];
    date_format?: string;
    confidence: number | Record<string, number>;
    /** matrix mode only */
    modules_count?: number;
    months_range?: [string, string];
    phases?: string[];
  };
  /** matrix mode only: server-converted preview (first ~15 modules). */
  matrix_preview?: MatrixModulePreview[];
  matched_template?: { name: string; title?: string } | string | null;
}

/**
 * The share snapshot shape. The frontend both produces this (ShareDialog →
 * publish) and consumes it (SharePage reads window.__OG_SHARE_SNAPSHOT__).
 */
export interface ShareSnapshot {
  version: 1;
  title: string;
  generated_at: string; // ISO timestamp
  grouping: string[];
  display_columns: string[];
  /** Field key in task.fields used to colour bars (absent in old snapshots). */
  color_field?: string | null;
  tasks: Task[];
}

declare global {
  interface Window {
    csrf_token?: string;
    frappe_user?: string;
    __OG_SHARE_SNAPSHOT__?: ShareSnapshot;
  }
}
