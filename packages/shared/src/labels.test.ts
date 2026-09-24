import { describe, it, expect } from "vitest";
import { getColumnLabels, getRowLabels } from "./labels";

describe("getColumnLabels", () => {
  it("liefert A-C für size=3 im Modus letters", () => {
    expect(getColumnLabels(3, "letters")).toEqual(["A", "B", "C"]);
  });

  it("liefert A-I für size=9 im Modus letters", () => {
    expect(getColumnLabels(9, "letters")).toEqual([
      "A", "B", "C", "D", "E", "F", "G", "H", "I",
    ]);
  });

  it("liefert B-I-N-G-O für size=5 im Modus bingo", () => {
    expect(getColumnLabels(5, "bingo")).toEqual(["B", "I", "N", "G", "O"]);
  });

  it("wirft bei Modus bingo und size != 5", () => {
    expect(() => getColumnLabels(3, "bingo")).toThrow(/size=5/);
  });

  it("liefert eigene Wörter im Modus custom", () => {
    expect(getColumnLabels(3, "custom", ["WIN", "GG", "GLHF"])).toEqual([
      "WIN", "GG", "GLHF",
    ]);
  });

  it("wirft bei Modus custom mit falscher Länge", () => {
    expect(() => getColumnLabels(3, "custom", ["WIN"])).toThrow(/3 Einträgen/);
  });

  it("wirft bei Modus custom ohne columnLabels", () => {
    expect(() => getColumnLabels(3, "custom")).toThrow();
  });
});

describe("getRowLabels", () => {
  it("liefert 1..n als Strings", () => {
    expect(getRowLabels(5)).toEqual(["1", "2", "3", "4", "5"]);
  });
});
