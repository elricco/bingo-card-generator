import { describe, it, expect } from "vitest";
import { createBoardSchema, patchBoardSchema, validateLabelConfig } from "./boards";

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

  it("lehnt column_labels bei nicht-custom-Modus ab", () => {
    const result = createBoardSchema.safeParse({
      name: "Mein Board",
      size: 3,
      label_mode: "letters",
      column_labels: ["a", "b", "c"],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["column_labels"]);
    }
  });
});

describe("validateLabelConfig", () => {
  it("liefert null für letters ohne column_labels", () => {
    expect(validateLabelConfig(3, "letters")).toBeNull();
  });

  it("liefert null für bingo bei size=5", () => {
    expect(validateLabelConfig(5, "bingo")).toBeNull();
  });

  it("liefert einen label_mode-Fehler für bingo bei size!=5", () => {
    const error = validateLabelConfig(3, "bingo");
    expect(error?.path).toBe("label_mode");
  });

  it("liefert null für custom mit passender Anzahl column_labels", () => {
    expect(validateLabelConfig(3, "custom", ["a", "b", "c"])).toBeNull();
  });

  it("liefert einen column_labels-Fehler für custom mit falscher Anzahl", () => {
    const error = validateLabelConfig(3, "custom", ["a"]);
    expect(error?.path).toBe("column_labels");
  });

  it("liefert einen column_labels-Fehler, wenn column_labels bei nicht-custom gesetzt ist", () => {
    const error = validateLabelConfig(3, "letters", ["a", "b", "c"]);
    expect(error?.path).toBe("column_labels");
  });
});

describe("patchBoardSchema", () => {
  it("akzeptiert ein leeres Objekt (keine Änderungen)", () => {
    expect(patchBoardSchema.safeParse({}).success).toBe(true);
  });

  it("akzeptiert nur name", () => {
    expect(patchBoardSchema.safeParse({ name: "Neuer Name" }).success).toBe(true);
  });

  it("akzeptiert cells mit gültigen Koordinaten und Text", () => {
    const result = patchBoardSchema.safeParse({
      cells: [{ row: 0, col: 0, text: "Hallo" }],
    });
    expect(result.success).toBe(true);
  });

  it("lehnt negative Zellkoordinaten ab", () => {
    const result = patchBoardSchema.safeParse({
      cells: [{ row: -1, col: 0, text: "Hallo" }],
    });
    expect(result.success).toBe(false);
  });

  it("lehnt zu langen Zelltext ab", () => {
    const result = patchBoardSchema.safeParse({
      cells: [{ row: 0, col: 0, text: "a".repeat(81) }],
    });
    expect(result.success).toBe(false);
  });

  it("akzeptiert leeren Zelltext", () => {
    const result = patchBoardSchema.safeParse({
      cells: [{ row: 0, col: 0, text: "" }],
    });
    expect(result.success).toBe(true);
  });
});
