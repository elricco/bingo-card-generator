import { describe, it, expect } from "vitest";
import { buildGridCells } from "./grid";

describe("buildGridCells", () => {
  it("liefert (size+2)^2 Einträge", () => {
    const result = buildGridCells(3, ["A", "B", "C"], ["1", "2", "3"]);
    expect(result).toHaveLength(25);
  });

  it("hat leere Ecken", () => {
    const result = buildGridCells(3, ["A", "B", "C"], ["1", "2", "3"]);
    expect(result[0]).toEqual({ kind: "empty" });
    expect(result[4]).toEqual({ kind: "empty" });
    expect(result[20]).toEqual({ kind: "empty" });
    expect(result[24]).toEqual({ kind: "empty" });
  });

  it("zeigt Spaltenlabels in der obersten und untersten Reihe", () => {
    const result = buildGridCells(3, ["A", "B", "C"], ["1", "2", "3"]);
    expect(result.slice(1, 4)).toEqual([
      { kind: "label", text: "A" },
      { kind: "label", text: "B" },
      { kind: "label", text: "C" },
    ]);
    expect(result.slice(21, 24)).toEqual([
      { kind: "label", text: "A" },
      { kind: "label", text: "B" },
      { kind: "label", text: "C" },
    ]);
  });

  it("zeigt Reihenlabels links und rechts", () => {
    const result = buildGridCells(3, ["A", "B", "C"], ["1", "2", "3"]);
    expect(result[5]).toEqual({ kind: "label", text: "1" });
    expect(result[9]).toEqual({ kind: "label", text: "1" });
  });

  it("liefert size×size editierbare Zellen mit korrekten 0-basierten Koordinaten", () => {
    const result = buildGridCells(3, ["A", "B", "C"], ["1", "2", "3"]);
    const editableCells = result.filter((c) => c.kind === "cell");
    expect(editableCells).toHaveLength(9);
    expect(editableCells[0]).toEqual({ kind: "cell", row: 0, col: 0 });
    expect(editableCells[8]).toEqual({ kind: "cell", row: 2, col: 2 });
  });
});
