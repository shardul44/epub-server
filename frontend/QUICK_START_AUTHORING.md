# Quick Start Guide - Interactive Authoring Tool

## 🚀 Getting Started in 5 Minutes

### Step 1: Access the Editor
1. Navigate to `http://localhost:3000/interactive`
2. Click "Create Book" or select an existing book
3. Click "Edit" to open the enhanced editor

### Step 2: Create Your First Chapter
1. In the left sidebar, type a chapter name (e.g., "Introduction")
2. Click "+ Add Chapter"
3. The chapter will be selected automatically

### Step 3: Add Text Content
1. Type your content in the main editor
2. Use the toolbar to format:
   - **B** = Bold
   - **I** = Italic
   - **H1, H2, H3** = Headings
   - **• List** = Bullet points
   - **1. List** = Numbered list
   - **🔗 Link** = Add hyperlinks
3. Click "✓ Add Text Block" to save

### Step 4: Add a Quiz
1. Click the **❓ Quiz** button (purple)
2. Enter your question
3. Add options (minimum 2)
4. Check the box next to the correct answer
5. Click "Add Quiz"

### Step 5: Add an Image
1. Click the **🖼️ Image** button (green)
2. Paste an image URL
3. Add alt text (for accessibility)
4. Optionally add a caption
5. Choose width (100%, 75%, 50%, or 25%)
6. Click "Add Image"

### Step 6: Add Audio
1. Click the **🔊 Audio** button (orange)
2. Paste an audio file URL (.mp3, .wav, .ogg)
3. Add a title
4. Optionally set start/end times
5. Click "Add Audio"

### Step 7: Add Drag & Drop Activity
1. Click the **🎯 Drag-Drop** button (blue)
2. Enter your question
3. Add draggable items (left column)
4. Add drop targets (right column)
5. Set correct matches at the bottom
6. Click "Add Drag & Drop"

### Step 8: Preview Your Content
- Scroll down to see the live preview
- Test interactive elements (quiz, drag-drop)
- Delete blocks if needed using the "Delete" button

### Step 9: Add More Chapters
1. Create additional chapters in the sidebar
2. Switch between chapters by clicking them
3. Each chapter can have its own content

### Step 10: Preview in Reader
1. Click "👁️ Preview Reader" in the top-right
2. Navigate through chapters
3. Test all interactive elements
4. Share the reader URL with students

## 📋 Example Workflow

### Creating a Lesson on "The Solar System"

1. **Chapter 1: Introduction**
   - Text: "Welcome to our lesson on the Solar System..."
   - Image: Solar system diagram
   - Quiz: "How many planets are in our solar system?"

2. **Chapter 2: The Planets**
   - Text: "Let's explore each planet..."
   - Drag-Drop: Match planets to their characteristics
   - Audio: Pronunciation of planet names

3. **Chapter 3: Quiz Time**
   - Multiple quiz blocks testing knowledge
   - Text: Summary and key takeaways

## 🎨 Formatting Tips

### Text Formatting
```
Use **Bold** for emphasis
Use *Italic* for definitions
Use Headings for structure
Use Lists for steps or items
```

### Quiz Best Practices
- Keep questions clear and concise
- Provide 3-4 options
- Avoid "all of the above" or "none of the above"
- Give immediate feedback

### Image Guidelines
- Use high-quality images
- Always add alt text
- Use captions to explain context
- Choose appropriate width for content

### Audio Tips
- Use clear, high-quality recordings
- Keep clips short (under 2 minutes)
- Add descriptive titles
- Test playback before publishing

### Drag & Drop Design
- Keep items and targets short
- Use 3-6 items (not too many)
- Make matches logical and clear
- Test the activity yourself

## 🔧 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+B | Bold |
| Ctrl+I | Italic |
| Ctrl+K | Add Link |
| Enter | New paragraph |
| Shift+Enter | Line break |

## 🐛 Troubleshooting

### "Please select a chapter first"
- Make sure a chapter is highlighted in the sidebar
- Create a chapter if none exist

### Image not loading
- Check the URL is correct and accessible
- Use direct image links (ending in .jpg, .png, etc.)
- Try a different image hosting service

### Audio not playing
- Verify the audio URL is correct
- Check file format (MP3, WAV, OGG)
- Test the URL in a new browser tab

### Quiz not saving
- Ensure you've entered a question
- Add at least 2 options
- Mark one option as correct

## 💡 Pro Tips

1. **Save Often** - Each block is saved immediately when added
2. **Use Preview** - Always test interactive elements
3. **Mobile-Friendly** - Content works on all devices
4. **Accessibility** - Add alt text and captions
5. **Organize** - Use chapters to structure content
6. **Test Quizzes** - Try wrong answers to see feedback
7. **Reuse Content** - Copy successful patterns
8. **Keep It Simple** - Don't overload with interactivity

## 🎯 Common Use Cases

### Educational Course
- Text lessons
- Quiz assessments
- Audio pronunciations
- Image diagrams

### Training Manual
- Step-by-step instructions
- Interactive checks
- Visual aids
- Audio guidance

### Interactive Story
- Narrative text
- Character images
- Sound effects
- Comprehension quizzes

### Language Learning
- Vocabulary lists
- Pronunciation audio
- Matching exercises
- Grammar quizzes

## 📱 Mobile Experience

All content is responsive and works on:
- Desktop computers
- Tablets
- Smartphones
- E-readers

## 🔄 Editing Existing Content

To edit existing blocks:
1. Go to `/interactive/editor-classic/:bookId` (classic editor)
2. Use the advanced editing features
3. Or delete and recreate in the enhanced editor

## 🎓 Learning Resources

- **TipTap Docs**: https://tiptap.dev/
- **EPUB Standards**: https://www.w3.org/publishing/epub3/
- **Accessibility**: https://www.w3.org/WAI/WCAG21/quickref/

## 🆘 Need Help?

- Check the preview to see how content looks
- Test interactive elements before publishing
- Use the classic editor for advanced features
- Refer to CKEDITOR_AUTHORING_TOOL.md for details

---

**Happy Creating! 🎉**
