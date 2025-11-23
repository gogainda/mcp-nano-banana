# Building My First MCP Server: AI-Powered Image Generation with Gemini

## What is MCP?

MCP (Model Context Protocol) is a standardized way for AI assistants like Claude to interact with external tools and services. Think of it as a plugin system that allows Claude to extend its capabilities beyond just text generation. Instead of Claude being limited to answering questions, MCP lets it actually *do things* - run code, query databases, generate images, and more.

An MCP server exposes "tools" that Claude can call. Each tool has a defined schema (inputs/outputs), and Claude decides when and how to use them based on your requests.

## Why I Built This

I wanted Claude Code to generate and edit images directly in my workflow. Specifically, I needed the ability to:
- Generate images from text prompts
- Combine multiple images (like putting glasses on a face)
- Save results to specific file paths

Google's Gemini models have excellent image generation capabilities, so I built `mcp-nano-banana` - an MCP server that wraps the Gemini API.

## How to Build an MCP Server

### Project Structure

A typical MCP server project looks like this:

```
mcp-nano-banana/
├── src/
│   └── index.ts        # Main server code
├── dist/               # Compiled JavaScript (generated)
├── package.json
└── tsconfig.json
```

### Dependencies

You need the official MCP SDK:

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  }
}
```

### Basic Server Structure

Every MCP server follows this pattern:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// 1. Define your tools
const tools: Tool[] = [
  {
    name: "my_tool",
    description: "What this tool does",
    inputSchema: {
      type: "object",
      properties: {
        param1: { type: "string", description: "First parameter" },
        param2: { type: "number", description: "Second parameter" },
      },
      required: ["param1"],
    },
  },
];

// 2. Create the server
const server = new Server(
  {
    name: "my-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 3. Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// 4. Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "my_tool") {
    const { param1, param2 } = args as { param1: string; param2?: number };

    // Do your work here
    const result = await doSomething(param1, param2);

    return {
      content: [{ type: "text", text: result }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// 5. Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP server running on stdio");
}

main().catch(console.error);
```

### Tool Schema Conventions

Tool schemas follow JSON Schema format. Common patterns:

**String with enum (dropdown):**
```typescript
{
  type: "string",
  enum: ["option1", "option2", "option3"],
  default: "option1",
  description: "Select one option",
}
```

**Array of strings:**
```typescript
{
  type: "array",
  items: { type: "string" },
  description: "List of file paths",
}
```

**Optional vs Required:**
```typescript
inputSchema: {
  type: "object",
  properties: {
    required_param: { type: "string" },
    optional_param: { type: "string" },
  },
  required: ["required_param"],  // Only list required ones
}
```

### Response Content Types

MCP supports different content types in responses:

**Text response:**
```typescript
return {
  content: [{ type: "text", text: "Operation completed" }],
};
```

**Image response (inline base64):**
```typescript
return {
  content: [{
    type: "image",
    data: base64ImageData,
    mimeType: "image/png",
  }],
};
```

**Multiple content items:**
```typescript
return {
  content: [
    { type: "text", text: "Generated image:" },
    { type: "image", data: imageData, mimeType: "image/png" },
  ],
};
```

**Error response:**
```typescript
return {
  content: [{ type: "text", text: `Error: ${errorMessage}` }],
  isError: true,
};
```

### Registering with Claude Code

Add your MCP server to Claude Code's config (`~/.claude/claude_desktop_config.json`):

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

### Build and Run

```bash
# Build TypeScript
npm run build

# The server runs via stdio, so Claude Code starts it automatically
# For manual testing:
node dist/index.js
```

## The Development Journey

### Initial Setup

The basic structure was straightforward:
1. Define tools with JSON schemas for inputs
2. Handle tool calls and make API requests to Gemini
3. Return results back to Claude

```typescript
const tools: Tool[] = [
  {
    name: "generate_image",
    description: "Generate an image using Google Gemini AI model",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        imagePaths: { type: "array", items: { type: "string" } },
        // ...
      },
      required: ["prompt"],
    },
  },
];
```

### Exception #1: Rate Limiting (429 Errors)

**The Problem:** On Gemini's free tier, I kept hitting 429 (Too Many Requests) errors when making multiple calls.

**The Solution:** I implemented automatic fallback from the high-quality `gemini-3-pro-image-preview` model to the faster `gemini-2.5-flash-image` model when rate limits are hit:

```typescript
if (!response.ok && model === "gemini-3-pro-image-preview") {
  const status = response.status;
  if (status === 429 || status === 403 || status === 402) {
    usedModel = "gemini-2.5-flash-image";
    didFallback = true;
    response = await makeRequest(usedModel);
  }
}
```

This ensures generation always succeeds, even if with a different model.

### Exception #2: Missing Output Path

**The Problem:** The MCP tool could generate images, but Claude Code couldn't save them to disk. When I tried to use `outputPath`, the file wasn't being saved - it was still returning the image inline.

**The Symptom:**
```
Model used: gemini-3-pro-image-preview
[Image]
```

But checking the file showed an old timestamp - it wasn't updated.

**The Root Cause:** I had added the `outputPath` parameter to the schema and handler, but forgot to rebuild the TypeScript before restarting the MCP server. The running server was using old compiled JavaScript.

**The Fix:** Always run `npm run build` after code changes, then restart the MCP connection.

### Exception #3: Image Not Updating

**The Problem:** Even after implementing `outputPath`, the generated images weren't being saved.

**The Investigation:** The response showed `[Image]` which meant it was returning inline data, not saving to file. This indicated the `outputPath` condition wasn't being triggered.

**The Solution:** Ensure the parameter is properly destructured and passed through:

```typescript
const { prompt, imagePaths, model, aspectRatio, outputFormat, outputPath } = args as {
  prompt: string;
  imagePaths?: string[];
  model?: string;
  aspectRatio?: string;
  outputFormat?: string;
  outputPath?: string;  // Don't forget this!
};

// Later in the handler:
if (outputPath) {
  await writeFile(outputPath, Buffer.from(result.imageData, 'base64'));
  content.push({ type: "text", text: `Image saved to: ${outputPath}` });
}
```

## Key Lessons Learned

1. **Always rebuild after TypeScript changes** - The MCP server runs compiled JS, not TS directly

2. **Handle API rate limits gracefully** - Free tiers have strict limits; implement fallbacks

3. **Test with actual Claude Code integration** - Unit tests aren't enough; the real MCP protocol has nuances

4. **Add file output options** - Claude Code works better with file paths than inline binary data

5. **Default to the better model** - Users can always downgrade, but defaulting to quality (`gemini-3-pro-image-preview`) provides better first impressions

## Final Architecture

```
Claude Code
    ↓ (MCP Protocol)
mcp-nano-banana server
    ↓ (HTTPS)
Gemini API
    ↓
Generated Image → saved to outputPath
```

## What's Next

- Add retry logic with exponential backoff for transient failures
- Support more Gemini models as they're released
- Add image editing capabilities (inpainting, outpainting)
- Implement batch processing for multiple generations

---

Building an MCP server is surprisingly straightforward once you understand the protocol. The main challenges are handling real-world API issues like rate limiting and ensuring the tool parameters are properly wired through the entire call chain. Start simple, test with real usage, and iterate.
