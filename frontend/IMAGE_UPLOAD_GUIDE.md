# Image Upload & Paste Guide

## 🎨 Multiple Ways to Add Images

The enhanced editor now supports **4 different ways** to add images:

## 1. 📤 Upload from Computer

### Method A: Click to Browse
1. Click **🖼️ Image** button (green)
2. Click **📤 Upload** tab
3. Click the drop zone
4. Select image from your computer
5. Add alt text and caption
6. Click "Add Image"

### Method B: Drag & Drop into Modal
1. Click **🖼️ Image** button (green)
2. Click **📤 Upload** tab
3. Drag image file from your computer
4. Drop it into the drop zone
5. Add alt text and caption
6. Click "Add Image"

## 2. 📋 Paste from Clipboard

### Method A: Paste into Modal
1. Copy an image (from browser, screenshot tool, etc.)
2. Click **🖼️ Image** button (green)
3. Click **📤 Upload** tab
4. Press **Ctrl+V** (or Cmd+V on Mac)
5. Image appears automatically
6. Add alt text and caption
7. Click "Add Image"

### Method B: Paste Directly into Editor
1. Copy an image (from browser, screenshot tool, etc.)
2. Click in the editor area
3. Press **Ctrl+V** (or Cmd+V on Mac)
4. Image is added automatically as a block!

## 3. 🔗 Image URL

1. Click **🖼️ Image** button (green)
2. Click **🔗 URL** tab
3. Paste image URL
4. Add alt text and caption
5. Click "Add Image"

## 4. 🖱️ Drag & Drop into Editor

1. Find an image file on your computer
2. Drag it over the editor area
3. Drop it
4. Image is added automatically as a block!

## 📊 Supported Formats

- ✅ **JPG/JPEG** - Photos
- ✅ **PNG** - Graphics with transparency
- ✅ **GIF** - Animated images
- ✅ **SVG** - Vector graphics
- ✅ **WebP** - Modern format

## 📏 File Size Limits

- **Maximum**: 5MB per image
- **Recommended**: Under 1MB for faster loading
- **Tip**: Compress large images before uploading

## 🎯 How Images Are Stored

### URL Method
```json
{
  "url": "https://example.com/image.jpg"
}
```
- Stored as external link
- Requires internet to display
- Smaller database size

### Upload/Paste Method
```json
{
  "url": "data:image/png;base64,iVBORw0KG..."
}
```
- Stored as base64 in database
- Works offline
- Larger database size
- No external dependencies

## 💡 Best Practices

### When to Use URL
- ✅ Images hosted on CDN
- ✅ Large images
- ✅ Images used across multiple books
- ✅ When you want smaller database

### When to Use Upload/Paste
- ✅ Screenshots
- ✅ Custom graphics
- ✅ One-time use images
- ✅ When you need offline access
- ✅ When you don't have hosting

## 🔧 Common Workflows

### Workflow 1: Screenshot
1. Take screenshot (Windows: Win+Shift+S, Mac: Cmd+Shift+4)
2. Click in editor
3. Press Ctrl+V
4. Done! ✅

### Workflow 2: Image from Web
1. Right-click image on website
2. Click "Copy Image"
3. Click in editor
4. Press Ctrl+V
5. Done! ✅

### Workflow 3: Local File
1. Open file explorer
2. Find your image
3. Drag it to the editor
4. Drop it
5. Done! ✅

### Workflow 4: Design Tool
1. Export image from Photoshop/Figma/etc.
2. Click **🖼️ Image** button
3. Click **📤 Upload** tab
4. Click to browse
5. Select exported file
6. Done! ✅

## 🎨 Image Editing Tips

### Before Upload
- Crop to desired size
- Compress for web
- Add watermark if needed
- Convert to appropriate format

### After Upload
- Add descriptive alt text (accessibility!)
- Add caption if needed
- Choose appropriate width
- Preview before saving

## ⚠️ Important Notes

### Alt Text (Required for Accessibility)
Always add alt text that describes the image:
- ✅ Good: "Bar chart showing sales growth from 2020-2024"
- ❌ Bad: "image1.png"
- ❌ Bad: "chart"

### File Size Warning
Large images (>1MB) will:
- Slow down page loading
- Increase database size
- Use more bandwidth

**Solution**: Compress images before uploading using:
- TinyPNG (https://tinypng.com)
- Squoosh (https://squoosh.app)
- ImageOptim (Mac)
- RIOT (Windows)

### Base64 Limitations
Base64 images:
- Are ~33% larger than original
- Cannot be cached by browser
- Increase HTML size
- Are embedded in database

**Recommendation**: For images >500KB, use URL method instead

## 🐛 Troubleshooting

### "Image size must be less than 5MB"
**Solution**: Compress the image or use URL method

### "Failed to read image file"
**Solution**: 
- Check file is not corrupted
- Try different image format
- Try smaller file size

### Paste not working
**Solution**:
- Make sure you copied an image (not just the URL)
- Try right-click → Copy Image
- Check browser permissions

### Drag & drop not working
**Solution**:
- Make sure you're dragging an image file
- Drop directly on the editor area
- Try uploading via file picker instead

### Image not displaying
**Solution**:
- Check URL is accessible
- Check image format is supported
- Try re-uploading

## 📱 Mobile Support

### iOS (iPhone/iPad)
- ✅ Upload from Photos
- ✅ Take photo with camera
- ❌ Paste (limited support)
- ❌ Drag & drop (not supported)

### Android
- ✅ Upload from Gallery
- ✅ Take photo with camera
- ✅ Paste (some browsers)
- ❌ Drag & drop (limited)

**Recommendation**: Use upload button on mobile devices

## 🎓 Examples

### Example 1: Add Screenshot
```
1. Press Win+Shift+S (Windows) or Cmd+Shift+4 (Mac)
2. Select area to capture
3. Click in editor
4. Press Ctrl+V
5. Image appears automatically!
```

### Example 2: Add Logo
```
1. Click 🖼️ Image button
2. Click 📤 Upload tab
3. Click drop zone
4. Select logo.png
5. Alt text: "Company logo"
6. Width: 25%
7. Click "Add Image"
```

### Example 3: Add Diagram
```
1. Open diagram in browser
2. Right-click → Copy Image
3. Click in editor
4. Press Ctrl+V
5. Image added!
```

## 🚀 Quick Reference

| Method | Shortcut | Best For |
|--------|----------|----------|
| Paste in Editor | Ctrl+V | Screenshots, quick adds |
| Paste in Modal | Ctrl+V | When you need to set alt text first |
| Drag & Drop | Drag file | Local files |
| Upload Button | Click | Mobile, precise control |
| URL | Paste link | External images, CDN |

## 💾 Storage Comparison

| Method | Storage | Pros | Cons |
|--------|---------|------|------|
| URL | ~100 bytes | Small, fast | Requires internet |
| Base64 | ~133% of file | Offline, portable | Large database |

## 🎯 Recommendations

### For Small Images (<100KB)
- ✅ Use upload/paste (base64)
- Reason: Convenience, no external dependencies

### For Medium Images (100KB-500KB)
- ⚖️ Either method works
- Consider: How often will it be reused?

### For Large Images (>500KB)
- ✅ Use URL method
- Reason: Better performance, smaller database

### For Frequently Used Images
- ✅ Upload to CDN, use URL
- Reason: Reusability, caching

---

**Now you can add images in the most convenient way for your workflow!** 🎉
