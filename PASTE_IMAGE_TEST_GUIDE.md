# 🧪 Paste Image Test Guide

## How to Test the Paste Functionality

Follow these steps to verify that image pasting works correctly and ONLY in the editor.

## ✅ Test 1: Paste in Editor (Should Work)

### Steps:
1. Open the interactive editor
2. **Click inside the editor area** (you should see a blinking cursor)
3. Copy an image:
   - **Windows**: Win+Shift+S (screenshot tool)
   - **Mac**: Cmd+Shift+4 (screenshot tool)
   - **Or**: Right-click any image in browser → "Copy Image"
4. Press **Ctrl+V** (or Cmd+V on Mac)

### Expected Result:
✅ Image should be added as a new block in the preview section below

### If it doesn't work:
- Make sure you clicked IN the editor (cursor should be visible)
- Make sure you copied an IMAGE, not just the URL
- Try right-clicking an image and selecting "Copy Image"

---

## ❌ Test 2: Paste in Preview (Should NOT Work)

### Steps:
1. Scroll down to the preview section
2. **Click anywhere in the preview area**
3. Copy an image (same as above)
4. Press **Ctrl+V**

### Expected Result:
✅ Nothing should happen (this is correct!)

### If an image is added:
🐛 **Bug still exists** - the paste handler is not checking focus correctly

---

## ❌ Test 3: Paste Outside Editor (Should NOT Work)

### Steps:
1. Click in the chapter sidebar (left side)
2. Copy an image
3. Press **Ctrl+V**

### Expected Result:
✅ Nothing should happen

---

## ✅ Test 4: Paste in Image Modal (Should Work)

### Steps:
1. Click the **🖼️ Image** button (green)
2. Click the **📤 Upload** tab
3. Copy an image
4. Press **Ctrl+V**

### Expected Result:
✅ Image should load in the modal's drop zone

---

## ❌ Test 5: Paste in Image Modal URL Tab (Should NOT Work)

### Steps:
1. Click the **🖼️ Image** button (green)
2. Stay on the **🔗 URL** tab (don't switch to Upload)
3. Copy an image
4. Press **Ctrl+V**

### Expected Result:
✅ Nothing should happen (paste only works in Upload tab)

---

## 🖱️ Test 6: Drag & Drop in Editor (Should Work)

### Steps:
1. Find an image file on your computer
2. Drag it over the editor area
3. Drop it

### Expected Result:
✅ Image should be added as a block

---

## ❌ Test 7: Drag & Drop in Preview (Should NOT Work)

### Steps:
1. Find an image file on your computer
2. Drag it over the preview area
3. Drop it

### Expected Result:
✅ Nothing should happen

---

## 🔍 Debugging Tips

### If paste is still adding images in the wrong place:

1. **Open Browser Console** (F12)
2. Look for any errors
3. Check if you see multiple "image added" messages

### Check Focus:
- The editor should have a visible cursor when focused
- The editor border might change color when focused
- Try clicking directly on the text area, not the toolbar

### Clear Browser Cache:
```
1. Press Ctrl+Shift+Delete
2. Clear cached images and files
3. Reload the page (Ctrl+F5)
```

### Check React DevTools:
- Install React DevTools extension
- Check if CKEditorEnhanced component is receiving the paste event
- Verify editor.hasFocus() returns true

---

## 📊 Test Results Template

Copy this and fill it out:

```
Date: _______________
Browser: _______________
OS: _______________

Test 1 (Paste in Editor): ☐ Pass ☐ Fail
Test 2 (Paste in Preview): ☐ Pass ☐ Fail
Test 3 (Paste Outside): ☐ Pass ☐ Fail
Test 4 (Paste in Modal Upload): ☐ Pass ☐ Fail
Test 5 (Paste in Modal URL): ☐ Pass ☐ Fail
Test 6 (Drag in Editor): ☐ Pass ☐ Fail
Test 7 (Drag in Preview): ☐ Pass ☐ Fail

Notes:
_________________________________
_________________________________
_________________________________
```

---

## 🐛 If Tests Fail

### Scenario: Images paste everywhere
**Problem**: Event handlers not checking focus properly
**Solution**: Check that `view.hasFocus()` is working in TipTap

### Scenario: Images don't paste at all
**Problem**: Event handler not triggering
**Solution**: Check browser console for errors

### Scenario: Images paste but in wrong format
**Problem**: Base64 conversion issue
**Solution**: Check file size (must be < 5MB)

---

## 💡 Quick Test (30 seconds)

1. Click in editor
2. Take screenshot (Win+Shift+S)
3. Press Ctrl+V
4. ✅ Image should appear

5. Click in preview
6. Press Ctrl+V again
7. ✅ Nothing should happen

**If both work correctly, the fix is successful!** 🎉

---

## 📝 Report Format

If you find a bug, report it like this:

```
**Bug**: Images paste in preview section

**Steps to Reproduce**:
1. Click in preview area
2. Copy image
3. Press Ctrl+V

**Expected**: Nothing happens
**Actual**: Image is added

**Browser**: Chrome 120
**OS**: Windows 11
**Screenshot**: [attach if possible]
```

---

**Test thoroughly and let me know the results!** 🧪
