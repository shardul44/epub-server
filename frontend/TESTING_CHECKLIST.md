# Testing Checklist - Interactive Editor

## 🎯 Purpose

Use this checklist to verify that the enhanced interactive editor is working correctly.

## ✅ Pre-Testing Setup

### Environment
- [ ] Frontend running at `http://localhost:3000`
- [ ] Backend running at `http://localhost:5000`
- [ ] Database is accessible
- [ ] User is logged in
- [ ] User has appropriate permissions

### Browser
- [ ] Chrome/Edge (recommended)
- [ ] Firefox
- [ ] Safari
- [ ] Mobile browser (optional)

## 📚 Book Management

### Create Book
- [ ] Navigate to `/interactive`
- [ ] Click "Create Book" button
- [ ] Enter book title
- [ ] Book appears in list
- [ ] Can click "Edit" button

### Access Editor
- [ ] Click "Edit" on a book
- [ ] URL changes to `/interactive/editor/:bookId`
- [ ] Editor interface loads
- [ ] No console errors
- [ ] Header shows book title

## 📖 Chapter Management

### Create Chapter
- [ ] Enter chapter title in sidebar
- [ ] Click "+ Add Chapter"
- [ ] Chapter appears in list
- [ ] Chapter is automatically selected
- [ ] Editor area becomes active

### Select Chapter
- [ ] Click on different chapter
- [ ] Chapter highlights (blue border)
- [ ] Editor shows chapter content
- [ ] Preview updates

### Delete Chapter
- [ ] Click "Delete" on a chapter
- [ ] Confirmation dialog appears
- [ ] Click "OK"
- [ ] Chapter is removed
- [ ] Next chapter is selected

### Multiple Chapters
- [ ] Create 3+ chapters
- [ ] Switch between them
- [ ] Each maintains its content
- [ ] No data loss when switching

## ✏️ Text Editing

### Basic Typing
- [ ] Click in editor area
- [ ] Type some text
- [ ] Text appears immediately
- [ ] Cursor moves correctly
- [ ] Can use backspace/delete

### Bold Formatting
- [ ] Select text
- [ ] Click "B" button
- [ ] Text becomes bold
- [ ] Click again to unbold
- [ ] Keyboard shortcut (Ctrl+B) works

### Italic Formatting
- [ ] Select text
- [ ] Click "I" button
- [ ] Text becomes italic
- [ ] Click again to remove italic
- [ ] Keyboard shortcut (Ctrl+I) works

### Strikethrough
- [ ] Select text
- [ ] Click "S" button
- [ ] Text has strikethrough
- [ ] Click again to remove

### Headings
- [ ] Click "H1" button
- [ ] Line becomes heading 1
- [ ] Try "H2" and "H3"
- [ ] Each has different size
- [ ] Can toggle back to paragraph

### Bullet List
- [ ] Click "• List" button
- [ ] Bullet point appears
- [ ] Press Enter for new bullet
- [ ] Press Enter twice to exit list
- [ ] Can nest bullets (Tab)

### Numbered List
- [ ] Click "1. List" button
- [ ] Number appears
- [ ] Press Enter for next number
- [ ] Numbers increment automatically
- [ ] Press Enter twice to exit

### Links
- [ ] Select text
- [ ] Click "🔗 Link" button
- [ ] Enter URL in prompt
- [ ] Link is created
- [ ] Link is blue and underlined
- [ ] Click "Unlink" to remove

### Add Text Block
- [ ] Type content in editor
- [ ] Format with various styles
- [ ] Click "✓ Add Text Block"
- [ ] Block appears in preview
- [ ] Editor clears for next block

## ❓ Quiz Plugin

### Open Modal
- [ ] Click "❓ Quiz" button (purple)
- [ ] Modal opens
- [ ] Modal has dark overlay
- [ ] Can see form fields

### Enter Question
- [ ] Type question in textarea
- [ ] Text appears as typed
- [ ] Can use multiple lines
- [ ] Placeholder disappears

### Add Options
- [ ] See 2 default options
- [ ] Type in first option
- [ ] Type in second option
- [ ] Click "+ Add Option"
- [ ] Third option appears
- [ ] Can add more options

### Mark Correct Answer
- [ ] Check box next to option 2
- [ ] Option 2 highlights (green)
- [ ] Other options uncheck
- [ ] Only one can be correct

### Remove Option
- [ ] Click "✕" on an option
- [ ] Option is removed
- [ ] Cannot remove if only 2 left
- [ ] Correct answer adjusts if needed

### Validation
- [ ] Try to submit without question
- [ ] See error message
- [ ] Try to submit without correct answer
- [ ] See error message
- [ ] Try to submit with empty option
- [ ] See error message

### Add Quiz
- [ ] Fill all fields correctly
- [ ] Click "Add Quiz"
- [ ] Modal closes
- [ ] Quiz appears in preview
- [ ] Can click options to test

### Test Quiz in Preview
- [ ] Click wrong answer
- [ ] See red feedback
- [ ] Click correct answer
- [ ] See green feedback
- [ ] Click "Try Again"
- [ ] Quiz resets

## 🖼️ Image Plugin

### Open Modal
- [ ] Click "🖼️ Image" button (green)
- [ ] Modal opens
- [ ] Form fields visible

### Enter URL
- [ ] Paste image URL
- [ ] URL appears in field
- [ ] Preview starts loading

### Preview Image
- [ ] Image loads in preview
- [ ] Image displays correctly
- [ ] If URL invalid, see error

### Alt Text
- [ ] Enter alt text
- [ ] Text appears in field
- [ ] Required for accessibility

### Caption
- [ ] Enter caption (optional)
- [ ] Caption appears in field

### Width Selection
- [ ] Select "Full Width (100%)"
- [ ] Select "Large (75%)"
- [ ] Select "Medium (50%)"
- [ ] Select "Small (25%)"
- [ ] Preview adjusts

### Add Image
- [ ] Click "Add Image"
- [ ] Modal closes
- [ ] Image appears in preview
- [ ] Caption shows if entered
- [ ] Width is correct

### Cancel
- [ ] Open modal again
- [ ] Click "Cancel"
- [ ] Modal closes
- [ ] No image added

## 🔊 Audio Plugin

### Open Modal
- [ ] Click "🔊 Audio" button (orange)
- [ ] Modal opens
- [ ] Form fields visible

### Enter URL
- [ ] Paste audio URL (.mp3, .wav, .ogg)
- [ ] URL appears in field

### Preview Audio
- [ ] Audio player appears
- [ ] Click play button
- [ ] Audio plays
- [ ] Can pause/seek

### Title
- [ ] Enter audio title
- [ ] Title appears in field

### Time Range
- [ ] Enter start time (e.g., 5)
- [ ] Enter end time (e.g., 10)
- [ ] Values appear in fields

### Add Audio
- [ ] Click "Add Audio"
- [ ] Modal closes
- [ ] Audio block appears in preview
- [ ] Can play audio in preview

## 🎯 Drag & Drop Plugin

### Open Modal
- [ ] Click "🎯 Drag-Drop" button (blue)
- [ ] Modal opens
- [ ] Two-column layout visible

### Enter Question
- [ ] Type question
- [ ] Question appears in field

### Add Items
- [ ] See 2 default items
- [ ] Edit "Item 1"
- [ ] Edit "Item 2"
- [ ] Click "+ Add Item"
- [ ] Third item appears

### Add Targets
- [ ] See 2 default targets
- [ ] Edit "Target 1"
- [ ] Edit "Target 2"
- [ ] Click "+ Add Target"
- [ ] Third target appears

### Set Correct Matches
- [ ] See mapping section
- [ ] Each item has dropdown
- [ ] Select target for each item
- [ ] Mappings update

### Remove Items/Targets
- [ ] Click "✕" on item
- [ ] Item is removed
- [ ] Mappings adjust
- [ ] Cannot remove if only 1 left

### Add Drag & Drop
- [ ] Fill all fields
- [ ] Click "Add Drag & Drop"
- [ ] Modal closes
- [ ] Activity appears in preview

### Test Drag & Drop in Preview
- [ ] Drag an item
- [ ] Drop on target
- [ ] Item moves to target
- [ ] Try all items
- [ ] See feedback when complete
- [ ] Click "Reset" to try again

## 👁️ Preview Section

### Text Block Preview
- [ ] Text block displays
- [ ] Formatting preserved
- [ ] Links are clickable
- [ ] Lists render correctly

### Quiz Block Preview
- [ ] Question displays
- [ ] Options are clickable
- [ ] Feedback shows on click
- [ ] Colors are correct (green/red)
- [ ] Can try again

### Image Block Preview
- [ ] Image loads
- [ ] Alt text is set (check HTML)
- [ ] Caption displays
- [ ] Width is correct

### Audio Block Preview
- [ ] Title displays
- [ ] Audio player works
- [ ] Can play/pause
- [ ] Controls are visible

### Drag & Drop Preview
- [ ] Question displays
- [ ] Items are draggable
- [ ] Targets accept drops
- [ ] Feedback shows when complete
- [ ] Can reset

### Block Actions
- [ ] "Delete" button visible
- [ ] Click "Delete"
- [ ] Confirmation appears
- [ ] Block is removed
- [ ] Preview updates

## 🔄 Data Persistence

### Save and Reload
- [ ] Create content
- [ ] Refresh page
- [ ] Content is still there
- [ ] No data loss

### Switch Chapters
- [ ] Add content to chapter 1
- [ ] Switch to chapter 2
- [ ] Add different content
- [ ] Switch back to chapter 1
- [ ] Original content is there

### Multiple Sessions
- [ ] Create content
- [ ] Close browser
- [ ] Open browser again
- [ ] Navigate to editor
- [ ] Content is preserved

## 📱 Reader Preview

### Access Reader
- [ ] Click "👁️ Preview Reader"
- [ ] New tab/window opens
- [ ] Reader interface loads
- [ ] Book title displays

### Navigate Chapters
- [ ] See chapter list
- [ ] Click on chapter
- [ ] Content displays
- [ ] Can switch chapters

### Test Interactive Elements
- [ ] Quiz works in reader
- [ ] Can answer questions
- [ ] Feedback displays
- [ ] Drag-drop works
- [ ] Audio plays
- [ ] Images display

## 🔄 Classic Editor Compatibility

### Switch to Classic
- [ ] Note current URL
- [ ] Change to `/interactive/editor-classic/:bookId`
- [ ] Classic editor loads
- [ ] All content is visible
- [ ] Can edit in classic

### Switch Back
- [ ] Change URL back to `/interactive/editor/:bookId`
- [ ] Enhanced editor loads
- [ ] All content is still there
- [ ] No data loss

## 🐛 Error Handling

### Network Errors
- [ ] Disconnect internet
- [ ] Try to save
- [ ] See error message
- [ ] Reconnect
- [ ] Try again
- [ ] Works correctly

### Invalid Data
- [ ] Try to add quiz without question
- [ ] See validation error
- [ ] Try to add image without URL
- [ ] See validation error

### Empty States
- [ ] No chapters: see message
- [ ] No blocks: see message
- [ ] Messages are helpful

## 🎨 UI/UX

### Visual Design
- [ ] Colors are consistent
- [ ] Buttons are clear
- [ ] Spacing is good
- [ ] No overlapping elements
- [ ] Icons are visible

### Responsiveness
- [ ] Resize browser window
- [ ] Layout adjusts
- [ ] No horizontal scroll
- [ ] Mobile view works (if applicable)

### Feedback
- [ ] Buttons show hover state
- [ ] Active states are clear
- [ ] Loading states show
- [ ] Success messages appear

### Accessibility
- [ ] Can tab through interface
- [ ] Focus indicators visible
- [ ] Alt text on images
- [ ] ARIA labels present

## 🚀 Performance

### Load Time
- [ ] Editor loads quickly (< 2 seconds)
- [ ] No long delays
- [ ] Smooth transitions

### Typing Performance
- [ ] No lag when typing
- [ ] Formatting is instant
- [ ] Preview updates quickly

### Large Content
- [ ] Create 10+ blocks
- [ ] Performance is good
- [ ] No slowdown
- [ ] Scrolling is smooth

## 📊 Browser Compatibility

### Chrome/Edge
- [ ] All features work
- [ ] No console errors
- [ ] UI looks correct

### Firefox
- [ ] All features work
- [ ] No console errors
- [ ] UI looks correct

### Safari
- [ ] All features work
- [ ] No console errors
- [ ] UI looks correct

## ✅ Final Checks

### Documentation
- [ ] README is clear
- [ ] Quick start guide works
- [ ] Examples are accurate
- [ ] Links work

### Code Quality
- [ ] No console errors
- [ ] No console warnings
- [ ] Code is formatted
- [ ] Comments are helpful

### User Experience
- [ ] Interface is intuitive
- [ ] Workflows make sense
- [ ] Error messages are helpful
- [ ] Success is clear

## 📝 Test Results

### Date: _______________
### Tester: _______________
### Browser: _______________
### OS: _______________

### Summary
- Total Tests: _____
- Passed: _____
- Failed: _____
- Skipped: _____

### Issues Found
1. _______________________________________________
2. _______________________________________________
3. _______________________________________________

### Notes
_______________________________________________
_______________________________________________
_______________________________________________

## 🎉 Sign-Off

- [ ] All critical tests passed
- [ ] No blocking issues
- [ ] Ready for production
- [ ] Documentation complete

**Tester Signature**: _______________
**Date**: _______________

---

**Use this checklist to ensure everything works correctly before deployment!**
