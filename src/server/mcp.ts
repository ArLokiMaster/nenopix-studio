import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Nenopix } from "../sdk/index.js";

// Initialize Nenopix SDK
const forge = new Nenopix();

// Initialize the MCP server
const server = new Server(
  {
    name: "nenopix-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "generate_image",
        description: "Generate an image from a text prompt using unified AI providers (gemini, openai, stability, replicate, huggingface)",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "The description of the image to generate",
            },
            provider: {
              type: "string",
              description: "AI provider to use (gemini, openai, stability, replicate, huggingface)",
            },
            model: {
              type: "string",
              description: "Specific model to use (default: provider's default model)",
            },
            size: {
              type: "string",
              description: "Image size: 512x512, 1024x1024, 1792x1024, 1024x1792",
            },
            quality: {
              type: "string",
              description: "Quality level: draft | standard | hd | ultra",
            },
            style: {
              type: "string",
              description: "Style preset: photorealistic | cinematic | anime | concept | watercolor | 3d | minimal | dark",
            },
            enhance: {
              type: "boolean",
              description: "Enable AI prompt enhancement to expand the prompt for better quality (default: true)",
            },
          },
          required: ["prompt"],
        },
      },
      {
        name: "enhance_prompt",
        description: "Preview an AI-enhanced version of an image prompt to see how the AI expands it for better quality",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "The original simple prompt to enhance",
            },
            style: {
              type: "string",
              description: "Style preset to guide the enhancement",
            },
          },
          required: ["prompt"],
        },
      },
      {
        name: "list_providers",
        description: "List all available AI image providers, their configuration status, and supported models",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "generate_image") {
      const prompt = args?.prompt as string;
      const options = {
        provider: args?.provider as string,
        model: args?.model as string,
        size: args?.size as string,
        quality: args?.quality as any,
        style: args?.style as any,
        enhance: args?.enhance !== false,
      };

      const result = await forge.generate(prompt, options);

      if (!result.success) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to generate image: ${result.error || "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }

      const img = result.images[0];
      return {
        content: [
          {
            type: "text",
            text: `Image generated successfully!
File path: ${img.path}
Provider: ${result.provider} (Model: ${result.model})
Original Prompt: "${prompt}"
${result.enhancedPrompt ? `Enhanced Prompt: "${result.enhancedPrompt}"` : ""}
Duration: ${(result.duration / 1000).toFixed(2)}s`,
          },
        ],
      };
    }

    if (name === "enhance_prompt") {
      const prompt = args?.prompt as string;
      const style = args?.style as string;

      const result = await forge.enhance(prompt, { style: style as any });

      return {
        content: [
          {
            type: "text",
            text: `Original Prompt: "${result.original}"
Enhanced Prompt: "${result.enhanced}"
Style Keywords: ${result.styleKeywords.join(", ") || "none"}`,
          },
        ],
      };
    }

    if (name === "list_providers") {
      const providers = await forge.providers();
      const text = providers
        .map((p) => {
          const statusStr = p.status === "available" ? "Configured & Ready" : "Not Configured";
          const tierStr = p.freetier ? "Free Tier" : "Paid/Credits";
          return `- **${p.name}** (${p.id}): ${statusStr} [${tierStr}]
  Description: ${p.description}
  Models: ${p.models.map((m) => m.id).join(", ")}`;
        })
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `Available Nenopix Providers:\n\n${text}`,
          },
        ],
      };
    }

    throw new Error(`Tool not found: ${name}`);
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `Error executing tool "${name}": ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server using stdio transport
const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error("MCP Server connection error:", err);
  process.exit(1);
});
