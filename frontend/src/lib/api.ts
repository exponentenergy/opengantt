const BASE = "";

async function api(method: string, args?: any) {
  const res = await fetch(`${BASE}/api/method/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: args ? JSON.stringify(args) : undefined,
  });
  const data = await res.json();
  if (!res.ok || data.exc) throw new Error(data.message || "API error");
  return data;
}

async function rest(doctype: string, action: string, body?: any) {
  const url = action === "list" ? `${BASE}/api/resource/${doctype}?fields=["*"]&limit_page_length=1000` :
    action === "create" ? `${BASE}/api/resource/${doctype}` :
    action === "read" ? `${BASE}/api/resource/${doctype}/${body}` :
    action === "update" ? `${BASE}/api/resource/${doctype}/${body.name}` :
    action === "delete" ? `${BASE}/api/resource/${doctype}/${body}` : "";
  const method = action === "create" ? "POST" : action === "update" ? "PUT" : action === "delete" ? "DELETE" : "GET";
  const opts: any = { method, headers: { "Content-Type": "application/json" }, credentials: "include" };
  if (action === "create" || action === "update") opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "REST error");
  return data.data;
}

export const frappeApi = {
  getUser: () => api("frappe.auth.get_logged_user"),
  list: (d: string) => rest(d, "list"),
  create: (d: string, body: any) => rest(d, "create", body),
  read: (d: string, name: string) => rest(d, "read", name),
  update: (d: string, body: any) => rest(d, "update", body),
  delete: (d: string, name: string) => rest(d, "delete", name),
  parseUpload: (body: any) => api("opengantt.api.parse_upload.parse_upload", body),
  publishShare: (body: any) => api("opengantt.api.publish_share.publish_share", body),
  duplicateStyle: (body: any) => api("opengantt.api.duplicate_style.duplicate_style", body),
};
