import React from 'react';
import EditIcon from '@mui/icons-material/Edit';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import ExtensionIcon from '@mui/icons-material/Extension';
import H5pPlayerEmbed from './H5pPlayerEmbed';

export default function H5pBlockCard({
  block,
  index,
  dragHandleProps,
  onEdit,
  onDuplicate,
  onDelete,
  bookLayoutMode = 'reflow',
}) {
  const c = block.content_json ?? block.contentJson ?? {};
  const layout = block.layout_json ?? c.layout ?? {};
  const title = c.title || c.displayTitle || 'H5P activity';
  const library = c.libraryName || c.machineName || 'H5P';
  const h5pId = block.h5p_content_id ?? block.h5pContentId ?? c.h5pContentId ?? c.h5p_content_id;

  const dragProps = Object.fromEntries(
    Object.entries(dragHandleProps || {}).filter(([k]) => k !== 'isDragging'),
  );

  return (
    <article className="iee-block-card iee-block-card--h5p">
      <button type="button" className="iee-block-drag" aria-label="Drag to reorder" {...dragProps}>
        <DragIndicatorIcon fontSize="small" />
      </button>

      <div className="iee-block-card__main">
        <header className="iee-block-card__header">
          <span className="iee-block-icon iee-block-icon--h5p" aria-hidden>
            <ExtensionIcon fontSize="small" />
          </span>
          <div className="iee-block-card__titles">
            <h4 className="iee-block-card__title">{title}</h4>
            <p className="iee-block-card__meta">
              {c.categoryLabel || 'Interactive'} · {library} · #{index + 1}
            </p>
          </div>
          <div className="iee-block-card__actions">
            <button type="button" className="iee-icon-btn" title="Edit" onClick={() => onEdit(block)}>
              <EditIcon fontSize="small" />
            </button>
            <button type="button" className="iee-icon-btn" title="Duplicate" onClick={() => onDuplicate(block)}>
              <ContentCopyIcon fontSize="small" />
            </button>
            <button
              type="button"
              className="iee-icon-btn iee-icon-btn--danger"
              title="Delete"
              onClick={() => onDelete(block)}
            >
              <DeleteIcon fontSize="small" />
            </button>
          </div>
        </header>

        {bookLayoutMode === 'fixed' && layout.mode === 'fixed' ? (
          <span className="iee-pill iee-pill--muted">Fixed layout · {layout.x}%, {layout.y}%</span>
        ) : null}

        <div className="iee-block-card__preview">
          <H5pPlayerEmbed h5pContentId={h5pId} title={title} minHeight={160} />
        </div>
      </div>
    </article>
  );
}
