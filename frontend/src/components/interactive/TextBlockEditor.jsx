import React, { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';

export default function TextBlockEditor({ value, onChange }) {
  const html = typeof value?.html === 'string'
    ? value.html
    : (typeof value?.content === 'string' ? value.content : '<p></p>');

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Write…' })
    ],
    content: html,
    onUpdate: ({ editor }) => {
      const next = editor.getHTML();
      onChange({ html: next });
    }
  });

  // Keep editor in sync when switching blocks.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (current !== html) {
      editor.commands.setContent(html || '<p></p>', false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, html]);

  if (!editor) return <div style={{ color: '#666' }}>Loading editor…</div>;

  return (
    <div style={{ border: '1px solid #e6e6e6', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: 8, borderBottom: '1px solid #eee', background: '#fafafa', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" onClick={() => editor.chain().focus().toggleBold().run()}>
          Bold
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => editor.chain().focus().toggleItalic().run()}>
          Italic
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => editor.chain().focus().toggleBulletList().run()}>
          Bullets
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          Numbered
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            const href = window.prompt('Link URL');
            if (!href) return;
            editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
          }}
        >
          Link
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => editor.chain().focus().unsetLink().run()}>
          Unlink
        </button>
      </div>

      <div style={{ padding: 10, background: '#fff' }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

