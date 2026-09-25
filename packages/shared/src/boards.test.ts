import { describe, it, expect } from "vitest";
import { createBoardSchema } from "./boards";

describe("createBoardSchema", () => {
  it("akzeptiert letters-Modus ohne column_labels", () => {
    const result = createBoardSchema.safeParse({
      name: "Mein Board",
      size: 3,
      label_mode: "letters",
    });
    expect(result.success).toBe(true);
  });

  it("akzeptiert bingo-Modus bei size=5", () => {
    const result = createBoardSchema.safeParse({
      name: "Mein Board",
      size: 5,
      label_mode: "bingo",
    });
    expect(result.success).toBe(true);
  });

  it("lehnt bingo-Modus bei size!=5 ab", () => {
    const result = createBoardSchema.safeParse({
      name: "Mein Board",
      size: 3,
      label_mode: "bingo",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["label_mode"]);
    }
  });

  it("akzeptiert custom-Modus mit passender Anzahl column_labels", () => {
    const result = createBoardSchema.safeParse({
      name: "Mein Board",
      size: 3,
      label_mode: "custom",
      column_labels: ["WIN", "GG", "GLHF"],
    });
    expect(result.success).toBe(true);
  });

  it("lehnt custom-Modus mit falscher Anzahl column_labels ab", () => {
    const result = createBoardSchema.safeParse({
      name: "Mein Board",
      size: 3,
      label_mode: "custom",
      column_labels: ["WIN"],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["column_labels"]);
    }
  });

  it("lehnt custom-Modus ohne column_labels ab", () => {
    const result = createBoardSchema.safeParse({
      name: "Mein Board",
      size: 3,
      label_mode: "custom",
    });
    expect(result.success).toBe(false);
  });

  it("lehnt leeren Namen ab", () => {
    const result = createBoardSchema.safeParse({
      name: "",
      size: 3,
      label_mode: "letters",
    });
    expect(result.success).toBe(false);
  });

  it("lehnt ungültige Größe ab", () => {
    const result = createBoardSchema.safeParse({
      name: "Mein Board",
      size: 4,
      label_mode: "letters",
    });
    expect(result.success).toBe(false);
  });
});
