function rectangle(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function createSelectionGesture() {
  let start = null;
  let current = null;
  let settled = false;

  return {
    contextMenu() {
      return { prevent: true };
    },
    pointerDown(event) {
      if (settled || !event) return { type: 'ignore' };
      if (event.button === 2) {
        settled = true;
        start = null;
        return { type: 'full' };
      }
      if (event.button !== 0 || start) return { type: 'ignore' };
      start = { x: event.x, y: event.y };
      current = start;
      return { type: 'begin', rect: rectangle(start, current) };
    },
    pointerMove(event) {
      if (settled || !start || !event) return { type: 'ignore' };
      current = { x: event.x, y: event.y };
      return { type: 'move', rect: rectangle(start, current) };
    },
    pointerUp(event) {
      if (settled || !start || !event || event.button !== 0) {
        return { type: 'ignore' };
      }
      settled = true;
      const end =
        Number.isFinite(event.x) && Number.isFinite(event.y)
          ? { x: event.x, y: event.y }
          : current || start;
      const rect = rectangle(start, end);
      start = null;
      if (rect.width < 8 || rect.height < 8) return { type: 'cancel' };
      return { type: 'region', rect };
    },
    cancel() {
      if (settled) return { type: 'ignore' };
      settled = true;
      start = null;
      return { type: 'cancel' };
    },
  };
}
