---
name: gpt-image-streaming
description: Use an OpenAI-compatible synchronous streaming image API to generate or edit images with Responses API, including partial previews and multiple reference images.
metadata:
  short-description: Generate and edit images over a streaming API
---

# GPT Image Streaming

Use this skill when the user wants image generation or image editing through an OpenAI-compatible API that keeps one HTTP request open and streams previews before the final image.

## First-time configuration

Before making the first request, check whether this session already has a configured `Base URL` and `API Key`.

- If a `Base URL` already exists, show the full URL, including `/v1`, and ask whether to continue using it. If not, ask for a new `Base URL`.
- If an `API Key` already exists, ask whether to continue using the current API Key, but never display or echo its value. If not, ask for a new API Key.

- Ask only for values that are missing or that the user declines to reuse. Do not ask the user to paste an existing API Key again when they approve reuse.

Keep the key in an environment variable or an in-memory secret for the current session. Never place the key in a URL, source file, command history, log, screenshot, generated skill file, or commit.

After configuration, verify the URL and authentication with the requested image operation. Do not invent a provider-specific URL or silently switch to an asynchronous polling API.

## Default request

Prefer the Responses API because it supports both generation and editing through one public endpoint and streams partial images:

```text
POST {BASE_URL}/responses
Authorization: Bearer {API_KEY}
Content-Type: application/json
```

When the user does not specify an aspect ratio, default to portrait `3:4` at the 2K standard by using `1536x2048` and by adding the ratio requirement to the end of the prompt. For text-to-image, send:

```json
{
  "model": "gpt-5.5",
  "stream": true,
  "input": "描述图片内容。请严格按照 3:4 的画面比例生成图片。",
  "tools": [
    {
      "type": "image_generation",
      "action": "generate",
      "model": "gpt-image-2.5-sunburst",
      "size": "1536x2048",
      "quality": "auto",
      "output_format": "png",
      "partial_images": 2
    }
  ]
}
```

The outer `model` is the Responses text model. The image model is the `model` inside `image_generation`. Keep these roles separate. The public image model should be the model selected by the user, such as `gpt-image-2`, `gpt-image-2.5-sunburst`, or `gpt-image-2.5-flare`.

For transparent output, add `"background": "transparent"` to the image tool and prefer `output_format: "png"`.

## Editing with reference images

Use a Responses input array. Convert local reference files to data URLs or another format accepted by the gateway, and include one `input_image` item for each reference image. Unless the user specifies another ratio, keep the default 2K `3:4` size (`1536x2048`) and prompt requirement:

```json
{
  "model": "gpt-5.5",
  "stream": true,
  "input": [
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "保留主体，改成水彩画风。请严格按照 3:4 的画面比例生成图片。"
        },
        {
          "type": "input_image",
          "image_url": "data:image/png;base64,{REFERENCE_IMAGE_1}"
        },
        {
          "type": "input_image",
          "image_url": "data:image/png;base64,{REFERENCE_IMAGE_2}"
        }
      ]
    }
  ],
  "tools": [
    {
      "type": "image_generation",
      "action": "edit",
      "model": "gpt-image-2.5-sunburst",
      "size": "1536x2048",
      "quality": "auto",
      "output_format": "png",
      "partial_images": 2
    }
  ]
}
```

If a mask is required and the gateway supports it, add `input_image_mask` to the image tool with an accepted image URL. Do not concatenate multiple images into one string.

## Streaming protocol

Read the response as SSE until the final response is received. Do not stop after the first preview and do not impose a short request timeout: image generation can take several minutes.

- `response.image_generation_call.partial_image`: preview image. Read `partial_image_b64` and optionally `partial_image_index`.
- `response.output_item.added`: image generation started.
- `response.output_item.done`: an image generation call finished; inspect the item result.
- `response.completed`: final response snapshot. Read the `image_generation_call.result` from the output list.
- An event with an `error` object or a `*.failed` type is a failure and should be reported without exposing the API key.

Decode base64 image data using the requested output format. If the final response provides a URL instead, download it immediately when permitted by the API, then keep the resulting file locally because gateway URLs may expire.

## Prompt and parameters

- Always send `size`. The default is `1536x2048` (`3:4`, 2K); use another size only when the user selects another ratio or explicit dimensions.
- When no ratio is specified, put `请严格按照 3:4 的画面比例生成图片。` in the final sentence of `input` or `prompt`.
- When the user specifies another ratio, use the matching size and put that selected ratio in the final sentence instead.
- Avoid adding the ratio twice when the user prompt already contains a clear ratio requirement.
- Use `partial_images: 2` as the default preview count.
- Use `quality`, `output_format`, and `background` only when supported by the selected image model or gateway.
- Preserve the user-selected image model for each request; do not rewrite old task records when the user changes the current model.

## One-sentence setup instruction

When the user wants to configure another coding agent, provide this sentence:

> 请帮我配置并使用同步流式图片生成 API。如果已有 Base URL，请先显示当前 Base URL（包含 `/v1`）并询问是否继续使用；如果已有 API Key，请询问是否继续使用当前 API Key，但不要显示 Key 的具体内容。只有缺少或被拒绝复用时，才向我索取新的 Base URL 或 API Key；收到后仅用于本次会话，不要写入代码、URL、日志或提交到仓库。默认使用 Responses API 的 `/responses`，`stream=true`，默认按 `3:4` 比例生成，在 `image_generation` 工具中使用图片模型并设置 `partial_images=2`；生成或编辑时持续读取流式事件直到最终图片完成，编辑支持多张参考图片。请先验证配置，再开始生图。

## Operational boundary

This skill describes the public synchronous streaming API. Do not expose internal upstream names, account details, proxy topology, or implementation-specific service names to the end user. Do not replace the streaming request with a task-creation endpoint unless the user explicitly asks for asynchronous behavior.
