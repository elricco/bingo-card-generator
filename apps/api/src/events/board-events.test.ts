import { describe, it, expect, vi } from "vitest";
import { publishBoardEvent, subscribeToBoard } from "./board-events";

describe("board-events", () => {
  it("liefert ein publiziertes Event an einen abonnierten Listener", () => {
    const listener = vi.fn();
    subscribeToBoard("board-1", listener);

    publishBoardEvent("board-1", { hello: "world" });

    expect(listener).toHaveBeenCalledWith({ hello: "world" });
  });

  it("liefert ein Event an mehrere Listener desselben Boards", () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    subscribeToBoard("board-2", listenerA);
    subscribeToBoard("board-2", listenerB);

    publishBoardEvent("board-2", { n: 1 });

    expect(listenerA).toHaveBeenCalledWith({ n: 1 });
    expect(listenerB).toHaveBeenCalledWith({ n: 1 });
  });

  it("liefert Events nicht an Listener eines anderen Boards", () => {
    const listener = vi.fn();
    subscribeToBoard("board-3", listener);

    publishBoardEvent("board-4", { n: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("stoppt die Zustellung nach dem Aufruf der Unsubscribe-Funktion", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToBoard("board-5", listener);

    unsubscribe();
    publishBoardEvent("board-5", { n: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("wirft nicht, wenn für eine Board-ID ohne Abonnenten publiziert wird", () => {
    expect(() => publishBoardEvent("board-ohne-abonnenten", { n: 1 })).not.toThrow();
  });
});
