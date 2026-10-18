export const state = {
  regions: [],
  mode: "EDIT",
  currentPoints: [],
  image: { el: null, width: 0, height: 0 },
  undoStack: [],
  redoStack: [],
  selectedId: null,
  offline: false
};

export async function performAction(label, doFn, undoFn) {
  await doFn();
  state.undoStack.push({ label, doFn, undoFn });
  state.redoStack = [];
}

export async function undo() {
  const a = state.undoStack.pop();
  if (!a) return false;
  try { await a.undoFn(); state.redoStack.push(a); return true; }
  catch (e) { state.undoStack.push(a); throw e; }
}

export async function redo() {
  const a = state.redoStack.pop();
  if (!a) return false;
  try { await a.doFn(); state.undoStack.push(a); return true; }
  catch (e) { state.redoStack.push(a); throw e; }
}