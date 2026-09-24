import { describe, it, expect } from "vitest";
import {
  boardSizeSchema,
  labelModeSchema,
  boardNameSchema,
  cellTextSchema,
  columnLabelSchema,
} from "./schemas";

describe("boardSizeSchema", () => {
  it("akzeptiert 3, 5, 7, 9", () => {
    for (const size of [3, 5, 7, 9]) {
      expect(boardSizeSchema.parse(size)).toBe(size);
    }
  });

  it("lehnt andere Zahlen ab", () => {
    expect(() => boardSizeSchema.parse(4)).toThrow();
  });
});

describe("labelModeSchema", () => {
  it("akzeptiert letters, bingo, custom", () => {
    expect(labelModeSchema.parse("letters")).toBe("letters");
    expect(labelModeSchema.parse("bingo")).toBe("bingo");
    expect(labelModeSchema.parse("custom")).toBe("custom");
  });

  it("lehnt unbekannte Werte ab", () => {
    expect(() => labelModeSchema.parse("foo")).toThrow();
  });
});

describe("boardNameSchema", () => {
  it("akzeptiert Namen bis 60 Zeichen", () => {
    expect(boardNameSchema.parse("a".repeat(60))).toHaveLength(60);
  });

  it("lehnt leere Namen ab", () => {
    expect(() => boardNameSchema.parse("")).toThrow();
  });

  it("lehnt Namen über 60 Zeichen ab", () => {
    expect(() => boardNameSchema.parse("a".repeat(61))).toThrow();
  });
});

describe("cellTextSchema", () => {
  it("akzeptiert leeren Text", () => {
    expect(cellTextSchema.parse("")).toBe("");
  });

  it("akzeptiert Text bis 80 Zeichen", () => {
    expect(cellTextSchema.parse("a".repeat(80))).toHaveLength(80);
  });

  it("lehnt Text über 80 Zeichen ab", () => {
    expect(() => cellTextSchema.parse("a".repeat(81))).toThrow();
  });
});

describe("columnLabelSchema", () => {
  it("akzeptiert Label bis 20 Zeichen", () => {
    expect(columnLabelSchema.parse("a".repeat(20))).toHaveLength(20);
  });

  it("lehnt Label über 20 Zeichen ab", () => {
    expect(() => columnLabelSchema.parse("a".repeat(21))).toThrow();
  });

  it("lehnt leeres Label ab", () => {
    expect(() => columnLabelSchema.parse("")).toThrow();
  });
});
