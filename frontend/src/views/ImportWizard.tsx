import { useMemo, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { Text } from "@astryxdesign/core/Text";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Selector } from "@astryxdesign/core/Selector";
import { MultiSelector } from "@astryxdesign/core/MultiSelector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Switch } from "@astryxdesign/core/Switch";
import { Spinner } from "@astryxdesign/core/Spinner";
import { useToast } from "@astryxdesign/core/Toast";
import { api, uploadFile } from "../lib/api";
import type { AnalyzeResult } from "../lib/types";
import { navigate } from "../lib/router";
import { MiniGantt, MatrixMiniGantt } from "../components/MiniGantt";
import { fmtMonth, toDay } from "../lib/dates";
import { categoryColor } from "../lib/colors";

const ROLES: { value: string; label: string }[] = [
  { value: "", label: "Ignore" },
  { value: "task_name", label: "Task name" },
  { value: "start_date", label: "Start" },
  { value: "end_date", label: "End" },
  { value: "actual_start", label: "Actual start" },
  { value: "actual_end", label: "Actual end" },
  { value: "owner", label: "Owner" },
  { value: "status", label: "Status" },
  { value: "progress", label: "Progress" },
];

type Phase = "drop" | "uploading" | "mapping" | "creating";

export function ImportWizard() {
  const [phase, setPhase] = useState<Phase>("drop");
  const [dragActive, setDragActive] = useState(false);
  const [fileUrl, setFileUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [fieldMap, setFieldMap] = useState<Record<string, string>>({});
  const [detectedRoles, setDetectedRoles] = useState<Set<string>>(new Set());
  const [grouping, setGrouping] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [retainSource, setRetainSource] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const templateBanner = useMemo(() => {
    const t = analysis?.matched_template;
    if (!t) return null;
    return typeof t === "string" ? t : t.title || t.name;
  }, [analysis]);

  const handleFile = async (file: File) => {
    const ok = /\.(csv|tsv|xlsx)$/i.test(file.name);
    if (!ok) {
      toast({ body: "Only .csv, .tsv, and .xlsx files are supported", type: "error" });
      return;
    }
    setPhase("uploading");
    setFileName(file.name);
    try {
      const url = await uploadFile(file);
      setFileUrl(url);
      const result = await api.analyzeUpload(url);
      setAnalysis(result);
      setFieldMap(result.detected.field_map || {});
      setDetectedRoles(new Set(Object.keys(result.detected.field_map || {})));
      setGrouping(result.detected.grouping || []);
      setTitle(file.name.replace(/\.(csv|tsv|xlsx)$/i, ""));
      setTemplateName(file.name.replace(/\.(csv|tsv|xlsx)$/i, "") + " mapping");
      setPhase("mapping");
    } catch (e) {
      toast({ body: (e as Error).message, type: "error" });
      setPhase("drop");
    }
  };

  const roleForHeader = (header: string): string => {
    for (const [role, h] of Object.entries(fieldMap)) if (h === header) return role;
    return "";
  };

  const setRole = (header: string, role: string) => {
    setFieldMap((prev) => {
      const next: Record<string, string> = {};
      for (const [r, h] of Object.entries(prev)) {
        if (h === header) continue; // clear old role of this header
        if (r === role) continue; // steal role from other header
        next[r] = h;
      }
      if (role) next[role] = header;
      return next;
    });
    setDetectedRoles((prev) => {
      const next = new Set(prev);
      next.delete(role);
      return next;
    });
  };

  const isMatrix = analysis?.detected.mode === "matrix";

  const create = async () => {
    if (!analysis) return;
    if (!isMatrix) {
      if (!fieldMap.task_name) {
        toast({ body: "Pick a Task name column first", type: "error" });
        return;
      }
      if (!fieldMap.start_date || !fieldMap.end_date) {
        toast({ body: "Pick Start and End date columns first", type: "error" });
        return;
      }
    }
    setPhase("creating");
    try {
      const displayColumns = isMatrix
        ? ["Phase"]
        : analysis.headers.filter((h) => {
            const r = roleForHeader(h);
            return r === "owner" || r === "status";
          });
      const res = await api.createGantt({
        title: title.trim() || fileName,
        file_url: fileUrl,
        field_map: isMatrix ? {} : fieldMap,
        grouping: isMatrix ? [] : grouping,
        display_columns: displayColumns,
        save_template: !isMatrix && saveTemplate ? 1 : 0,
        template_name: !isMatrix && saveTemplate ? templateName.trim() || undefined : undefined,
        retain_source: retainSource ? 1 : 0,
        mode: isMatrix ? "matrix" : "table",
      });
      toast({ body: `Created gantt with ${res.task_count} tasks` });
      navigate({ gantt: res.gantt });
    } catch (e) {
      toast({ body: (e as Error).message, type: "error" });
      setPhase("mapping");
    }
  };

  if (phase === "drop" || phase === "uploading") {
    return (
      <div className="og-page">
        <VStack gap={6}>
          <HStack justify="between" vAlign="center">
            <Heading level={1}>Import a spreadsheet</Heading>
            <Button label="Back" variant="ghost" onClick={() => navigate({})} />
          </HStack>
          <div
            className="og-drop"
            data-active={dragActive}
            onClick={() => phase === "drop" && fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              const f = e.dataTransfer.files?.[0];
              if (f && phase === "drop") void handleFile(f);
            }}
          >
            {phase === "uploading" ? (
              <VStack gap={3} hAlign="center">
                <Spinner size="lg" />
                <Text type="body" color="secondary">
                  Reading {fileName}…
                </Text>
              </VStack>
            ) : (
              <VStack gap={2} hAlign="center">
                <Text type="display-3">Drop your project plan here</Text>
                <Text type="supporting" color="secondary">
                  CSV, TSV, or XLSX — or click to browse. Columns are detected automatically.
                </Text>
              </VStack>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.tsv,.xlsx"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
        </VStack>
      </div>
    );
  }

  if (!analysis) return null;

  if (isMatrix) {
    const d = analysis.detected;
    const range = d.months_range
      ? `${fmtMonth(toDay(d.months_range[0]) ?? 0)} → ${fmtMonth(toDay(d.months_range[1]) ?? 0)}`
      : "";
    return (
      <div className="og-page">
        <VStack gap={6}>
          <HStack justify="between" vAlign="center">
            <VStack gap={1}>
              <Heading level={1}>Timeline matrix detected</Heading>
              <Text type="supporting" color="secondary">
                {fileName} — months across, modules down, cells are phases. No mapping needed.
              </Text>
            </VStack>
            <Button label="Start over" variant="ghost" onClick={() => setPhase("drop")} />
          </HStack>

          <Banner
            status="success"
            title={`${d.modules_count ?? 0} modules · ${range} · each module becomes a group with one bar per phase run`}
          />

          {(d.phases?.length ?? 0) > 0 && (
            <HStack gap={4} vAlign="center" wrap="wrap">
              <Text type="label" weight="semibold">
                Phases
              </Text>
              <div className="og-legend" style={{ padding: 0 }}>
                {d.phases!.map((p) => (
                  <span key={p} className="og-legend-item">
                    <span
                      className="og-legend-chip"
                      style={{ background: categoryColor(p) ?? "var(--color-accent)" }}
                    />
                    {p}
                  </span>
                ))}
              </div>
            </HStack>
          )}

          <VStack gap={2}>
            <Text type="label" weight="semibold">
              Timeline preview
            </Text>
            <MatrixMiniGantt modules={analysis.matrix_preview ?? []} />
          </VStack>

          <HStack gap={6} vAlign="end" wrap="wrap" justify="between">
            <HStack gap={4} vAlign="end" wrap="wrap">
              <TextInput label="Gantt title" value={title} onChange={setTitle} />
              <Switch
                label={retainSource ? "Keep source file for re-import" : "Delete source after import"}
                description={
                  retainSource
                    ? "The uploaded file stays private to you and enables one-click re-import."
                    : "Privacy mode: the uploaded file is removed once tasks are created."
                }
                value={retainSource}
                onChange={setRetainSource}
              />
            </HStack>
            <Button
              label="Create Gantt"
              variant="primary"
              size="lg"
              isLoading={phase === "creating"}
              onClick={create}
            />
          </HStack>
        </VStack>
      </div>
    );
  }

  return (
    <div className="og-page">
      <VStack gap={6}>
        <HStack justify="between" vAlign="center">
          <VStack gap={1}>
            <Heading level={1}>Map your columns</Heading>
            <Text type="supporting" color="secondary">
              {fileName} — highlighted columns were auto-detected. Adjust any chip, then create.
            </Text>
          </VStack>
          <Button label="Start over" variant="ghost" onClick={() => setPhase("drop")} />
        </HStack>

        {templateBanner && (
          <Banner
            status="success"
            title={`Mapping recognised from template “${templateBanner}” — applied`}
          />
        )}

        <div className="og-preview-wrap">
          <table className="og-preview">
            <thead>
              <tr>
                {analysis.headers.map((h) => {
                  const role = roleForHeader(h);
                  return (
                    <th key={h} data-detected={Boolean(role) && detectedRoles.has(role)}>
                      <VStack gap={2}>
                        <Text type="label" weight="semibold" maxLines={1}>
                          {h}
                        </Text>
                        <Selector
                          label={`Role for ${h}`}
                          isLabelHidden
                          size="sm"
                          options={ROLES}
                          value={role}
                          onChange={(v) => setRole(h, v ?? "")}
                        />
                      </VStack>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {analysis.preview_rows.slice(0, 8).map((row, i) => (
                <tr key={i}>
                  {analysis.headers.map((_, j) => (
                    <td key={j}>{row[j] != null ? String(row[j]) : ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <MultiSelector
          label="Group tasks by"
          options={analysis.headers.map((h) => ({ value: h, label: h }))}
          value={grouping}
          onChange={(v) => setGrouping(v)}
          triggerDisplay="badges"
        />

        <VStack gap={2}>
          <Text type="label" weight="semibold">
            Timeline preview
          </Text>
          <MiniGantt
            headers={analysis.headers}
            rows={analysis.preview_rows}
            fieldMap={fieldMap}
          />
        </VStack>

        <HStack gap={6} vAlign="end" wrap="wrap" justify="between">
          <HStack gap={4} vAlign="end" wrap="wrap">
            <TextInput label="Gantt title" value={title} onChange={setTitle} />
            <VStack gap={2}>
              <Switch
                label="Remember this mapping as a template"
                value={saveTemplate}
                onChange={setSaveTemplate}
              />
              {saveTemplate && (
                <TextInput
                  label="Template name"
                  isLabelHidden
                  value={templateName}
                  onChange={setTemplateName}
                />
              )}
            </VStack>
            <Switch
              label={retainSource ? "Keep source file for re-import" : "Delete source after import"}
              description={
                retainSource
                  ? "The uploaded file stays private to you and enables one-click re-import."
                  : "Privacy mode: the uploaded file is removed once tasks are created."
              }
              value={retainSource}
              onChange={setRetainSource}
            />
          </HStack>
          <Button
            label="Create Gantt"
            variant="primary"
            size="lg"
            isLoading={phase === "creating"}
            onClick={create}
          />
        </HStack>
      </VStack>
    </div>
  );
}
