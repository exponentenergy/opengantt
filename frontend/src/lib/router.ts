import { useEffect, useState } from "react";

export interface Route {
  ganttName: string | null;
  importing: boolean;
}

function parse(): Route {
  const params = new URLSearchParams(window.location.search);
  return {
    ganttName: params.get("gantt"),
    importing: params.get("view") === "import",
  };
}

export function navigate(query: { gantt?: string; view?: string } = {}): void {
  const params = new URLSearchParams();
  if (query.gantt) params.set("gantt", query.gantt);
  if (query.view) params.set("view", query.view);
  const qs = params.toString();
  window.history.pushState({}, "", `/opengantt${qs ? `?${qs}` : ""}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const onPop = () => setRoute(parse());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return route;
}
