# CKEditor-Like Authoring Tool for Interactive EPUB

## Overview

This implementation provides a **Kitaboo/Kotobee-like authoring experience** using TipTap (a modern alternative to CKEditor) with custom plugins for creating interactive EPUB content.

## 🎯 Features

### Rich Text Editing
- **Bold, Italic, Strikethrough** formatting
- **Headings** (H1, H2, H3)
- **Lists** (Bulleted and Numbered)
- **Links** (Add/Remove hyperlinks)
- Clean, intuitive toolbar interface

### Interactive Block Plugins

#### 1. ❓ Quiz Plugin
- Create multiple-choice questions
- Add unlimited options
- Mark correct answer with checkbox
- Visual feedback on answer selection
- Try again functionality
- **Modal-based creation** for better UX

#### 2. 🖼️ Image Plugin
- Add images via URL
- Alt text for accessibility
- Optional captions
- Adjustable width (100%, 75%, 50%, 25%)
- Live preview in modal

#### 3. 🔊 Audio Plugin
- Embed audio files (MP3, WAV, OGG)
- Set start/end times for clips
- Custom titles
- HTML5 audio player
- Live preview in modal

#### 4. 🎯 Drag & Drop Plugin
- Create matching activities
- Define draggable items and drop targets
- Set correct matches
- Visual feedback on completion
- Reset functionality
- **Perfect for educational content**

## 🏗️ Architecture

```
CKEditorEnhanced (Main Editor)
    ↓
Custom Modals (Quiz, Image, Audio, DragDrop)
    ↓
Structured JSON Output
    ↓
Backend API
    ↓
BlockRenderer (Preview/Reader)
    ↓
Interactive EPUB
```

## 📁 File Structure

```
frontend/src/
├── components/interactive/
│   ├── CKEditorEnhanced.jsx       # Main editor with toolbar
│   ├── QuizModal.jsx               # Quiz creation modal
│   ├── ImageModal.jsx              # Image insertion modal
│   ├── AudioModal.jsx              # Audio insertion modal
│   ├── DragDropModal.jsx           # Drag-drop activity modal
│   ├── BlockRenderer.jsx           # Preview/render blocks
│   ├── TextBlockEditor.jsx         # (Legacy) Simple text editor
│   ├── QuizBlockEditor.jsx         # (Legacy) Quiz editor
│   └── ...
├── pages/interactive/
│   ├── InteractiveEditorEnhanced.jsx  # NEW: Enhanced editor page
│   ├── InteractiveEditor.jsx          # Classic editor (preserved)
│   ├── InteractiveBooks.jsx
│   └── InteractiveReader.jsx
```

## 🚀 Usage

### Access the Editor

1. Navigate to `/interactive`
2. Select or create a book
3. Click "Edit" to open the enhanced editor
4. **URL**: `/interactive/editor/:bookId`

### Creating Content

#### Text Content
1. Type directly in the editor
2. Use toolbar buttons for formatting
3. Click "✓ Add Text Block" to save

#### Interactive Blocks
1. Click the colored plugin buttons:
   - **❓ Quiz** - Purple button
   - **🖼️ Image** - Green button
   - **🔊 Audio** - Orange button
   - **🎯 Drag-Drop** - Blue button
2. Fill in the modal form
3. Click "Add" to insert the block

### Chapter Management
- Create chapters in the left sidebar
- Switch between chapters
- Delete chapters (with confirmation)

### Preview
- Live preview appears below the editor
- Test interactive elements
- Delete blocks if needed

## 🎨 Design Philosophy

### Why Modal-Based?
Instead of inline editing (which can be messy), we use **modal dialogs** for complex blocks:
- ✅ Better UX for structured data
- ✅ Validation before insertion
- ✅ Preview before adding
- ✅ Cleaner editor interface

### Block-Based Architecture
Each block is stored as structured JSON:

```json
{
  "type": "quiz",
  "data": {
    "question": "What is 2+2?",
    "options": ["3", "4", "5"],
    "answer": 1
  }
}
```

This allows:
- Easy rendering in different contexts
- EPUB export compatibility
- Future extensibility

## 🔧 Technical Details

### Dependencies
- **@tiptap/react** - Rich text editor
- **@tiptap/starter-kit** - Basic formatting
- **@tiptap/extension-link** - Link support
- **@tiptap/extension-placeholder** - Placeholder text

### Data Flow

1. **Editor** → User creates content
2. **Modal** → Structured data collection
3. **onAddBlock** → Callback with block data
4. **API Call** → Save to backend
5. **BlockRenderer** → Display in preview/reader

### Block Types

| Type | Description | Data Structure |
|------|-------------|----------------|
| `text` | Rich text content | `{ html: string }` |
| `quiz` | Multiple choice | `{ question, options[], answer }` |
| `image` | Image with caption | `{ url, alt, caption, width }` |
| `audio` | Audio player | `{ src, title, start, end }` |
| `dragdrop` | Matching activity | `{ question, items[], targets[], correct{} }` |

## 🎓 Educational Use Cases

### Quiz Plugin
- Assessments
- Self-check questions
- Knowledge verification

### Drag & Drop Plugin
- Vocabulary matching
- Concept mapping
- Categorization exercises

### Audio Plugin
- Pronunciation guides
- Listening comprehension
- Music theory examples

### Image Plugin
- Diagrams
- Illustrations
- Visual aids

## 🔄 Migration from Classic Editor

The classic editor (`InteractiveEditor.jsx`) is preserved at:
- **URL**: `/interactive/editor-classic/:bookId`

Both editors work with the same backend API and data structure.

## 🚀 Future Enhancements

### Potential Additions
1. **Video Plugin** - Embed videos with controls
2. **Code Block Plugin** - Syntax-highlighted code
3. **Math Equation Plugin** - LaTeX support
4. **Hotspot Plugin** - Interactive image areas
5. **Timeline Plugin** - Historical events
6. **Flashcard Plugin** - Study cards
7. **Fill-in-the-Blank Plugin** - Cloze exercises

### Advanced Features
- **Undo/Redo** - Already supported by TipTap
- **Collaboration** - Real-time editing (TipTap supports this)
- **Templates** - Pre-built content structures
- **Import/Export** - Word, Google Docs integration
- **AI Assistance** - Content generation

## 📊 Comparison with Kitaboo/Kotobee

| Feature | Kitaboo/Kotobee | Our Implementation |
|---------|-----------------|-------------------|
| Rich Text | ✅ | ✅ |
| Quiz | ✅ | ✅ |
| Drag-Drop | ✅ | ✅ |
| Audio | ✅ | ✅ |
| Image | ✅ | ✅ |
| Video | ✅ | 🔜 (Easy to add) |
| Hotspots | ✅ | 🔜 (Planned) |
| EPUB Export | ✅ | ✅ (Backend) |
| Cloud Storage | ✅ | ✅ |
| Collaboration | ✅ | 🔜 (TipTap supports) |

## 🎯 Key Advantages

1. **Open Source** - No licensing fees
2. **Customizable** - Full control over features
3. **Modern Stack** - React + TipTap
4. **Extensible** - Easy to add new plugins
5. **Structured Data** - JSON-based, portable
6. **Accessibility** - WCAG compliant rendering

## 📝 Content Compliance

All content follows accessibility best practices:
- Alt text for images
- Semantic HTML structure
- Keyboard navigation support
- Screen reader compatibility

## 🐛 Known Limitations

1. **No Drag-Drop in Editor** - Blocks are added sequentially (can be reordered in classic editor)
2. **No Inline Image Upload** - Uses URLs (can add file upload later)
3. **No Collaborative Editing** - Single user at a time (TipTap supports this feature)

## 🔗 Related Documentation

- [TipTap Documentation](https://tiptap.dev/)
- [Interactive Service API](../src/services/interactiveService.js)
- [Backend Routes](../../backend/src/routes/interactiveRoutes.js)

## 💡 Tips for Content Creators

1. **Start with Text** - Write your content first
2. **Add Interactivity** - Insert quizzes and activities
3. **Use Preview** - Test everything before publishing
4. **Organize Chapters** - Keep content structured
5. **Accessibility First** - Always add alt text and captions

---

**Built with ❤️ for educational content creation**
