import type { AnalyzeResult, GanttCard, GanttMeta, Task } from "./types";

function csrfToken(): string | null {
  const tok = window.csrf_token;
  if (tok && tok !== "{{ csrf_token }}") return tok;
  return null;
}

function stripHtml(s: string): string {
  return s
    .replace(/<a [^>]*>([^<]*)<\/a>/gi, '"$1"')
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.clone().json();
    if (data?._server_messages) {
      try {
        const msgs = JSON.parse(data._server_messages);
        const first = JSON.parse(msgs[0]);
        return stripHtml(first.message || first.title || `HTTP ${res.status}`);
      } catch {
        /* fall through */
      }
    }
    if (data?.exc_type) {
      const nice: Record<string, string> = {
        PermissionError: "You don't have permission to do that.",
        ValidationError: "The server rejected the request.",
        DoesNotExistError: "That record no longer exists.",
      };
      if (nice[data.exc_type]) return nice[data.exc_type];
    }
    if (data?.exception) return stripHtml(String(data.exception));
    if (data?.message)
      return stripHtml(
        typeof data.message === "string" ? data.message : JSON.stringify(data.message)
      );
  } catch {
    /* not JSON */
  }
  try {
    return stripHtml((await res.clone().text()).slice(0, 300)) || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/**
 * Call a whitelisted method. JSON-valued args (objects/arrays) are stringified
 * individually — the backend parses them with frappe.parse_json().
 */
async function call<T = unknown>(method: string, args?: Record<string, unknown>): Promise<T> {
  const body: Record<string, unknown> = {};
  if (args) {
    for (const [k, v] of Object.entries(args)) {
      if (v === undefined) continue;
      body[k] = v !== null && typeof v === "object" ? JSON.stringify(v) : v;
    }
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const tok = csrfToken();
  if (tok) headers["X-Frappe-CSRF-Token"] = tok;
  const res = await fetch(`/api/method/${method}`, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  return data.message as T;
}

/** Upload a private, unattached file. Returns file_url. */
export async function uploadFile(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("is_private", "1");
  const headers: Record<string, string> = {};
  const tok = csrfToken();
  if (tok) headers["X-Frappe-CSRF-Token"] = tok;
  const res = await fetch(`/api/method/upload_file`, {
    method: "POST",
    headers,
    credentials: "include",
    body: form,
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  const file_url = data?.message?.file_url;
  if (!file_url) throw new Error("Upload returned no file URL");
  return file_url as string;
}

export const api = {
  analyzeUpload: (file_url: string) =>
    call<AnalyzeResult>("opengantt.api.import_flow.analyze_upload", { file_url }),

  createGantt: (args: {
    title: string;
    file_url: string;
    field_map: Record<string, string>;
    grouping: string[];
    display_columns: string[];
    save_template: 0 | 1;
    template_name?: string;
    retain_source: 0 | 1;
    mode?: "table" | "matrix";
  }) => call<{ gantt: string; task_count: number }>("opengantt.api.import_flow.create_gantt", args),

  reimport: (gantt: string) =>
    call<{ ok: number; count: number }>("opengantt.api.import_flow.reimport", { gantt }),

  getGanttData: (gantt: string) =>
    call<{ gantt: GanttMeta; tasks: Task[] }>("opengantt.api.tasks.get_gantt_data", { gantt }),

  updateTask: (name: string, patch: Record<string, unknown>) =>
    call<{ ok: number }>("opengantt.api.tasks.update_task", { name, patch }),

  rebucket: (gantt: string, grouping: string[]) =>
    call<{ ok: number; leaf_count: number; group_count: number }>(
      "opengantt.api.tasks.rebucket",
      { gantt, grouping }
    ),

  publish: (gantt: string, snapshot: unknown, expires_on?: string) =>
    call<{ slug: string; url: string }>("opengantt.api.share.publish", {
      gantt,
      snapshot,
      expires_on: expires_on || undefined,
    }),

  revoke: (slug: string) => call<{ ok: number }>("opengantt.api.share.revoke", { slug }),

  purgeSource: (gantt: string) =>
    call<{ ok: number }>("opengantt.api.privacy.purge_source", { gantt }),

  purgeGantt: (name: string) =>
    call<{ ok: number }>("opengantt.api.privacy.purge_gantt", { name }),

  purgeTemplate: (name: string) =>
    call<{ ok: number; detached_gantts: number }>("opengantt.api.privacy.purge_template", { name }),

  listGantts: () => call<{ gantts: GanttCard[] }>("opengantt.api.meta.list_gantts"),
};
