import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { HiOutlineSelector } from 'react-icons/hi';

export function SortableItem(props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 999 : 'auto',
    opacity: isDragging ? 0.5 : 1,
    boxShadow: isDragging ? '0px 5px 15px rgba(0,0,0,0.25)' : 'none',
    position: 'relative',
    touchAction: 'none', // Prevent scrolling on mobile while dragging
    marginBottom: '8px',
  };

  return (
    <div ref={setNodeRef} style={style} className={`sortable-item ${isDragging ? 'is-dragging' : ''}`}>
      {props.children({ attributes, listeners, isDragging })}
    </div>
  );
}
