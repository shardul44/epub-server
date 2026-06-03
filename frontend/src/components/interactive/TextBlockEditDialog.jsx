import React, { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import { CKEditor } from '@ckeditor/ckeditor5-react';
import ClassicEditor from '@ckeditor/ckeditor5-build-classic';
import { getTextBlockCkEditorConfig } from '../../utils/ckeditorTextBlockEditor';
import './TextBlockEditDialog.css';

function getTextHtml(block) {
  if (!block) return '<p></p>';
  const c = block.content_json ?? block.contentJson ?? {};
  if (typeof c.html === 'string') return c.html;
  if (typeof c.content === 'string') return c.content;
  return '<p></p>';
}

export default function TextBlockEditDialog({
  open,
  block,
  onClose,
  onSave,
  editorConfig: editorConfigProp,
}) {
  const isCreate = !block;
  const [html, setHtml] = useState('<p></p>');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const editorConfig =
    editorConfigProp ??
    getTextBlockCkEditorConfig(
      isCreate ? 'Write lesson text…' : 'Edit lesson text…',
    );

  useEffect(() => {
    if (!open) {
      setError('');
      setSaving(false);
      return;
    }
    setHtml(isCreate ? '<p></p>' : getTextHtml(block));
  }, [open, block, isCreate]);

  async function handleSave() {
    setError('');
    setSaving(true);
    try {
      await onSave(html);
      onClose();
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to save text block');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
      <DialogTitle>{isCreate ? 'Add text block' : 'Edit text block'}</DialogTitle>
      <DialogContent dividers>
        {error ? (
          <Box sx={{ mb: 2, color: 'error.main', fontSize: 14 }} role="alert">
            {error}
          </Box>
        ) : null}
        <div className="text-block-edit-dialog__editor">
          {open ? (
            <CKEditor
              key={block?.id ?? 'new-text-block'}
              editor={ClassicEditor}
              data={html}
              onChange={(event, editor) => {
                setHtml(editor.getData());
              }}
              config={editorConfig}
            />
          ) : null}
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isCreate ? 'Add block' : 'Save changes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
