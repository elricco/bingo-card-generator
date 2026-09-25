import { EventEmitter } from "node:events";

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function publishBoardEvent(boardId: string, payload: unknown): void {
  emitter.emit(boardId, payload);
}

export function subscribeToBoard(
  boardId: string,
  listener: (payload: unknown) => void
): () => void {
  emitter.on(boardId, listener);
  return () => {
    emitter.off(boardId, listener);
  };
}
