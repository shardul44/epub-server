import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  GripVertical,
  HelpCircle,
  Headphones,
  Layers,
  Loader2,
  Music,
  Pencil,
  Sparkles,
} from 'lucide-react';
import { interactiveService } from '../../services/interactiveService';
import H5pPlayerEmbed from '../../components/interactive/h5p/H5pPlayerEmbed';
import ReaderCompatibilityBanner from '../../components/interactive/h5p/ReaderCompatibilityBanner';
import './InteractiveReader.css';

function getBlockContent(block) {
  return block.content_json ?? block.contentJson ?? {};
}

function TextBlock({ html }) {
  return <div className="irr-block irr-block--text" dangerouslySetInnerHTML={{ __html: html }} />;
}

function ImageBlock({ c }) {
  const url = c.url || c.src;
  const alt = c.alt || '';
  const caption = c.caption || '';
  return (
    <figure className="irr-block irr-block--image">
      {url ? (
        <img src={url} alt={alt} style={c.width ? { maxWidth: c.width } : undefined} />
      ) : (
        <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>No image URL</div>
      )}
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

function QuizBlock({ block }) {
  const [selected, setSelected] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const opts = Array.isArray(block.options) ? block.options : [];
  const answer = block.answer;

  return (
    <div className="irr-block irr-block-card">
      <div className="irr-block-label">
        <HelpCircle size={16} aria-hidden />
        Quiz
      </div>
      <div className="irr-quiz-q">{block.question || 'Question'}</div>
      <div className="irr-quiz-options">
        {opts.map((o, idx) => {
          let extra = '';
          if (submitted) {
            if (idx === answer) extra = ' is-correct';
            else if (idx === selected && selected !== answer) extra = ' is-wrong';
          } else if (selected === idx) {
            extra = ' is-selected';
          }
          return (
            <button
              key={idx}
              type="button"
              className={`irr-quiz-opt${extra}`}
              onClick={() => {
                setSelected(idx);
                setSubmitted(false);
              }}
            >
              {o}
            </button>
          );
        })}
      </div>
      <div className="irr-quiz-actions">
        <button type="button" className="irr-btn irr-btn-primary" onClick={() => setSubmitted(true)} disabled={selected == null}>
          Check answer
        </button>
        {submitted ? (
          <span className={`irr-feedback ${selected === answer ? 'ok' : 'bad'}`}>
            {selected === answer ? 'Correct — well done!' : 'Not quite — try again.'}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function DragDropBlock({ block }) {
  const [matches, setMatches] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [dragOver, setDragOver] = useState(null);
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

  const total = Object.keys(correct).length || 0;

  return (
    <div className="irr-block irr-block-card">
      <div className="irr-block-label">
        <Layers size={16} aria-hidden />
        Drag &amp; drop
      </div>
      <div className="irr-quiz-q" style={{ marginBottom: 16 }}>
        {block.question || 'Match the items'}
      </div>

      <div className="irr-dd-layout">
        <div>
          <div className="irr-dd-col-title">Draggable</div>
          {items.map((item) => (
            <div
              key={item}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('item', item)}
              className="irr-dd-item"
            >
              <GripVertical size={14} style={{ verticalAlign: 'middle', marginRight: 6, opacity: 0.4 }} aria-hidden />
              {item}
              <div className="irr-dd-match">→ {matches[item] ? String(matches[item]) : 'drop on a target'}</div>
            </div>
          ))}
        </div>

        <div>
          <div className="irr-dd-col-title">Drop zones</div>
          {targets.map((t) => (
            <div
              key={t}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(t);
              }}
              onDragLeave={() => setDragOver((d) => (d === t ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const item = e.dataTransfer.getData('item');
                if (item) onDrop(item, t);
              }}
              className={`irr-dd-target${dragOver === t ? ' is-drag-over' : ''}`}
            >
              {t}
            </div>
          ))}
        </div>
      </div>

      <div className="irr-quiz-actions">
        <button type="button" className="irr-btn irr-btn-primary" onClick={() => setSubmitted(true)}>
          Score matches
        </button>
        {submitted ? (
          <span className={`irr-feedback ${score === total && total > 0 ? 'ok' : 'bad'}`}>
            Score: {score}/{total || '—'}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function AudioBlock({ block }) {
  const src = block.src;
  return (
    <div className="irr-block irr-block-card">
      <div className="irr-block-label">
        <Music size={16} aria-hidden />
        Audio
      </div>
      {src ? (
        <audio controls className="irr-audio-player">
          <source src={src} type="audio/mpeg" />
        </audio>
      ) : (
        <div style={{ color: '#94a3b8', fontSize: 14 }}>(no audio source)</div>
      )}
      {block.start != null || block.end != null ? (
        <div style={{ color: '#64748b', marginTop: 10, fontSize: 13 }}>
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
  const [mode, setMode] = useState('word');

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
    <div className="irr-block irr-block-card">
      <div className="irr-readalong-toolbar">
        <div className="irr-block-label" style={{ marginBottom: 0 }}>
          <Headphones size={16} aria-hidden />
          Read-along
        </div>
        <select className="irr-select" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Highlight mode">
          <option value="word">Word highlight</option>
          <option value="sentence">Sentence highlight</option>
        </select>
      </div>

      {audio ? (
        <audio ref={audioRef} controls className="irr-audio-player">
          <source src={audio} type="audio/mpeg" />
        </audio>
      ) : (
        <div style={{ color: '#94a3b8', marginBottom: 12, fontSize: 14 }}>(no audio source)</div>
      )}

      <div style={{ lineHeight: 2.1, fontSize: '1.05rem' }}>
        {words.map((w, idx) => {
          const isWordActive = mode === 'word' && idx === activeIndex;
          const isSentenceActive =
            mode === 'sentence' && activeSentenceRange && idx >= activeSentenceRange.first && idx <= activeSentenceRange.last;
          const active = isWordActive || isSentenceActive;
          return (
            <span
              key={w.id || idx}
              ref={(el) => {
                if (el) wordRefs.current[idx] = el;
              }}
              className={`irr-word${active ? ' is-active' : ''}`}
              onClick={() => {
                if (!audioRef.current) return;
                const start = Number(w.start ?? 0);
                audioRef.current.currentTime = Number.isFinite(start) ? start : 0;
                void audioRef.current.play();
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
  const c = getBlockContent(block);

  if (type === 'text') {
    if (Array.isArray(c.words) && c.words.length && c.audio) {
      return <ReadAlongBlock block={c} />;
    }
    const html = (typeof c.html === 'string' ? c.html : typeof c.content === 'string' ? c.content : '').trim();
    return <TextBlock html={html || '<p>(empty text)</p>'} />;
  }
  if (type === 'image') {
    return <ImageBlock c={c} />;
  }
  if (type === 'audio_sync' || type === 'readalong') return <ReadAlongBlock block={c} />;
  if (type === 'quiz') return <QuizBlock block={c} />;
  if (type === 'dragdrop') return <DragDropBlock block={c} />;
  if (type === 'audio') return <AudioBlock block={c} />;
  if (type === 'h5p') {
    const layout = block.layout_json ?? c.layout ?? {};
    const wrapStyle =
      layout.mode === 'fixed'
        ? {
            position: 'relative',
            minHeight: Number(layout.height) * 4 || 200
          }
        : undefined;
    const innerStyle =
      layout.mode === 'fixed'
        ? {
            position: 'absolute',
            left: `${layout.x ?? 0}%`,
            top: `${layout.y ?? 0}%`,
            width: `${layout.width ?? 50}%`,
            height: `${layout.height ?? 30}%`,
            zIndex: layout.zIndex ?? 1
          }
        : undefined;
    return (
      <div className="irr-block irr-block--h5p" style={wrapStyle}>
        <div style={innerStyle}>
          <H5pPlayerEmbed
            h5pContentId={block.h5p_content_id ?? block.h5pContentId ?? c.h5pContentId ?? c.h5p_content_id}
            title={c.title || 'Interactive activity'}
            minHeight={layout.mode === 'fixed' ? '100%' : 320}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="irr-block irr-block-card">
      <div className="irr-block-label">
        <Sparkles size={16} aria-hidden />
        Block: {type || 'unknown'}
      </div>
      <pre className="irr-fallback-pre">{JSON.stringify(c, null, 2)}</pre>
    </div>
  );
}

function sortedChapters(chapters) {
  return (chapters || []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export default function InteractiveReader() {
  const { bookId } = useParams();
  const id = useMemo(() => Number(bookId), [bookId]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [book, setBook] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [blocksByChapterId, setBlocksByChapterId] = useState(new Map());
  const [activeChapterId, setActiveChapterId] = useState(null);
  const [progress, setProgress] = useState(0);
  const [showTopBtn, setShowTopBtn] = useState(false);

  const chapterRefs = useRef({});
  const ordered = useMemo(() => sortedChapters(chapters), [chapters]);

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

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const h = doc.scrollHeight - doc.clientHeight;
      setProgress(h > 0 ? (doc.scrollTop / h) * 100 : 0);
      setShowTopBtn(window.scrollY > 420);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting && e.target?.dataset?.chapterId);
        if (!visible.length) return;
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const cid = Number(visible[0].target.dataset.chapterId);
        if (Number.isFinite(cid)) setActiveChapterId(cid);
      },
      { root: null, rootMargin: '-20% 0px -45% 0px', threshold: [0, 0.1, 0.25] },
    );

    const raf = requestAnimationFrame(() => {
      for (const ch of ordered) {
        const el = chapterRefs.current[ch.id];
        if (el) obs.observe(el);
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
    };
  }, [ordered]);

  function scrollToChapter(chapterId) {
    const el = chapterRefs.current[chapterId];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (!Number.isFinite(id)) {
    return (
      <div className="irr-shell">
        <div className="irr-error">
          <div className="irr-error-box">Invalid book link.</div>
          <Link to="/interactive" className="irr-back">
            <ArrowLeft size={16} /> Back to books
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="irr-shell">
        <div className="irr-loading">
          <Loader2 size={40} className="irr-spinner" aria-hidden />
          <p>Opening book…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="irr-shell">
        <div className="irr-error">
          <div className="irr-error-box" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, textAlign: 'left' }}>
            <AlertCircle size={22} style={{ flexShrink: 0 }} aria-hidden />
            <span>{error}</span>
          </div>
          <Link to="/interactive" className="irr-back">
            <ArrowLeft size={16} /> Back to books
          </Link>
        </div>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="irr-shell">
        <div className="irr-error">
          <p>Book not found.</p>
          <Link to="/interactive" className="irr-back">
            <ArrowLeft size={16} /> Back to books
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="irr-shell">
      <div className="irr-progress-track" aria-hidden>
        <div className="irr-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <header className="irr-header">
        <div className="irr-header-inner">
          <div>
            <Link to="/interactive" className="irr-back">
              <ArrowLeft size={16} aria-hidden />
              Books
            </Link>
            <div className="irr-title-row">
              <div className="irr-title-icon" aria-hidden>
                <BookOpen size={24} />
              </div>
              <div>
                <h1 className="irr-title">{book.title}</h1>
                <p className="irr-meta">Interactive reader · {ordered.length} chapter{ordered.length === 1 ? '' : 's'}</p>
              </div>
            </div>
          </div>
          <div className="irr-header-actions">
            <Link to={`/interactive/editor/${book.id}`} className="irr-btn irr-btn-primary">
              <Pencil size={18} aria-hidden />
              Edit book
            </Link>
          </div>
        </div>
      </header>

      {book.description ? <p className="irr-desc">{book.description}</p> : null}

      <div style={{ maxWidth: 900, margin: '0 auto 12px', padding: '0 20px' }}>
        <ReaderCompatibilityBanner compact />
      </div>

      <div className="irr-layout">
        <div className="irr-toc-wrap irr-toc-desktop">
          <div className="irr-toc-card">
            <h2 className="irr-toc-title">Contents</h2>
            <nav className="irr-toc-nav" aria-label="Chapters">
              {ordered.map((ch, idx) => (
                <button
                  key={ch.id}
                  type="button"
                  className={`irr-toc-item${ch.id === activeChapterId ? ' is-active' : ''}`}
                  onClick={() => scrollToChapter(ch.id)}
                >
                  <span className="irr-toc-num">{idx + 1}.</span>
                  {ch.title}
                </button>
              ))}
            </nav>
          </div>
        </div>

        <article className="irr-article">
          {ordered.length > 1 ? (
            <div className="irr-mobile-toc">
              <label htmlFor="irr-chapter-jump" className="visually-hidden">
                Jump to chapter
              </label>
              <select
                id="irr-chapter-jump"
                className="irr-mobile-select"
                value={activeChapterId ?? ordered[0]?.id ?? ''}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) scrollToChapter(v);
                }}
              >
                {ordered.map((ch, idx) => (
                  <option key={ch.id} value={ch.id}>
                    {idx + 1}. {ch.title}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {ordered.map((ch, idx) => {
            const blocks = blocksByChapterId.get(Number(ch.id)) || [];
            return (
              <section
                key={ch.id}
                id={`chapter-${ch.id}`}
                ref={(el) => {
                  chapterRefs.current[ch.id] = el;
                }}
                data-chapter-id={ch.id}
                className="irr-chapter"
              >
                <div className="irr-chapter-header">
                  <span className="irr-chapter-index">{idx + 1}</span>
                  <h2 className="irr-chapter-title">{ch.title}</h2>
                </div>
                {blocks.length === 0 ? (
                  <div className="irr-empty-chapter">This chapter has no content yet.</div>
                ) : (
                  blocks
                    .slice()
                    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
                    .map((bl) => <RenderBlock key={bl.id} block={bl} />)
                )}
              </section>
            );
          })}
        </article>
      </div>

      <button
        type="button"
        className={`irr-fab-top${showTopBtn ? ' is-visible' : ''}`}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="Back to top"
      >
        <ArrowUp size={22} />
      </button>
    </div>
  );
}