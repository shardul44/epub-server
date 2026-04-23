import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { interactiveService } from '../../services/interactiveService';
import { useRef } from 'react';

function TextBlock({ html }) {
  return (
    <div
      style={{ padding: 12, border: '1px solid #eee', borderRadius: 8, background: '#fff', marginBottom: 10 }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function QuizBlock({ block }) {
  const [selected, setSelected] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const opts = Array.isArray(block.options) ? block.options : [];
  const answer = block.answer;

  return (
    <div style={{ padding: 12, border: '1px solid #eee', borderRadius: 8, background: '#fff', marginBottom: 10 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Quiz</div>
      <div style={{ marginBottom: 8 }}>{block.question || 'Question'}</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {opts.map((o, idx) => (
          <button
            key={idx}
            type="button"
            className="btn btn-secondary"
            style={{
              textAlign: 'left',
              border: selected === idx ? '2px solid #1976d2' : undefined
            }}
            onClick={() => {
              setSelected(idx);
              setSubmitted(false);
            }}
          >
            {o}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setSubmitted(true)}
          disabled={selected == null}
        >
          Submit
        </button>
        {submitted ? (
          <span style={{ marginLeft: 10, fontWeight: 700 }}>
            {selected === answer ? 'Correct' : 'Wrong'}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function DragDropBlock({ block }) {
  const [matches, setMatches] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const items = Array.isArray(block.items) ? block.items : [];
  const targets = Array.isArray(block.targets) ? block.targets : [];
  const correct = block.correct && typeof block.correct === 'object' ? block.correct : {};

  function onDrop(item, target) {
    setMatches((prev) => ({ ...prev, [item]: target }));
    setSubmitted(false);
  }

  const score = useMemo(() => {
    let s = 0;
    for (const k of Object.keys(correct)) {
      if (matches[k] === correct[k]) s += 1;
    }
    return s;
  }, [matches, correct]);

  return (
    <div style={{ padding: 12, border: '1px solid #eee', borderRadius: 8, background: '#fff', marginBottom: 10 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Drag &amp; Drop</div>
      <div style={{ marginBottom: 10 }}>{block.question || 'Match the items'}</div>

      <div style={{ display: 'flex', gap: 24 }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: '#666', marginBottom: 6 }}>Items</div>
          {items.map((item) => (
            <div
              key={item}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('item', item)}
              style={{
                border: '1px solid #ddd',
                padding: 10,
                borderRadius: 8,
                marginBottom: 8,
                background: '#fafafa',
                cursor: 'grab'
              }}
            >
              {item}
              <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>
                matched: {matches[item] ? String(matches[item]) : '—'}
              </div>
            </div>
          ))}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ color: '#666', marginBottom: 6 }}>Targets</div>
          {targets.map((t) => (
            <div
              key={t}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const item = e.dataTransfer.getData('item');
                if (item) onDrop(item, t);
              }}
              style={{
                border: '2px dashed #bbb',
                padding: 14,
                borderRadius: 8,
                marginBottom: 10,
                background: '#fff'
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <button type="button" className="btn btn-primary" onClick={() => setSubmitted(true)}>
          Submit
        </button>
        {submitted ? (
          <span style={{ marginLeft: 10, fontWeight: 700 }}>
            Score: {score}/{Object.keys(correct).length || 0}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function AudioBlock({ block }) {
  const src = block.src;
  return (
    <div style={{ padding: 12, border: '1px solid #eee', borderRadius: 8, background: '#fff', marginBottom: 10 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Audio</div>
      {src ? (
        <audio controls style={{ width: '100%' }}>
          <source src={src} type="audio/mpeg" />
        </audio>
      ) : (
        <div style={{ color: '#666' }}>(no src set)</div>
      )}
      {block.start != null || block.end != null ? (
        <div style={{ color: '#666', marginTop: 6, fontSize: 13 }}>
          Range: {String(block.start ?? '')} → {String(block.end ?? '')}
        </div>
      ) : null}
    </div>
  );
}

function findWordIndexBinary(words, time) {
  let low = 0;
  let high = words.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const w = words[mid];
    if (time < Number(w.start ?? 0)) high = mid - 1;
    else if (time > Number(w.end ?? 0)) low = mid + 1;
    else return mid;
  }
  return -1;
}

function ReadAlongBlock({ block }) {
  const words = Array.isArray(block.words) ? block.words : [];
  const audio = block.audio || '';
  const audioRef = useRef(null);
  const rafRef = useRef(null);
  const wordRefs = useRef({});
  const [activeIndex, setActiveIndex] = useState(-1);
  const [mode, setMode] = useState('word'); // word | sentence

  const sentenceBuckets = useMemo(() => {
    const buckets = [];
    let current = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      current.push({ ...w, _idx: i });
      const text = String(w.text || '');
      if (/[.!?]$/.test(text)) {
        buckets.push(current);
        current = [];
      }
    }
    if (current.length) buckets.push(current);
    return buckets;
  }, [words]);

  const activeSentenceRange = useMemo(() => {
    if (activeIndex < 0) return null;
    for (const s of sentenceBuckets) {
      const first = s[0]?._idx;
      const last = s[s.length - 1]?._idx;
      if (activeIndex >= first && activeIndex <= last) return { first, last };
    }
    return null;
  }, [activeIndex, sentenceBuckets]);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return undefined;

    const tick = () => {
      const t = audioEl.currentTime || 0;
      const idx = findWordIndexBinary(words, t);
      setActiveIndex((prev) => {
        if (prev !== idx) {
          const target = wordRefs.current[idx];
          if (target) {
            target.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }
        return idx;
      });
      rafRef.current = requestAnimationFrame(tick);
    };

    const onPlay = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
    };
    const onPause = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    const onEnded = onPause;

    audioEl.addEventListener('play', onPlay);
    audioEl.addEventListener('pause', onPause);
    audioEl.addEventListener('ended', onEnded);

    return () => {
      audioEl.removeEventListener('play', onPlay);
      audioEl.removeEventListener('pause', onPause);
      audioEl.removeEventListener('ended', onEnded);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [words]);

  return (
    <div style={{ padding: 12, border: '1px solid #eee', borderRadius: 8, background: '#fff', marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>Read-along</div>
        <select className="form-control" style={{ width: 170 }} value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="word">Word highlight</option>
          <option value="sentence">Sentence highlight</option>
        </select>
      </div>

      {audio ? (
        <audio ref={audioRef} controls style={{ width: '100%', marginBottom: 10 }}>
          <source src={audio} type="audio/mpeg" />
        </audio>
      ) : (
        <div style={{ color: '#666', marginBottom: 10 }}>(no audio source)</div>
      )}

      <div style={{ lineHeight: 2 }}>
        {words.map((w, idx) => {
          const isWordActive = mode === 'word' && idx === activeIndex;
          const isSentenceActive =
            mode === 'sentence' &&
            activeSentenceRange &&
            idx >= activeSentenceRange.first &&
            idx <= activeSentenceRange.last;
          const active = isWordActive || isSentenceActive;
          return (
            <span
              key={w.id || idx}
              ref={(el) => {
                if (el) wordRefs.current[idx] = el;
              }}
              onClick={() => {
                if (!audioRef.current) return;
                const start = Number(w.start ?? 0);
                audioRef.current.currentTime = Number.isFinite(start) ? start : 0;
                void audioRef.current.play();
              }}
              style={{
                cursor: 'pointer',
                padding: '2px 4px',
                borderRadius: 4,
                marginRight: 2,
                transition: 'background 0.2s ease',
                background: active ? '#ffeb3b' : 'transparent'
              }}
            >
              {w.text}{' '}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function RenderBlock({ block }) {
  const type = String(block.type || '').trim();
  const c = block.content_json || {};

  if (type === 'text') {
    if (Array.isArray(c.words) && c.words.length && c.audio) {
      return <ReadAlongBlock block={c} />;
    }
    const html = (typeof c.html === 'string' ? c.html : (typeof c.content === 'string' ? c.content : '')).trim();
    return <TextBlock html={html || '<p>(empty text)</p>'} />;
  }
  if (type === 'audio_sync' || type === 'readalong') return <ReadAlongBlock block={c} />;
  if (type === 'quiz') return <QuizBlock block={c} />;
  if (type === 'dragdrop') return <DragDropBlock block={c} />;
  if (type === 'audio') return <AudioBlock block={c} />;

  return (
    <div style={{ padding: 12, border: '1px solid #eee', borderRadius: 8, background: '#fff', marginBottom: 10 }}>
      <div style={{ fontWeight: 700 }}>Block: {type || 'unknown'}</div>
      <pre style={{ marginTop: 8, fontSize: 12, background: '#fafafa', padding: 10, borderRadius: 8, overflow: 'auto' }}>
        {JSON.stringify(c, null, 2)}
      </pre>
    </div>
  );
}

export default function InteractiveReader() {
  const { bookId } = useParams();
  const id = useMemo(() => Number(bookId), [bookId]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [book, setBook] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [blocksByChapterId, setBlocksByChapterId] = useState(new Map());

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const b = await interactiveService.getBook(id);
      const ch = await interactiveService.listChapters(id);
      const map = new Map();
      for (const c of ch) {
        const blocks = await interactiveService.listBlocks(c.id);
        map.set(Number(c.id), blocks);
      }
      setBook(b);
      setChapters(ch);
      setBlocksByChapterId(map);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    loadAll();
  }, [id]);

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;
  if (error) return <div style={{ padding: 16 }}>{error}</div>;
  if (!book) return <div style={{ padding: 16 }}>Book not found.</div>;

  return (
    <div style={{ padding: 16, maxWidth: 950 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>{book.title}</h2>
          <div style={{ color: '#666', marginTop: 4 }}>
            <Link to="/interactive">← Back to books</Link>
          </div>
        </div>
        <Link className="btn btn-secondary" to={`/interactive/editor/${book.id}`}>
          Open editor
        </Link>
      </div>

      {book.description ? <div style={{ marginTop: 10, color: '#444' }}>{book.description}</div> : null}

      <div style={{ marginTop: 14 }}>
        {(chapters || [])
          .slice()
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((ch, idx) => {
            const blocks = blocksByChapterId.get(Number(ch.id)) || [];
            return (
              <div key={ch.id} style={{ marginTop: 18 }}>
                <h3 style={{ margin: '0 0 10px' }}>
                  {idx + 1}. {ch.title}
                </h3>
                {blocks.length === 0 ? (
                  <div style={{ color: '#666' }}>(empty chapter)</div>
                ) : (
                  blocks
                    .slice()
                    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
                    .map((bl) => <RenderBlock key={bl.id} block={bl} />)
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

