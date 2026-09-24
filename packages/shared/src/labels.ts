import { BINGO_LABELS, type LabelMode } from "./constants";

function lettersForSize(size: number): string[] {
  return Array.from({ length: size }, (_, i) => String.fromCharCode(65 + i));
}

export function getColumnLabels(
  size: number,
  labelMode: LabelMode,
  columnLabels?: string[]
): string[] {
  if (labelMode === "bingo") {
    if (size !== 5) {
      throw new Error(
        `label_mode "bingo" ist nur bei size=5 erlaubt, erhalten: size=${size}`
      );
    }
    return [...BINGO_LABELS];
  }

  if (labelMode === "custom") {
    if (!columnLabels || columnLabels.length !== size) {
      throw new Error(
        `label_mode "custom" erfordert columnLabels mit genau ${size} Einträgen, erhalten: ${
          columnLabels?.length ?? 0
        }`
      );
    }
    return columnLabels;
  }

  return lettersForSize(size);
}

export function getRowLabels(size: number): string[] {
  return Array.from({ length: size }, (_, i) => String(i + 1));
}
