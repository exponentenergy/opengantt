import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Selector } from "@astryxdesign/core/Selector";
import { MultiSelector } from "@astryxdesign/core/MultiSelector";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Card } from "@astryxdesign/core/Card";
import { useToast } from "@astryxdesign/core/Toast";
import { api } from "../lib/api";
import type { GanttMeta, Task } from "../lib/types";
import { navigate } from "../lib/router";
import { GanttChart } from "../components/GanttChart";
import { TaskPanel } from "../components/TaskPanel";
import { ShareDialog } from "../components/ShareDialog";
import { exportHtml } from "../lib/exportHtml";

const ZOOM: Record<string, number> = { day: 28, week: 9, month: 2.8 };

export function Editor({ ganttName }: { ganttName: string }) {
  const [gantt, setGantt] = useState<GanttMeta | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string>("week");
  const [columns, setColumns] = useState<string[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [rebucketing, setRebucketing] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const res = await api.getGanttData(ganttName);
      setGantt(res.gantt);
      setTasks(res.tasks);
      setColumns((prev) => (prev.length ? prev : res.gantt.display_columns || []));
    } catch (e) {
      toast({ body: (e as Error).message, type: "error" });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ganttName]);

  useEffect(() => {
    void load();
  }, [load]);

  const fieldKeys = useMemo(() => {
    const keys = new Set<string>();
    tasks.forEach((t) => Object.keys(t.fields || {}).forEach((k) => keys.add(k)));
    return Array.from(keys).sort();
  }, [tasks]);

  const groupingValue = gantt?.grouping?.[0] ?? "";

  // Bars are coloured by phase (matrix imports) or the mapped status column.
  const colorField = useMemo(() => {
    if (!gantt) return null;
    if (gantt.field_map?.__mode__ === "matrix") return "Phase";
    return gantt.field_map?.status ?? null;
  }, [gantt]);

  const changeGrouping = async (value: string | null) => {
    if (!gantt) return;
    setRebucketing(true);
    try {
      const grouping = value ? [value] : [];
      const res = await api.rebucket(gantt.name, grouping);
      toast({ body: `Regrouped into ${res.group_count} groups` });
      setSelected(null);
      await load();
    } catch (e) {
      toast({ body: (e as Error).message, type: "error" });
    } finally {
      setRebucketing(false);
    }
  };

  const patchTask = async (name: string, patch: Record<string, unknown>) => {
    // optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.name === name ? ({ ...t, ...patch } as Task) : t))
    );
    try {
      await api.updateTask(name, patch);
    } catch (e) {
      toast({ body: (e as Error).message, type: "error" });
      void load(); // roll back to server truth
    }
  };

  const onDatesChange = (name: string, start_date: string, end_date: string) => {
    void patchTask(name, { start_date, end_date });
  };

  const reimport = async () => {
    if (!gantt) return;
    try {
      const res = await api.reimport(gantt.name);
      toast({ body: `Re-imported ${res.count} tasks from source` });
      setSelected(null);
      await load();
    } catch (e) {
      toast({ body: (e as Error).message, type: "error" });
    }
  };

  if (loading) {
    return (
      <div className="og-page">
        <HStack justify="center" padding={10}>
          <Spinner size="lg" />
        </HStack>
      </div>
    );
  }

  if (!gantt) {
    return (
      <div className="og-page">
        <VStack gap={4} hAlign="center">
          <Text type="body">Could not load this gantt.</Text>
          <Button label="Back to home" onClick={() => navigate({})} />
        </VStack>
      </div>
    );
  }

  const selectedTask = selected ? tasks.find((t) => t.name === selected) ?? null : null;

  return (
    <div className="og-page og-page--wide">
      <VStack gap={4}>
        <HStack justify="between" vAlign="center" wrap="wrap" gap={3}>
          <HStack gap={3} vAlign="center">
            <Button label="← All gantts" variant="ghost" onClick={() => navigate({})} />
            <Heading level={2}>{gantt.title}</Heading>
          </HStack>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Selector
              label="Group by"
              isLabelHidden
              size="sm"
              placeholder="Group by…"
              options={[{ value: "", label: "No grouping" }, ...fieldKeys.map((k) => ({ value: k, label: `Group: ${k}` }))]}
              value={groupingValue}
              onChange={(v) => void changeGrouping(v || null)}
              isDisabled={rebucketing}
            />
            <MultiSelector
              label="Columns"
              isLabelHidden
              size="sm"
              placeholder="Columns"
              options={fieldKeys.map((k) => ({ value: k, label: k }))}
              value={columns}
              onChange={setColumns}
              triggerDisplay="count"
            />
            <SegmentedControl label="Zoom" value={zoom} onChange={setZoom} size="sm">
              <SegmentedControlItem value="day" label="Day" />
              <SegmentedControlItem value="week" label="Week" />
              <SegmentedControlItem value="month" label="Month" />
            </SegmentedControl>
            {Boolean(gantt.has_source) && (
              <Button label="Re-import" variant="secondary" size="sm" onClick={() => void reimport()} />
            )}
            <Button
              label="Export HTML"
              variant="secondary"
              size="sm"
              onClick={() => exportHtml(gantt.title)}
            />
            <Button label="Share" variant="primary" size="sm" onClick={() => setShareOpen(true)} />
          </HStack>
        </HStack>

        <HStack gap={4} vAlign="start">
          <div style={{ flex: 1, minWidth: 0 }}>
            <GanttChart
              tasks={tasks}
              displayColumns={columns}
              pxPerDay={ZOOM[zoom] ?? 9}
              selected={selected}
              onSelect={setSelected}
              onDatesChange={onDatesChange}
              svgId="og-gantt-svg"
              colorField={colorField}
            />
          </div>
          {selectedTask && (
            <div style={{ width: 340, flex: "none" }}>
              <Card>
                <TaskPanel
                  task={selectedTask}
                  onClose={() => setSelected(null)}
                  onSave={(name, patch) => void patchTask(name, patch)}
                />
              </Card>
            </div>
          )}
        </HStack>
      </VStack>

      <ShareDialog
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        gantt={gantt}
        tasks={tasks}
        displayColumns={columns}
      />
    </div>
  );
}
