import { z } from "zod";
import {
  LABEL_MODES,
  CELL_TEXT_MAX_LENGTH,
  BOARD_NAME_MAX_LENGTH,
  COLUMN_LABEL_MAX_LENGTH,
} from "./constants";

export const boardSizeSchema = z.union([
  z.literal(3),
  z.literal(5),
  z.literal(7),
  z.literal(9),
]);

export const labelModeSchema = z.enum(LABEL_MODES);

export const boardNameSchema = z
  .string()
  .trim()
  .min(1, "Board-Name darf nicht leer sein")
  .max(BOARD_NAME_MAX_LENGTH, `Board-Name darf max. ${BOARD_NAME_MAX_LENGTH} Zeichen haben`);

export const cellTextSchema = z
  .string()
  .max(CELL_TEXT_MAX_LENGTH, `Zelltext darf max. ${CELL_TEXT_MAX_LENGTH} Zeichen haben`);

export const columnLabelSchema = z
  .string()
  .trim()
  .min(1, "Spaltenlabel darf nicht leer sein")
  .max(
    COLUMN_LABEL_MAX_LENGTH,
    `Spaltenlabel darf max. ${COLUMN_LABEL_MAX_LENGTH} Zeichen haben`
  );
