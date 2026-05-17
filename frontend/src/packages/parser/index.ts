export interface ParsedTask {
  temp_id: string;
  parent_temp_id: string | null;
  task_name: string;
  kind: "group" | "leaf";
  start_date?: string;
  end_date?: string;
  actual_start?: string;
  actual_end?: string;
  sort_order: number;
  fields: Record<string, any>;
}

export interface TemplateConfig {
  field_map: Record<string, string>;
  grouping: string[];
  display_columns: string[];
}

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function parseSheet(rows: Record<string, any>[], template: TemplateConfig): ParsedTask[] {
  const { field_map, grouping } = template;
  const canonicalKeys = ["name", "start_date", "end_date", "actual_start", "actual_end"];

  const groupMap = new Map<string, { id: string; name: string; parentId: string | null }>();
  const tasks: ParsedTask[] = [];

  rows.forEach((row, idx) => {
    const leaf: ParsedTask = {
      temp_id: generateId(),
      parent_temp_id: null,
      task_name: row[field_map["name"]] || row[Object.keys(row)[0]] || "Untitled",
      kind: "leaf",
      start_date: row[field_map["start_date"]] || undefined,
      end_date: row[field_map["end_date"]] || undefined,
      actual_start: row[field_map["actual_start"]] || undefined,
      actual_end: row[field_map["actual_end"]] || undefined,
      sort_order: idx,
      fields: {},
    };

    // Collect unmapped fields
    for (const [col, val] of Object.entries(row)) {
      const mappedKey = Object.entries(field_map).find(([, v]) => v === col)?.[0];
      if (!canonicalKeys.includes(mappedKey || "")) {
        leaf.fields[col] = val;
      }
    }

    // Build grouping hierarchy
    let parentId: string | null = null;
    for (const groupCol of grouping) {
      const value = row[groupCol];
      const groupName = value !== undefined && value !== null ? String(value) : "Unnamed";
      const pathKey: string = `${parentId || "root"}|${groupCol}|${groupName}`;
      if (!groupMap.has(pathKey)) {
        const gid = generateId();
        groupMap.set(pathKey, { id: gid, name: groupName, parentId });
        tasks.push({
          temp_id: gid,
          parent_temp_id: parentId,
          task_name: groupName,
          kind: "group",
          sort_order: 0,
          fields: { [groupCol]: groupName },
        });
      }
      parentId = groupMap.get(pathKey)!.id;
    }

    leaf.parent_temp_id = parentId;
    tasks.push(leaf);
  });

  return tasks;
}
