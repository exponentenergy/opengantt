const BASE = "";

function csrfHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const tok = (window as any).csrf_token;
  if (tok && tok !== "{{ csrf_token }}") headers["X-Frappe-CSRF-Token"] = tok;
  return headers;
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.clone().json();
    if (data?._server_messages) {
      try {
        const msgs = JSON.parse(data._server_messages);
        const first = JSON.parse(msgs[0]);
        return first.message || first.title || `HTTP ${res.status}`;
      } catch { /* fall through */ }
    }
    if (data?.exception) return String(data.exception);
    if (data?.message) return typeof data.message === "string" ? data.message : JSON.stringify(data.message);
  } catch { /* not JSON */ }
  try { return (await res.clone().text()).slice(0, 200) || `HTTP ${res.status}`; } catch { return `HTTP ${res.status}`; }
}

async function api(method: string, args?: any) {
  const res = await fetch(`${BASE}/api/method/${method}`, {
    method: "POST",
    headers: csrfHeaders(),
    credentials: "include",
    body: args ? JSON.stringify(args) : undefined,
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  if (data.exc) throw new Error(data.exc);
  return data;
}

async function rest(doctype: string, action: string, body?: any) {
  const url =
    action === "list" ? `${BASE}/api/resource/${doctype}?fields=["*"]&limit_page_length=0` :
    action === "create" ? `${BASE}/api/resource/${doctype}` :
    action === "read" ? `${BASE}/api/resource/${doctype}/${encodeURIComponent(body)}` :
    action === "update" ? `${BASE}/api/resource/${doctype}/${encodeURIComponent(body.name)}` :
    action === "delete" ? `${BASE}/api/resource/${doctype}/${encodeURIComponent(body)}` : "";
  const method = action === "create" ? "POST" : action === "update" ? "PUT" : action === "delete" ? "DELETE" : "GET";
  const opts: RequestInit = { method, headers: csrfHeaders(), credentials: "include" };
  if (action === "create" || action === "update") opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  return data.data;
}

async function uploadFile(file: File, doctype: string, docname: string, fieldname = "source_file"): Promise<string> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("doctype", doctype);
  form.append("docname", docname);
  form.append("fieldname", fieldname);
  form.append("is_private", "1");
  const headers: Record<string, string> = {};
  const tok = (window as any).csrf_token;
  if (tok && tok !== "{{ csrf_token }}") headers["X-Frappe-CSRF-Token"] = tok;
  const res = await fetch(`${BASE}/api/method/upload_file`, {
    method: "POST",
    headers,
    credentials: "include",
    body: form,
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  const file_url = data?.message?.file_url || data?.message?.file_name;
  if (!file_url) throw new Error("upload_file returned no file_url");
  return file_url as string;
}

export const frappeApi = {
  getUser: () => api("frappe.auth.get_logged_user"),
  list: (d: string) => rest(d, "list"),
  create: (d: string, body: any) => rest(d, "create", body),
  read: (d: string, name: string) => rest(d, "read", name),
  update: (d: string, body: any) => rest(d, "update", body),
  delete: (d: string, name: string) => rest(d, "delete", name),
  uploadFile,
  parseUpload: (body: any) => api("opengantt.api.parse_upload.parse_upload", body),
  publishShare: (body: any) => api("opengantt.api.publish_share.publish_share", body),
  duplicateStyle: (body: any) => api("opengantt.api.duplicate_style.duplicate_style", body),
  reimport: (body: any) => api("opengantt.api.reimport.reimport", body),
};
