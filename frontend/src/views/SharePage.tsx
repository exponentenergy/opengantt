import { useState } from "react";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Badge } from "@astryxdesign/core/Badge";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import type { ShareSnapshot } from "../lib/types";
import { GanttChart } from "../components/GanttChart";

export function SharePage({ snapshot }: { snapshot: ShareSnapshot }) {
  const [selected, setSelected] = useState<string | null>(null);
  const leafCount = snapshot.tasks.filter((t) => t.kind !== "group").length;
  // Old snapshots lack color_field — fall back to Phase when tasks carry it.
  const colorField =
    snapshot.color_field ??
    (snapshot.tasks.some((t) => t.fields?.Phase != null) ? "Phase" : null);

  return (
    <div className="og-app">
      <div className="og-share-banner">
        <div className="og-page" style={{ paddingTop: 20, paddingBottom: 20 }}>
          <HStack justify="between" vAlign="center" wrap="wrap" gap={3}>
            <VStack gap={1}>
              <Heading level={2}>{snapshot.title}</Heading>
              <Text type="supporting" color="secondary">
                Read-only snapshot · <Timestamp value={snapshot.generated_at} format="date" /> ·{" "}
                {leafCount} tasks
              </Text>
            </VStack>
            <Badge variant="teal" label="Shared via OpenGantt" />
          </HStack>
        </div>
      </div>
      <div className="og-page og-page--wide">
        <GanttChart
          tasks={snapshot.tasks}
          displayColumns={snapshot.display_columns}
          pxPerDay={9}
          readOnly
          selected={selected}
          onSelect={setSelected}
          colorField={colorField}
        />
      </div>
    </div>
  );
}
