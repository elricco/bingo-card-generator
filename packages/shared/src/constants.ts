export const BOARD_SIZES = [3, 5, 7, 9] as const;
export type BoardSize = (typeof BOARD_SIZES)[number];

export const LABEL_MODES = ["letters", "bingo", "custom"] as const;
export type LabelMode = (typeof LABEL_MODES)[number];

export const CELL_TEXT_MAX_LENGTH = 80;
export const BOARD_NAME_MAX_LENGTH = 60;
export const COLUMN_LABEL_MAX_LENGTH = 20;
export const DEFAULT_BOARD_NAME = "Neues Bingo";

export const BINGO_LABELS = ["B", "I", "N", "G", "O"] as const;
