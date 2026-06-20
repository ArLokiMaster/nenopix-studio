import axios from "axios";
import {
  ProviderInfo,
  ModelInfo,
  GenerateOptions,
  GenerateResult,
  GeneratedImage,
} from "../types/index.js";
import { AbstractProvider } from "./base.js";

const MODELS: ModelInfo[] = [
  {
    id: "dall-e-3",
    name: "DALL·E 3",
    description: "High-quality image generation with prompt adherence",
    maxSize: "1792x1024",
    sizes: ["1024x1024", "1024x1792", "1792x1024"],
    qualities: ["standard", "hd"],
    styles: ["vivid", "natural"],
    costPerImage: "$0.04–$0.12",
    recommended: true,
  },
  {
    id: "dall-e-2",
    name: "DALL·E 2",
    description: "Reliable image generation, supports variations & edits",
    maxSize: "1024x1024",
    sizes: ["256x256", "512x512", "1024x1024"],
    costPerImage: "$0.016–$0.02",
  },
];

export class OpenAIProvider extends AbstractProvider {
  readonly id = "openai";
  readonly info: ProviderInfo = {
    id: "openai",
    name: "OpenAI",
    description: "DALL·E 3, GPT Image 1 — world-class image generation",
    website: "https://platform.openai.com",
    models: MODELS,
    status: "unconfigured",
    requiresApiKey: true,
    freetier: false,
    costPerImage: "$0.016–$0.19",
    features: [
      "text-to-image",
      "image-to-image",
      "inpainting",
      "variations",
      "editing",
      "batch",
    ],
  };

  async isConfigured(): Promise<boolean> {
    return !!this.getApiKey("openai");
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const apiKey = this.getApiKey("openai");
    if (!apiKey) return { success: false, message: "API key not configured" };

    try {
      await axios.get("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 10000,
      });
      return { success: true, message: "Connected to OpenAI API" };
    } catch (err: any) {
      return {
        success: false,
        message: err.response?.data?.error?.message || err.message,
      };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return MODELS;
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const startTime = Date.now();
    const apiKey = this.getApiKey("openai");
    if (!apiKey) {
      return this.errorResult(options, options.model || "dall-e-3", "OpenAI API key not configured", startTime);
    }

    const model = options.model || "dall-e-3";
    const prompt = options.enhancedPrompt || options.prompt;
    const count = Math.min(options.count || 1, model === "dall-e-3" ? 1 : 10);
    const size = (options.size || "1024x1024") as "256x256" | "512x512" | "1024x1024" | "1792x1024" | "1024x1792";
    const quality = options.quality === "hd" ? "hd" : "standard";

    try {
      const payload: Record<string, unknown> = {
        model,
        prompt,
        n: count,
        size,
        response_format: "b64_json",
      };

      if (model === "dall-e-3") {
        payload.quality = quality;
        if (options.style) payload.style = options.style;
      }

      const res = await axios.post(
        "https://api.openai.com/v1/images/generations",
        payload,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 120000,
        }
      );

      const images: GeneratedImage[] = [];
      const { width, height } = this.parseSize(size);

      for (let i = 0; i < res.data.data.length; i++) {
        const item = res.data.data[i];
        const savedPath = await this.saveImage(item.b64_json, options, i, true);

        images.push({
          id: this.makeImageId(),
          path: savedPath,
          base64: item.b64_json,
          width,
          height,
          format: options.format || "png",
          metadata: { revisedPrompt: item.revised_prompt },
        });
      }

      const costMap: Record<string, number> = {
        "dall-e-3": quality === "hd" ? 0.12 : 0.04,
        "dall-e-2": size === "1024x1024" ? 0.02 : 0.016,
      };

      return this.buildResult(
        options,
        model,
        images,
        startTime,
        prompt,
        (costMap[model] || 0.04) * images.length
      );
    } catch (err: any) {
      return this.errorResult(
        options,
        model,
        err.response?.data?.error?.message || err.message,
        startTime
      );
    }
  }
}
