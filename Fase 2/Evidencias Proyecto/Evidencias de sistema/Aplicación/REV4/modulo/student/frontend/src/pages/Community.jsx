import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Spinner, initials } from '../components/ui.jsx';

export default function Community() {
  const { L, user } = useAuth();
  const [posts, setPosts] = useState(null);
  const [text, setText] = useState('');
  const [openComments, setOpenComments] = useState({}); // postId -> [comments]
  const [draft, setDraft] = useState({});

  const load = async () => { const { data } = await api.get('/feed'); setPosts(data); };
  useEffect(() => { load().catch(() => setPosts([])); }, []);

  const publish = async () => { if (!text.trim()) return; try { await api.post('/posts', { text }); setText(''); await load(); } catch (e) { alert(e.message); } };
  const like = async (id) => {
    try { const { data } = await api.post(`/posts/${id}/like`, {}); setPosts((ps) => ps.map((p) => p.id === id ? { ...p, likes: data.likes, liked: data.liked } : p)); } catch {}
  };
  const toggleComments = async (id) => {
    if (openComments[id]) { setOpenComments((s) => { const n = { ...s }; delete n[id]; return n; }); return; }
    const { data } = await api.get(`/posts/${id}/comments`); setOpenComments((s) => ({ ...s, [id]: data }));
  };
  const addComment = async (id) => {
    const t = (draft[id] || '').trim(); if (!t) return;
    await api.post(`/posts/${id}/comments`, { text: t });
    const { data } = await api.get(`/posts/${id}/comments`);
    setOpenComments((s) => ({ ...s, [id]: data })); setDraft((d) => ({ ...d, [id]: '' }));
    setPosts((ps) => ps.map((p) => p.id === id ? { ...p, comments: data.length } : p));
  };

  if (!posts) return <Spinner />;
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="card">
        <div className="flex" style={{ gap: 10 }}><div className="side-avatar" style={{ background: 'var(--brand)', color: '#fff' }}>{initials(user?.name)}</div>
          <input placeholder={L('post_ph')} value={text} onChange={(e) => setText(e.target.value)} style={{ margin: 0 }} /></div>
        <div className="flex between" style={{ marginTop: 12 }}><span className="note">{'\u{1F4F7}'} {'\u{1F517}'} {'\u{1F4CA}'}</span><button className="btn" style={{ padding: '9px 16px' }} onClick={publish}>{L('publish')}</button></div>
      </div>
      {posts.map((p) => (
        <div key={p.id} className="card" style={{ marginTop: 16 }}>
          <div className="flex" style={{ gap: 10 }}><div className="mavatar" style={{ background: '#1A365D', margin: 0 }}>{initials(p.author?.name)}</div>
            <div><b style={{ fontSize: 13 }}>{p.author?.name}</b></div></div>
          <p style={{ marginTop: 10 }}>{p.text}</p>
          {p.question ? <div className="card flat" style={{ marginTop: 10 }}><span className="tag">{p.question.axis || 'Pregunta'}</span> <span className="note">#{p.question.id}</span></div> : null}
          <div className="flex" style={{ gap: 18, marginTop: 10 }}>
            <span className="note" style={{ cursor: 'pointer', color: p.liked ? 'var(--brand)' : undefined }} onClick={() => like(p.id)}>{'\u{1F44D}'} {p.likes}</span>
            <span className="note" style={{ cursor: 'pointer' }} onClick={() => toggleComments(p.id)}>{'\u{1F4AC}'} {p.comments} {L('comments')}</span>
          </div>
          {openComments[p.id] ? (
            <div style={{ marginTop: 10 }}>
              {openComments[p.id].map((c) => (
                <div key={c.id} className="row" style={{ marginTop: 6 }}><div className="mavatar" style={{ background: '#10B981', margin: 0 }}>{initials(c.author?.name)}</div>
                  <div style={{ fontSize: 13 }}><b>{c.author?.name}</b> {c.text}</div></div>
              ))}
              <div className="flex" style={{ gap: 8, marginTop: 8 }}>
                <input placeholder={L('comment')} value={draft[p.id] || ''} onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))} />
                <button className="btn sec" style={{ padding: '10px 14px' }} onClick={() => addComment(p.id)}>{L('send')}</button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
