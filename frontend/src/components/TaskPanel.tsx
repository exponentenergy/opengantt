import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import { DateInput } from "@astryxdesign/core/DateInput";
import { Slider } from "@astryxdesign/core/Slider";
import { Text } from "@astryxdesign/core/Text";
import { Heading } from "@astryxdesign/core/Heading";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Badge } from "@astryxdesign/core/Badge";
import { Divider } from "@astryxdesign/core/Divider";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import type { Task } from "../lib/types";
import { asISO } from "../lib/dates";

export interface TaskPanelProps {
  task: Task;
  onSave: (name: string, patch: Record<string, unknown>) => void;
  onClose: () => void;
}

export function TaskPanel({ task, onSave, onClose }: TaskPanelProps) {
  const [name, setName] = useState(task.task_name);
  const [start, setStart] = useState(task.start_date ?? "");
  const [end, setEnd] = useState(task.end_date ?? "");
  const [actualStart, setActualStart] = useState(task.actual_start ?? "");
  const [actualEnd, setActualEnd] = useState(task.actual_end ?? "");
  const [progress, setProgress] = useState(task.progress || 0);

  useEffect(() => {
    setName(task.task_name);
    setStart(task.start_date ?? "");
    setEnd(task.end_date ?? "");
    setActualStart(task.actual_start ?? "");
    setActualEnd(task.actual_end ?? "");
    setProgress(task.progress || 0);
  }, [task]);

  const extraEntries = Object.entries(task.fields || {}).filter(([, v]) => v != null && v !== "");
  const isGroup = task.kind === "group";

  return (
    <VStack gap={4} padding={4}>
      <HStack justify="between" vAlign="center">
        <Heading level={3}>{isGroup ? "Group" : "Task"}</Heading>
        <Button label="Close" variant="ghost" size="sm" onClick={onClose} />
      </HStack>

      <TextInput label="Name" value={name} onChange={setName} />

      {!isGroup && (
        <>
          <HStack gap={3}>
            <DateInput label="Start" value={asISO(start)} onChange={(v) => setStart(v ?? "")} />
            <DateInput label="End" value={asISO(end)} onChange={(v) => setEnd(v ?? "")} />
          </HStack>
          <HStack gap={3}>
            <DateInput
              label="Actual start"
              value={asISO(actualStart)}
              onChange={(v) => setActualStart(v ?? "")}
              hasClear
            />
            <DateInput
              label="Actual end"
              value={asISO(actualEnd)}
              onChange={(v) => setActualEnd(v ?? "")}
              hasClear
            />
          </HStack>
          <Slider
            label="Progress"
            value={progress}
            onChange={(v: number | [number, number]) => setProgress(v as number)}
            min={0}
            max={100}
            formatValue={(v) => `${v}%`}
            valueDisplay="text"
          />
        </>
      )}

      {extraEntries.length > 0 && (
        <>
          <Divider />
          <VStack gap={2}>
            <Text type="label" weight="semibold" color="secondary">
              Imported fields
            </Text>
            <MetadataList columns="single">
              {extraEntries.map(([k, v]) => (
                <MetadataListItem key={k} label={k}>
                  {String(v)}
                </MetadataListItem>
              ))}
            </MetadataList>
            <HStack gap={2} wrap="wrap">
              {task.fields?.Status != null && (
                <Badge variant="info" label={String(task.fields.Status)} />
              )}
            </HStack>
          </VStack>
        </>
      )}

      <Button
        label="Save changes"
        variant="primary"
        onClick={() => {
          const patch: Record<string, unknown> = { task_name: name };
          if (!isGroup) {
            patch.start_date = start || null;
            patch.end_date = end || null;
            patch.actual_start = actualStart || null;
            patch.actual_end = actualEnd || null;
            patch.progress = progress;
          }
          onSave(task.name, patch);
        }}
      />
    </VStack>
  );
}
