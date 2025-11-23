#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile, writeFile } from "fs/promises";
import { extname } from "path";

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType: string;
          data: string;
        };
      }>;
    };
  }>;
  error?: {
    message: string;
  };
}

interface InputImage {
  data: string;
  mimeType: string;
}

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  return mimeTypes[ext] || 'image/png';
}

async function loadImageFromPath(filePath: string): Promise<InputImage> {
  const buffer = await readFile(filePath);
  const base64 = buffer.toString('base64');
  const mimeType = getMimeType(filePath);
  return { data: base64, mimeType };
}

const tools: Tool[] = [
  {
    name: "generate_image",
    description: "Generate an image using Google Nano Banana (Gemini) AI model. Can generate from text only, or use one or more reference images (up to 14) to guide generation.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Text description of the image to generate or instructions for editing/combining reference images",
        },
        imagePaths: {
          type: "array",
          items: {
            type: "string",
          },
          description: "Optional array of file paths to reference images (up to 14). Supports png, jpg, jpeg, webp, gif.",
        },
        model: {
          type: "string",
          enum: ["gemini-2.5-flash-image", "gemini-3-pro-image-preview"],
          default: "gemini-3-pro-image-preview",
          description: "Model to use: gemini-2.5-flash-image (fast) or gemini-3-pro-image-preview (high quality, default)",
        },
        aspectRatio: {
          type: "string",
          enum: ["1:1", "16:9", "9:16", "4:3", "3:4"],
          default: "1:1",
          description: "Aspect ratio of the generated image",
        },
        outputFormat: {
          type: "string",
          enum: ["png", "jpeg", "webp"],
          default: "png",
          description: "Output image format",
        },
        outputPath: {
          type: "string",
          description: "File path to save the generated image. If not provided, image data is returned inline.",
        },
      },
      required: ["prompt"],
    },
  },
];

export async function generateImage(
  prompt: string,
  images: InputImage[] = [],
  model: string = "gemini-3-pro-image-preview",
  aspectRatio: string = "1:1",
  outputFormat: string = "png"
): Promise<{ text?: string; imageData?: string; mimeType?: string; modelUsed?: string; fallback?: boolean }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set");
  }

  // Build parts array: text prompt first, then any images
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: prompt }
  ];

  for (const image of images) {
    parts.push({
      inlineData: {
        mimeType: image.mimeType || "image/png",
        data: image.data,
      },
    });
  }

  const makeRequest = async (currentModel: string) => {
    return fetch(
      `${GEMINI_API_URL}/${currentModel}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
          },
        }),
      }
    );
  };

  let response = await makeRequest(model);
  let usedModel = model;
  let didFallback = false;

  // If Pro model fails with quota/rate limit, fallback to Flash
  if (!response.ok && model === "gemini-3-pro-image-preview") {
    const status = response.status;
    if (status === 429 || status === 403 || status === 402) {
      usedModel = "gemini-2.5-flash-image";
      didFallback = true;
      response = await makeRequest(usedModel);
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data: GeminiResponse = await response.json();

  if (data.error) {
    throw new Error(`Gemini API error: ${data.error.message}`);
  }

  const responseParts = data.candidates?.[0]?.content?.parts;
  if (!responseParts || responseParts.length === 0) {
    throw new Error("No content generated");
  }

  const result: { text?: string; imageData?: string; mimeType?: string; modelUsed?: string; fallback?: boolean } = {
    modelUsed: usedModel,
    fallback: didFallback,
  };

  for (const part of responseParts) {
    if (part.text) {
      result.text = part.text;
    }
    if (part.inlineData) {
      result.imageData = part.inlineData.data;
      result.mimeType = part.inlineData.mimeType;
    }
  }

  return result;
}


const server = new Server(
  {
    name: "mcp-nano-banana",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "generate_image") {
      const { prompt, imagePaths, model, aspectRatio, outputFormat, outputPath } = args as {
        prompt: string;
        imagePaths?: string[];
        model?: string;
        aspectRatio?: string;
        outputFormat?: string;
        outputPath?: string;
      };

      // Load images from disk paths
      const images: InputImage[] = [];
      if (imagePaths && imagePaths.length > 0) {
        for (const path of imagePaths) {
          const image = await loadImageFromPath(path);
          images.push(image);
        }
      }

      const result = await generateImage(
        prompt,
        images,
        model,
        aspectRatio,
        outputFormat
      );

      const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [];

      // Report model used and fallback status
      let statusText = `Model used: ${result.modelUsed}`;
      if (result.fallback) {
        statusText += ` (fallback from gemini-3-pro-image-preview due to quota/rate limit)`;
      }

      if (result.text) {
        statusText += `\n\n${result.text}`;
      }

      content.push({ type: "text", text: statusText });

      if (result.imageData && result.mimeType) {
        // Save to file if outputPath provided
        if (outputPath) {
          await writeFile(outputPath, Buffer.from(result.imageData, 'base64'));
          content.push({ type: "text", text: `Image saved to: ${outputPath}` });
        } else {
          content.push({
            type: "image",
            data: result.imageData,
            mimeType: result.mimeType,
          });
        }
      }

      return { content };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Nano Banana MCP server running on stdio");
}

main().catch(console.error);
