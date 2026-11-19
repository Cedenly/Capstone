// 1.6 Comunidad: feed, posts, likes, comments
import { Router } from 'express';
import { ok, created, fail, noContent } from '../lib/envelope.js';
import { wrap } from '../middleware/error.js';
import { authRequired } from '../middleware/auth.js';
import { COL, get, set, add, del, where, findOne } from '../data/repo.js';
import { paginate } from '../lib/paginate.js';

const r = Router();
r.use(authRequired);

// GET /feed
r.get('/feed', wrap(async (req, res) => {
  const posts = (await where(COL.posts, () => true)).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const { page, pagination } = paginate(posts, req.query);
  const myLikes = new Set((await where(COL.likes, (l) => l.userId === req.user.id)).map((l) => l.postId));
  const myReposts = new Set((await where(COL.reposts, (x) => x.userId === req.user.id)).map((x) => x.postId));
  const data = page.map((p) => ({
    id: p.id, author: { name: p.authorName }, text: p.text,
    question: p.questionId ? { id: p.questionId, axis: p.questionAxis } : null,
    likes: p.likes || 0, comments: p.comments || 0, reposts: p.reposts || 0,
    liked: myLikes.has(p.id), reposted: myReposts.has(p.id),
    mine: p.authorId === req.user.id, createdAt: p.createdAt,
  }));
  return ok(res, data, 200, { pagination });
}));

// POST /posts
r.post('/posts', wrap(async (req, res) => {
  const { text, questionId } = req.body || {};
  if (!text || !text.trim()) return fail(res, 400, 'VALIDATION_ERROR', 'text es obligatorio', { field: 'text' });
  if (text.trim().length > 2000) return fail(res, 400, 'VALIDATION_ERROR', 'text supera los 2000 caracteres', { field: 'text' });
  let questionAxis = null;
  if (questionId) { const q = await get(COL.questions, questionId); questionAxis = q?.axis || null; }
  const p = await add(COL.posts, {
    authorId: req.user.id, authorName: req.user.name, text: text.trim(), questionId: questionId || null,
    questionAxis, likes: 0, comments: 0, reposts: 0, createdAt: new Date().toISOString(),
  }, 'pst');
  return created(res, { id: p.id, text: p.text, likes: 0, comments: 0, reposts: 0 });
}));

// POST /posts/:id/like
r.post('/posts/:id/like', wrap(async (req, res) => {
  const p = await get(COL.posts, req.params.id);
  if (!p) return fail(res, 404, 'NOT_FOUND', 'La publicacion no existe');
  const existing = await findOne(COL.likes, (l) => l.postId === p.id && l.userId === req.user.id);
  let liked;
  if (existing) { await del(COL.likes, existing.id); p.likes = Math.max(0, (p.likes || 0) - 1); liked = false; }
  else { await add(COL.likes, { postId: p.id, userId: req.user.id }, 'lk'); p.likes = (p.likes || 0) + 1; liked = true; }
  await set(COL.posts, p.id, p);
  return ok(res, { liked, likes: p.likes });
}));

// POST /posts/:id/repost  (toggle, contador 🔁 del feed)
r.post('/posts/:id/repost', wrap(async (req, res) => {
  const p = await get(COL.posts, req.params.id);
  if (!p) return fail(res, 404, 'NOT_FOUND', 'La publicacion no existe');
  const existing = await findOne(COL.reposts, (x) => x.postId === p.id && x.userId === req.user.id);
  let reposted;
  if (existing) { await del(COL.reposts, existing.id); p.reposts = Math.max(0, (p.reposts || 0) - 1); reposted = false; }
  else {
    await add(COL.reposts, { postId: p.id, userId: req.user.id, createdAt: new Date().toISOString() }, 'rps');
    p.reposts = (p.reposts || 0) + 1; reposted = true;
  }
  await set(COL.posts, p.id, p);
  return ok(res, { reposted, reposts: p.reposts });
}));

// DELETE /posts/:id  (solo el autor)
r.delete('/posts/:id', wrap(async (req, res) => {
  const p = await get(COL.posts, req.params.id);
  if (!p) return fail(res, 404, 'NOT_FOUND', 'La publicacion no existe');
  if (p.authorId !== req.user.id) return fail(res, 403, 'NOT_POST_AUTHOR', 'Solo el autor puede eliminar la publicacion');
  for (const c of await where(COL.comments, (x) => x.postId === p.id)) await del(COL.comments, c.id);
  for (const l of await where(COL.likes, (x) => x.postId === p.id)) await del(COL.likes, l.id);
  for (const x of await where(COL.reposts, (y) => y.postId === p.id)) await del(COL.reposts, x.id);
  await del(COL.posts, p.id);
  return noContent(res);
}));

// DELETE /posts/:id/comments/:commentId  (autor del comentario o del post)
r.delete('/posts/:id/comments/:commentId', wrap(async (req, res) => {
  const p = await get(COL.posts, req.params.id);
  if (!p) return fail(res, 404, 'NOT_FOUND', 'La publicacion no existe');
  const c = await get(COL.comments, req.params.commentId);
  if (!c || c.postId !== p.id) return fail(res, 404, 'NOT_FOUND', 'El comentario no existe');
  if (c.authorId !== req.user.id && p.authorId !== req.user.id) {
    return fail(res, 403, 'NOT_COMMENT_AUTHOR', 'No puedes eliminar este comentario');
  }
  await del(COL.comments, c.id);
  p.comments = Math.max(0, (p.comments || 0) - 1);
  await set(COL.posts, p.id, p);
  return noContent(res);
}));

// GET /posts/:id/comments
r.get('/posts/:id/comments', wrap(async (req, res) => {
  const p = await get(COL.posts, req.params.id);
  if (!p) return fail(res, 404, 'NOT_FOUND', 'La publicacion no existe');
  const items = (await where(COL.comments, (c) => c.postId === p.id)).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  return ok(res, items.map((c) => ({ id: c.id, author: { name: c.authorName }, text: c.text, createdAt: c.createdAt })));
}));

// POST /posts/:id/comments
r.post('/posts/:id/comments', wrap(async (req, res) => {
  const p = await get(COL.posts, req.params.id);
  if (!p) return fail(res, 404, 'NOT_FOUND', 'La publicacion no existe');
  const { text } = req.body || {};
  if (!text || !text.trim()) return fail(res, 400, 'VALIDATION_ERROR', 'text es obligatorio', { field: 'text' });
  if (text.trim().length > 1000) return fail(res, 400, 'VALIDATION_ERROR', 'text supera los 1000 caracteres', { field: 'text' });
  const c = await add(COL.comments, { postId: p.id, authorId: req.user.id, authorName: req.user.name, text: text.trim(), createdAt: new Date().toISOString() }, 'cmt');
  p.comments = (p.comments || 0) + 1; await set(COL.posts, p.id, p);
  return created(res, { id: c.id, text: c.text });
}));

export default r;
