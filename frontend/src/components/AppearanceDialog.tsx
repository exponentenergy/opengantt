import { useState } from "react";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import {
  ACCENTS,
  THEMES,
  applyAppearance,
  loadAppearance,
  saveAppearance,
  type Appearance,
} from "../lib/appearance";

const PaletteIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 22a10 10 0 1 1 10-10c0 2.2-1.8 3-3.5 3H16a2 2 0 0 0-1.4 3.4c.4.4.6.9.6 1.4a2.2 2.2 0 0 1-3.2 2.2Z" />
    <circle cx="7.5" cy="11.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="7" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="7" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

/**
 * Palette icon + appearance dialog: theme swatches (each swatch previews its
 * own theme by carrying data-astryx-theme, so the scoped CSS colours it),
 * a Light/Dark/System control, and preset accent overrides.
 */
export function AppearanceButton() {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Appearance>(loadAppearance);

  const update = (patch: Partial<Appearance>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    applyAppearance(next);
    saveAppearance(next);
  };

  return (
    <>
      <IconButton
        label="Appearance"
        icon={PaletteIcon}
        variant="secondary"
        onClick={() => setOpen(true)}
      />
      <Dialog isOpen={open} onOpenChange={(o) => !o && setOpen(false)}>
        <Layout
          header={<DialogHeader title="Appearance" onOpenChange={(o) => !o && setOpen(false)} />}
          content={
            <LayoutContent>
              <VStack gap={5}>
                <VStack gap={2}>
                  <Text type="label" weight="semibold">
                    Theme
                  </Text>
                  <div className="og-theme-grid">
                    {THEMES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="og-theme-swatch"
                        data-astryx-theme={t.id}
                        data-active={prefs.theme === t.id}
                        onClick={() => update({ theme: t.id })}
                      >
                        <span className="og-theme-swatch-preview">
                          <span className="og-theme-swatch-accent" />
                          <span className="og-theme-swatch-bar" />
                          <span className="og-theme-swatch-bar" style={{ width: "55%" }} />
                        </span>
                        <span className="og-theme-swatch-name">
                          {t.label}
                          {t.note ? <em> · {t.note}</em> : null}
                        </span>
                      </button>
                    ))}
                  </div>
                </VStack>

                <VStack gap={2}>
                  <Text type="label" weight="semibold">
                    Mode
                  </Text>
                  <SegmentedControl
                    label="Colour mode"
                    value={prefs.mode}
                    onChange={(v) => update({ mode: v as Appearance["mode"] })}
                  >
                    <SegmentedControlItem value="light" label="Light" />
                    <SegmentedControlItem value="dark" label="Dark" />
                    <SegmentedControlItem value="system" label="System" />
                  </SegmentedControl>
                </VStack>

                <VStack gap={2}>
                  <Text type="label" weight="semibold">
                    Accent
                  </Text>
                  <div className="og-accent-row">
                    <button
                      type="button"
                      className="og-accent-chip og-accent-chip--default"
                      data-active={prefs.accent === null}
                      title="Theme default"
                      onClick={() => update({ accent: null })}
                    >
                      A
                    </button>
                    {ACCENTS.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        className="og-accent-chip"
                        data-active={prefs.accent === hex}
                        style={{ background: hex }}
                        title={hex}
                        onClick={() => update({ accent: hex })}
                      />
                    ))}
                  </div>
                  <Text type="supporting" color="secondary">
                    Overrides the theme's accent for buttons, selections and highlights.
                  </Text>
                </VStack>
              </VStack>
            </LayoutContent>
          }
        />
      </Dialog>
    </>
  );
}
