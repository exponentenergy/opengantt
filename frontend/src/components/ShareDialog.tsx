import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { TextInput } from "@astryxdesign/core/TextInput";
import { DateInput } from "@astryxdesign/core/DateInput";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Banner } from "@astryxdesign/core/Banner";
import { useToast } from "@astryxdesign/core/Toast";
import { api } from "../lib/api";
import { asISO } from "../lib/dates";
import type { GanttMeta, ShareSnapshot, Task } from "../lib/types";

export interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  gantt: GanttMeta;
  tasks: Task[];
  displayColumns: string[];
}

export function buildSnapshot(
  gantt: GanttMeta,
  tasks: Task[],
  displayColumns: string[]
): ShareSnapshot {
  const color_field =
    gantt.field_map?.__mode__ === "matrix" ? "Phase" : gantt.field_map?.status ?? null;
  return {
    version: 1,
    title: gantt.title,
    generated_at: new Date().toISOString(),
    grouping: gantt.grouping || [],
    display_columns: displayColumns,
    color_field,
    tasks,
  };
}

export function ShareDialog({ isOpen, onClose, gantt, tasks, displayColumns }: ShareDialogProps) {
  const [expiresOn, setExpiresOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState<{ slug: string; url: string } | null>(null);
  const toast = useToast();

  const publish = async () => {
    setBusy(true);
    try {
      const res = await api.publish(
        gantt.name,
        buildSnapshot(gantt, tasks, displayColumns),
        expiresOn || undefined
      );
      setShare(res);
      toast({ body: "Share link published" });
    } catch (e) {
      toast({ body: (e as Error).message, type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!share) return;
    setBusy(true);
    try {
      await api.revoke(share.slug);
      setShare(null);
      toast({ body: "Share link revoked" });
    } catch (e) {
      toast({ body: (e as Error).message, type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const fullUrl = share
    ? share.url.startsWith("http")
      ? share.url
      : `${window.location.origin}${share.url}`
    : "";

  return (
    <Dialog isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
      <Layout
        header={<DialogHeader title="Share this gantt" onOpenChange={(o) => !o && onClose()} />}
        content={
          <LayoutContent>
            <VStack gap={4}>
              <Text type="body" color="secondary">
                Publishing creates a read-only public snapshot of the current chart. Anyone with the
                link can view it — no login required. The link is not indexed by search engines.
              </Text>
              {share ? (
                <VStack gap={3}>
                  <Banner status="success" title="Link is live" />
                  <HStack gap={2} vAlign="end">
                    <TextInput label="Public link" value={fullUrl} onChange={() => undefined} />
                    <Button
                      label="Copy"
                      onClick={() => {
                        void navigator.clipboard.writeText(fullUrl);
                        toast({ body: "Link copied" });
                      }}
                    />
                  </HStack>
                </VStack>
              ) : (
                <DateInput
                  label="Expires on"
                  description="Optional — the link stops working after this date."
                  value={asISO(expiresOn)}
                  onChange={(v) => setExpiresOn(v ?? "")}
                  hasClear
                  isOptional
                />
              )}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <HStack gap={2} justify="end">
              <Button label="Close" variant="ghost" onClick={onClose} />
              {share ? (
                <Button label="Revoke link" variant="destructive" isLoading={busy} onClick={revoke} />
              ) : (
                <Button label="Publish link" variant="primary" isLoading={busy} onClick={publish} />
              )}
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
