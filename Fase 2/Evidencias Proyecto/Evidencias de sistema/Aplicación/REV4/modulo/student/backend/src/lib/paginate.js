// Paginacion por cursor opaco (offset codificado en base64), igual al patron
// que ya usaba GET /feed.
export function decodeCursor(cursor) {
  if (!cursor) return 0;
  const n = Number(Buffer.from(String(cursor), 'base64').toString());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function encodeCursor(offset) {
  return Buffer.from(String(offset)).toString('base64');
}

// paginate(items, req.query) -> { page, pagination }
export function paginate(items, query = {}, defaultLimit = 20, maxLimit = 100) {
  const limit = Math.max(1, Math.min(Number(query.limit) || defaultLimit, maxLimit));
  const start = decodeCursor(query.cursor);
  const page = items.slice(start, start + limit);
  const nextCursor = start + limit < items.length ? encodeCursor(start + limit) : null;
  return { page, pagination: { nextCursor, limit, total: items.length } };
}
