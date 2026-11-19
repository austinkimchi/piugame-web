export function catalogGridWindow({ count, columns, rowHeight, viewportTop, viewportHeight, focusedIndex = -1 }: {
  count: number;
  columns: number;
  rowHeight: number;
  viewportTop: number;
  viewportHeight: number;
  focusedIndex?: number;
}): number[] {
  const rows = Math.ceil(count / columns);
  const first = Math.max(0, Math.min(rows - 1, Math.floor(viewportTop / rowHeight) - 3));
  const last = Math.min(rows - 1, Math.max(first, Math.ceil((viewportTop + viewportHeight) / rowHeight) + 3));
  const visible = new Set<number>();
  for (let row = first; row <= last; row += 1) visible.add(row);
  if (focusedIndex >= 0 && focusedIndex < count) visible.add(Math.floor(focusedIndex / columns));
  return [...visible].sort((a, b) => a - b).flatMap((row) => Array.from({ length: Math.min(columns, count - row * columns) }, (_, column) => row * columns + column));
}
