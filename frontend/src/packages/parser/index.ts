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

function toIsoDate(v: any): string | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    // Excel serial date (days since 1899-12-30)
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return undefined;
  // Already ISO-ish?
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return undefined;
}

export function parseSheet(rows: Record<string, any>[], template: TemplateConfig): ParsedTask[] {
  const { field_map, grouping } = template;
  const canonicalKeys = ["name", "start_date", "end_date", "actual_start", "actual_end"];

  const groupMap = new Map<string, { id: string; name: string; parentId: string | null }>();
  const tasks: ParsedTask[] = [];

  rows.forEach((row, idx) => {
    const nameVal = field_map["name"] ? row[field_map["name"]] : undefined;
    const leaf: ParsedTask = {
      temp_id: generateId(),
      parent_temp_id: null,
      task_name: (nameVal !== undefined && nameVal !== null && nameVal !== "" ? String(nameVal) : (row[Object.keys(row)[0]] ? String(row[Object.keys(row)[0]]) : "Untitled")),
      kind: "leaf",
      start_date: toIsoDate(row[field_map["start_date"]]),
      end_date: toIsoDate(row[field_map["end_date"]]),
      actual_start: toIsoDate(row[field_map["actual_start"]]),
      actual_end: toIsoDate(row[field_map["actual_end"]]),
      sort_order: idx,
      fields: {},
    };

    // Collect unmapped non-grouping fields onto the leaf
    const groupingSet = new Set(grouping);
    for (const [col, val] of Object.entries(row)) {
      if (val === null || val === undefined || val === "") continue;
      const mappedKey = Object.entries(field_map).find(([, v]) => v === col)?.[0];
      if (canonicalKeys.includes(mappedKey || "")) continue;
      if (groupingSet.has(col)) continue;
      leaf.fields[col] = val instanceof Date ? toIsoDate(val) : val;
    }

    // Build grouping hierarchy
    let parentId: string | null = null;
    for (const groupCol of grouping) {
      const value = row[groupCol];
      if (value === undefined || value === null || value === "") continue;
      const groupName = String(value);
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
