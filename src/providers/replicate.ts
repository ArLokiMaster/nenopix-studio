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
    id: "black-forest-labs/flux-schnell",
    name: "FLUX Schnell",
    description: "Fastest Flux model — great for prototyping",
    maxSize: "1024x1024",
    sizes: ["512x512", "768x768", "1024x1024"],
    costPerImage: "~$0.003",
    recommended: true,
  },
  {
    id: "black-forest-labs/flux-dev",
    name: "FLUX Dev",
    description: "High quality Flux with more steps",
    maxSize: "1024x1024",
    sizes: ["512x512", "768x768", "1024x1024"],
    costPerImage: "~$0.025",
  },
  {
    id: "black-forest-labs/flux-pro",
    name: "FLUX Pro",
    description: "Professional quality Flux model",
    maxSize: "1024x1024",
    sizes: ["512x512", "1024x1024"],
    costPerImage: "~$0.055",
  },
  {
    id: "stability-ai/sdxl",
    name: "Stable Diffusion XL",
    description: "High quality open-source image generation",
    maxSize: "1024x1024",
    sizes: ["768x768", "1024x1024"],
    costPerImage: "~$0.0023",
  },
  {
    id: "ideogram-ai/ideogram-v2",
    name: "Ideogram V2",
    description: "Excellent text rendering in images",
    maxSize: "1024x1024",
    sizes: ["1024x1024"],
    costPerImage: "~$0.08",
  },
];

const REPLICATE_BASE = "https://api.replicate.com/v1";

export class ReplicateProvider extends AbstractProvider {
  readonly id = "replicate";
  readonly info: ProviderInfo = {
    id: "replicate",
    name: "Replicate",
    description: "FLUX, SDXL, Ideogram — run any open-source model",
    website: "https://replicate.com",
    models: MODELS,
    status: "unconfigured",
    requiresApiKey: true,
    freetier: false,
    costPerImage: "$0.003–$0.08",
    features: [
      "text-to-image",
      "image-to-image",
      "upscaling",
      "negative-prompts",
      "seeds",
      "batch",
    ],
  };

  async isConfigured(): Promise<boolean> {
    return !!this.getApiKey("replicate");
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const apiKey = this.getApiKey("replicate");
    if (!apiKey) return { success: false, message: "API key not configured" };

    try {
      await axios.get(`${REPLICATE_BASE}/account`, {
        headers: { Authorization: `Token ${apiKey}` },
        timeout: 10000,
      });
      return { success: true, message: "Connected to Replicate API" };
    } catch (err: any) {
      return {
        success: false,
        message: err.response?.data?.detail || err.message,
      };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return MODELS;
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const startTime = Date.now();
    const apiKey = this.getApiKey("replicate");
    if (!apiKey) {
      return this.errorResult(options, options.model || MODELS[0].id, "Replicate API key not configured", startTime);
    }

    const model = options.model || "black-forest-labs/flux-schnell";
    const prompt = options.enhancedPrompt || options.prompt;
    const count = options.count || 1;

    try {
      const input = this.buildInput(model, options, prompt, count);

      // Create prediction
      const createRes = await axios.post(
        `${REPLICATE_BASE}/predictions`,
        { version: await this.resolveVersion(model, apiKey), input },
        {
          headers: {
            Authorization: `Token ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 30000,
        }
      );

      const predictionId = createRes.data.id;
      if (!predictionId) throw new Error("No prediction ID returned");

      // Poll for completion
      const outputUrls = await this.pollPrediction(predictionId, apiKey);
      const images: GeneratedImage[] = [];
      const { width, height } = this.parseSize(options.size || "1024x1024");

      for (let i = 0; i < outputUrls.length; i++) {
        const buffer = await this.downloadImage(outputUrls[i]);
        const savedPath = await this.saveImage(buffer, options, i);

        images.push({
          id: this.makeImageId(),
          path: savedPath,
          url: outputUrls[i],
          width,
          height,
          format: options.format || "png",
          metadata: { model, predictionId },
        });
      }

      const costMap: Record<string, number> = {
        "black-forest-labs/flux-schnell": 0.003,
        "black-forest-labs/flux-dev": 0.025,
        "black-forest-labs/flux-pro": 0.055,
        "stability-ai/sdxl": 0.0023,
        "ideogram-ai/ideogram-v2": 0.08,
      };

      const cost = (costMap[model] || 0.003) * images.length;

      return this.buildResult(options, model, images, startTime, prompt, cost);
    } catch (err: any) {
      return this.errorResult(
        options, model,
        err.response?.data?.detail || err.message,
        startTime
      );
    }
  }

  private buildInput(
    model: string,
    options: GenerateOptions,
    prompt: string,
    count: number
  ): Record<string, unknown> {
    const base: Record<string, unknown> = { prompt, num_outputs: count };

    if (model.includes("flux")) {
      const size = options.size || "1024x1024";
      const [w, h] = size.split("x").map(Number);
      base.width = w || 1024;
      base.height = h || 1024;
      if (options.seed) base.seed = options.seed;
    } else if (model.includes("sdxl")) {
      if (options.negativePrompt) base.negative_prompt = options.negativePrompt;
      if (options.seed) base.seed = options.seed;
      base.width = 1024;
      base.height = 1024;
    }

    return base;
  }

  private async resolveVersion(model: string, apiKey: string): Promise<string | undefined> {
    // If model includes a version hash, use it directly
    if (model.includes(":")) return model.split(":")[1];

    try {
      const [owner, name] = model.split("/");
      const res = await axios.get(
        `${REPLICATE_BASE}/models/${owner}/${name}`,
        { headers: { Authorization: `Token ${apiKey}` }, timeout: 10000 }
      );
      return res.data?.latest_version?.id;
    } catch {
      return undefined;
    }
  }

  private async pollPrediction(id: string, apiKey: string): Promise<string[]> {
    const maxAttempts = 60;
    const pollInterval = 2000;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, pollInterval));

      const res = await axios.get(`${REPLICATE_BASE}/predictions/${id}`, {
        headers: { Authorization: `Token ${apiKey}` },
        timeout: 15000,
      });

      const { status, output, error } = res.data;

      if (status === "succeeded") {
        const urls = Array.isArray(output) ? output : [output];
        return urls.filter(Boolean);
      }

      if (status === "failed" || status === "canceled") {
        throw new Error(error || `Prediction ${status}`);
      }
    }

    throw new Error("Prediction timed out after 120 seconds");
  }
}
