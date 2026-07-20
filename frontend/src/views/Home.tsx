import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { Badge } from "@astryxdesign/core/Badge";
import { Text } from "@astryxdesign/core/Text";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { useToast } from "@astryxdesign/core/Toast";
import { api } from "../lib/api";
import type { GanttCard } from "../lib/types";
import { navigate } from "../lib/router";
import { Sparkline } from "../components/Sparkline";
import { AppearanceButton } from "../components/AppearanceDialog";

export function Home() {
  const [cards, setCards] = useState<GanttCard[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<GanttCard | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = () => {
    api
      .listGantts()
      .then((r) => setCards(r.gantts))
      .catch((e: Error) => {
        setCards([]);
        toast({ body: e.message, type: "error" });
      });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const doDelete = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await api.purgeGantt(confirmDelete.name);
      toast({ body: `Deleted "${confirmDelete.title}" and all its data` });
      setConfirmDelete(null);
      load();
    } catch (e) {
      toast({ body: (e as Error).message, type: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="og-page">
      <VStack gap={8}>
        <HStack justify="between" vAlign="center" wrap="wrap" gap={4}>
          <VStack gap={1}>
            <HStack gap={3} vAlign="center">
              <span className="og-wordmark" aria-hidden="true" />
              <Heading level={1}>OpenGantt</Heading>
            </HStack>
            <Text type="supporting" color="secondary">
              Turn spreadsheets into living Gantt charts
            </Text>
          </VStack>
          <HStack gap={3} vAlign="center">
            <AppearanceButton />
            <Button
              label="Import spreadsheet"
              variant="primary"
              size="lg"
              onClick={() => navigate({ view: "import" })}
            />
          </HStack>
        </HStack>

        {cards === null ? (
          <HStack justify="center" padding={10}>
            <Spinner size="lg" />
          </HStack>
        ) : cards.length === 0 ? (
          <EmptyState
            title="No gantt charts yet"
            description="Drop a CSV, TSV, or XLSX project plan and get an editable, shareable timeline in seconds."
            actions={
              <Button
                label="Import your first spreadsheet"
                variant="primary"
                onClick={() => navigate({ view: "import" })}
              />
            }
          />
        ) : (
          <div className="og-card-grid">
            {cards.map((g) => (
              <div key={g.name} className="og-card">
              <ClickableCard label={g.title} onClick={() => navigate({ gantt: g.name })}>
                <VStack gap={3}>
                  <HStack justify="between" vAlign="start" gap={2}>
                    <Text type="body" weight="bold" maxLines={1}>
                      {g.title}
                    </Text>
                    <MoreMenu
                      label={`Actions for ${g.title}`}
                      items={[
                        { label: "Open", onClick: () => navigate({ gantt: g.name }) },
                        ...(g.has_source
                          ? [
                              {
                                label: "Re-import from source",
                                onClick: () => {
                                  api
                                    .reimport(g.name)
                                    .then((r) => {
                                      toast({ body: `Re-imported ${r.count} tasks` });
                                      load();
                                    })
                                    .catch((e: Error) => toast({ body: e.message, type: "error" }));
                                },
                              },
                              {
                                label: "Delete source file",
                                onClick: () => {
                                  api
                                    .purgeSource(g.name)
                                    .then(() => {
                                      toast({ body: "Source file deleted" });
                                      load();
                                    })
                                    .catch((e: Error) => toast({ body: e.message, type: "error" }));
                                },
                              },
                            ]
                          : []),
                        { type: "divider" as const },
                        { label: "Delete gantt…", onClick: () => setConfirmDelete(g) },
                      ]}
                    />
                  </HStack>
                  <Sparkline segments={g.spark ?? []} />
                  <HStack gap={2} wrap="wrap">
                    <Badge variant="info" label={`${g.task_count} tasks`} />
                    {g.shares > 0 && <Badge variant="teal" label="Shared" />}
                    {Boolean(g.has_source) && <Badge variant="success" label="Source kept" />}
                  </HStack>
                  <Text type="supporting" color="secondary">
                    Updated <Timestamp value={g.modified} format="relative" />
                  </Text>
                </VStack>
              </ClickableCard>
              </div>
            ))}
          </div>
        )}

        {cards !== null && cards.length > 0 && cards.length < 7 && (
          <button
            type="button"
            className="og-drop-strip"
            onClick={() => navigate({ view: "import" })}
          >
            <span className="og-drop-strip-icon" aria-hidden="true">
              ⤓
            </span>
            <span>
              <Text type="body" weight="semibold">
                Drop another spreadsheet
              </Text>
              <Text type="supporting" color="secondary">
                CSV, TSV or XLSX — row-per-task plans and timeline matrices both work.
              </Text>
            </span>
          </button>
        )}
      </VStack>

      <Dialog isOpen={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <Layout
          header={
            <DialogHeader
              title="Delete this gantt?"
              onOpenChange={(o) => !o && setConfirmDelete(null)}
            />
          }
          content={
            <LayoutContent>
              <Text type="body">
                This permanently deletes “{confirmDelete?.title}” — all tasks, share links, and the
                source file. There is no undo.
              </Text>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack gap={2} justify="end">
                <Button label="Cancel" variant="ghost" onClick={() => setConfirmDelete(null)} />
                <Button
                  label="Delete everything"
                  variant="destructive"
                  isLoading={busy}
                  onClick={doDelete}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
    </div>
  );
}
