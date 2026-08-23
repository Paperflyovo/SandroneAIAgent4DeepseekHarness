---
name: sandrone-image-preview
description: Find and display images directly in Sandrone Harness answers. Use automatically for requests such as 找图、看图、预览图片、展示头像、贴出截图、在回答中带图片, or when the user asks to find, show, preview, embed, post, or send a local or remote visual; the user does not need to specify Markdown syntax.
metadata:
  short-description: Preview local and remote images in answers
---

# Sandrone Image Preview

When the user wants to see an image, treat rendering it in the answer as part of the requested result. Do not stop after reporting a file path, and do not ask the user to provide a Markdown format.

## Produce The Preview

1. Locate the real image file or verified remote image URL using the relevant workspace, database, search result, or tool output.
2. Prefer an existing original image. Do not convert WebP, PNG, JPEG, GIF, SVG, AVIF, or other supported images merely to make a preview.
3. For a local image, resolve its absolute path and emit one Markdown image token: start with an exclamation mark; put concise alt text inside square brackets; immediately follow it with parentheses; inside the parentheses, wrap the absolute local path in angle brackets. Do not add spaces between these Markdown parts.

4. For a remote image, use the verified direct HTTP(S) image URL:

   ```markdown
   ![concise descriptive alt text](https://example.com/image.webp)
   ```

5. Keep the preview near the sentence that introduces it. Add the original path or source link only when it helps the user locate, reuse, or verify the image.

## Boundaries

- Never invent a path or URL. Confirm that a local file exists; derive remote URLs from real source data and verify them when practical.
- Use angle brackets around Windows absolute paths so spaces, Chinese characters, backslashes, and parentheses remain one Markdown destination.
- Displaying an image is independent of whether the selected model can understand image content. Do not refuse to render a found image merely because the model lacks vision.
- Do not claim to recognize or analyze image contents unless the image was actually available to the model. Use known metadata for alt text when visual inspection is unavailable.
- If no usable image can be found, say what was searched and what is missing instead of outputting a guessed placeholder.

## Typical Intent

Apply this behavior to natural requests such as “找一下这个角色的图片”, “给我看看头像”, “把结果里的图片贴出来”, “预览这张本地截图”, or “回答时带上图片”. The user should not need to repeat the rendering syntax.
