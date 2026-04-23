# Quick Reference Card - Interactive Editor

## 🚀 URLs

```
Enhanced Editor:  /interactive/editor/:bookId
Classic Editor:   /interactive/editor-classic/:bookId
Book List:        /interactive
Reader:           /interactive/reader/:bookId
```

## 🎨 Toolbar Buttons

| Button | Function | Shortcut |
|--------|----------|----------|
| **B** | Bold | Ctrl+B |
| **I** | Italic | Ctrl+I |
| **S** | Strikethrough | - |
| **H1** | Heading 1 | - |
| **H2** | Heading 2 | - |
| **H3** | Heading 3 | - |
| **• List** | Bullet List | - |
| **1. List** | Numbered List | - |
| **🔗 Link** | Add Link | Ctrl+K |
| **Unlink** | Remove Link | - |
| **❓ Quiz** | Add Quiz (Purple) | - |
| **🖼️ Image** | Add Image (Green) | - |
| **🔊 Audio** | Add Audio (Orange) | - |
| **🎯 Drag-Drop** | Add Drag-Drop (Blue) | - |
| **✓ Add Text** | Save Text Block | - |

## 📝 Block Types

### Text Block
```json
{
  "type": "text",
  "content": "<p>HTML content</p>"
}
```

### Quiz Block
```json
{
  "type": "quiz",
  "data": {
    "question": "Question text",
    "options": ["Option 1", "Option 2"],
    "answer": 0
  }
}
```

### Image Block
```json
{
  "type": "image",
  "data": {
    "url": "https://...",
    "alt": "Alt text",
    "caption": "Caption",
    "width": "100%"
  }
}
```

### Audio Block
```json
{
  "type": "audio",
  "data": {
    "src": "https://...",
    "title": "Title",
    "start": 0,
    "end": 0
  }
}
```

### Drag & Drop Block
```json
{
  "type": "dragdrop",
  "data": {
    "question": "Question",
    "items": ["Item 1", "Item 2"],
    "targets": ["Target 1", "Target 2"],
    "correct": {
      "Item 1": "Target 1",
      "Item 2": "Target 2"
    }
  }
}
```

## 🔧 Common Tasks

### Create a Chapter
1. Type chapter name in sidebar
2. Click "+ Add Chapter"

### Add Text Content
1. Type in editor
2. Format with toolbar
3. Click "✓ Add Text Block"

### Add a Quiz
1. Click "❓ Quiz" (purple)
2. Enter question
3. Add options
4. Check correct answer
5. Click "Add Quiz"

### Add an Image
1. Click "🖼️ Image" (green)
2. Paste URL
3. Add alt text
4. Click "Add Image"

### Add Audio
1. Click "🔊 Audio" (orange)
2. Paste URL
3. Add title
4. Click "Add Audio"

### Add Drag & Drop
1. Click "🎯 Drag-Drop" (blue)
2. Enter question
3. Add items and targets
4. Set correct matches
5. Click "Add Drag & Drop"

### Delete a Block
1. Find block in preview
2. Click "Delete" button
3. Confirm deletion

### Delete a Chapter
1. Find chapter in sidebar
2. Click "Delete" button
3. Confirm deletion

### Preview Content
1. Scroll to preview section
2. Test interactive elements
3. Click "Preview Reader" for full view

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| "Select a chapter first" | Create or click a chapter |
| Image won't load | Check URL, use direct link |
| Audio won't play | Check format (MP3/WAV/OGG) |
| Can't reorder blocks | Use classic editor |
| Modal won't close | Click Cancel or outside |

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| INTERACTIVE_EDITOR_README.md | Master guide |
| QUICK_START_AUTHORING.md | Getting started |
| CKEDITOR_AUTHORING_TOOL.md | Technical details |
| VISUAL_GUIDE.md | Interface layout |
| EDITOR_COMPARISON.md | Classic vs Enhanced |
| MIGRATION_GUIDE.md | Switching editors |
| TESTING_CHECKLIST.md | Testing guide |
| DEPLOYMENT_GUIDE.md | Production deployment |

## 🎯 Best Practices

### Content Creation
- ✅ Write text first, format later
- ✅ Use headings for structure
- ✅ Add alt text to images
- ✅ Test quizzes before publishing
- ✅ Preview frequently

### Organization
- ✅ Use descriptive chapter names
- ✅ Keep chapters focused
- ✅ Group related content
- ✅ Use consistent formatting

### Accessibility
- ✅ Always add alt text
- ✅ Use semantic headings
- ✅ Provide captions
- ✅ Test with keyboard only

## ⚡ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+B | Bold |
| Ctrl+I | Italic |
| Ctrl+K | Add Link |
| Enter | New paragraph |
| Shift+Enter | Line break |
| Tab | Indent (in lists) |
| Shift+Tab | Outdent (in lists) |
| Esc | Close modal |

## 🎨 Color Codes

| Element | Color | Hex |
|---------|-------|-----|
| Quiz Button | Purple | #9c27b0 |
| Image Button | Green | #4caf50 |
| Audio Button | Orange | #ff9800 |
| Drag-Drop Button | Blue | #2196f3 |
| Correct Answer | Green | #4caf50 |
| Incorrect Answer | Red | #f44336 |

## 📊 File Locations

```
frontend/src/
├── components/interactive/
│   ├── CKEditorEnhanced.jsx
│   ├── QuizModal.jsx
│   ├── ImageModal.jsx
│   ├── AudioModal.jsx
│   ├── DragDropModal.jsx
│   └── BlockRenderer.jsx
└── pages/interactive/
    ├── InteractiveEditorEnhanced.jsx
    ├── InteractiveEditor.jsx (classic)
    ├── InteractiveBooks.jsx
    └── InteractiveReader.jsx
```

## 🔗 API Endpoints

```
GET    /api/interactive/books
POST   /api/interactive/books
GET    /api/interactive/books/:id
DELETE /api/interactive/books/:id

GET    /api/interactive/chapters/:bookId
POST   /api/interactive/chapters
DELETE /api/interactive/chapters/:id

GET    /api/interactive/blocks/:chapterId
POST   /api/interactive/blocks
PUT    /api/interactive/blocks/:id
DELETE /api/interactive/blocks/:id
```

## 💡 Tips

1. **Save Often** - Blocks save automatically when added
2. **Use Preview** - Test before publishing
3. **Mobile-Friendly** - Content works on all devices
4. **Accessibility** - Always add alt text
5. **Organize** - Use chapters to structure
6. **Test Quizzes** - Try wrong answers
7. **Reuse Content** - Copy successful patterns
8. **Keep Simple** - Don't overload with interactivity

## 🆘 Quick Help

### Need to...
- **Reorder blocks?** → Use classic editor
- **Edit existing block?** → Delete and recreate
- **Add video?** → Coming soon (easy to add)
- **Collaborate?** → TipTap supports this
- **Export EPUB?** → Use backend API

### Getting Help
1. Check documentation
2. Review examples
3. Test in preview
4. Ask team members

---

**Print this card for quick reference!** 📄
