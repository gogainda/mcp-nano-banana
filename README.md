# mcp-nano-banana

MCP server for AI-powered image generation using Google Gemini models. Generate images from text prompts or combine multiple reference images.

## Features

- Text-to-image generation
- Multi-image combination (up to 14 reference images)
- Automatic fallback from Pro to Flash model on rate limits
- Save output to file or return inline
- Support for multiple aspect ratios and output formats

## Installation

```bash
npm install
npm run build
```

## Configuration

### Environment Variable

Set your Gemini API key:

```bash
export GEMINI_API_KEY=your-api-key
```

Get an API key at: https://aistudio.google.com/apikey

### Claude Code Setup

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nano-banana": {
      "command": "node",
      "args": ["/path/to/mcp-nano-banana/dist/index.js"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Usage

### Tool: `generate_image`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | - | Text description or editing instructions |
| `imagePaths` | string[] | No | - | Reference image paths (up to 14) |
| `model` | string | No | `gemini-3-pro-image-preview` | Model to use |
| `aspectRatio` | string | No | `1:1` | `1:1`, `16:9`, `9:16`, `4:3`, `3:4` |
| `outputFormat` | string | No | `png` | `png`, `jpeg`, `webp` |
| `outputPath` | string | No | - | Save image to this path |

### Examples

**Generate from text:**
```
prompt: "A sunset over mountains"
outputPath: "/path/to/output.png"
```

**Combine images:**
```
prompt: "Put these glasses on this person's face"
imagePaths: ["/path/to/face.jpg", "/path/to/glasses.jpg"]
outputPath: "/path/to/result.png"
```

## Models

- `gemini-3-pro-image-preview` - High quality (default)
- `gemini-2.5-flash-image` - Fast generation

The server automatically falls back to Flash if Pro hits rate limits (429/403/402 errors).

## Development

```bash
# Build
npm run build

# Test
npm test

# Run directly
node dist/index.js
```

## Blog Post

Read about the development of this project: https://igorstechnoclub.com/mcp-nano-banana/

## License

MIT
