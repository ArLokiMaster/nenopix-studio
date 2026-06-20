import axios from "axios";
import FormData from "form-data";
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
    id: "stable-image-ultra",
    name: "Stable Image Ultra",
    description: "Highest quality, best for professional use",
    maxSize: "1024x1024",
    sizes: ["1024x1024", "1152x896", "1216x832", "1344x768", "1536x640"],
    costPerImage: "$0.08",
    recommended: true,
  },
  {
    id: "stable-image-core",
    name: "Stable Image Core",
    description: "Fast, affordable, high quality",
    maxSize: "1024x1024",
    sizes: ["1024x1024", "1152x896", "1216x832", "1344x768", "1536x640"],
    costPerImage: "$0.03",
  },
  {
    id: "sd3-large",
    name: "Stable Diffusion 3 Large",
    description: "Latest SD3 with improved prompt following",
    maxSize: "1024x1024",
    sizes: ["1024x1024"],
    costPerImage: "$0.065",
  },
  {
    id: "sd3-large-turbo",
    name: "Stable Diffusion 3 Large Turbo",
    description: "Faster SD3 with good quality",
    maxSize: "1024x1024",
    sizes: ["1024x1024"],
    costPerImage: "$0.04",
  },
];

export class StabilityProvider extends AbstractProvider {
  readonly id = "stability";
  readonly info: ProviderInfo = {
    id: "stability",
    name: "Stability AI",
    description: "Stable Diffusion 3, Stable Image Ultra — professional grade",
    website: "https://stability.ai",
    models: MODELS,
    status: "unconfigured",
    requiresApiKey: true,
    freetier: false,
    costPerImage: "$0.03–$0.08",
    features: [
      "text-to-image",
      "image-to-image",
      "inpainting",
      "upscaling",
      "negative-prompts",
      "seeds",
      "style-presets",
      "batch",
    ],
  };

  async isConfigured(): Promise<boolean> {
    return !!this.getApiKey("stability");
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const apiKey = this.getApiKey("stability");
    if (!apiKey) return { success: false, message: "API key not configured" };

    try {
      const res = await axios.get(
        "https://api.stability.ai/v1/user/balance",
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 10000,
        }
      );
      const credits = res.data?.credits?.toFixed(2) || "?";
      return { success: true, message: `Connected — ${credits} credits remaining` };
    } catch (err: any) {
      return {
        success: false,
        message: err.response?.data?.message || err.message,
      };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return MODELS;
  }

  private async getBalance(apiKey: string): Promise<number | null> {
    try {
      const res = await axios.get(
        "https://api.stability.ai/v1/user/balance",
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 10000,
        }
      );
      return typeof res.data?.credits === "number" ? res.data.credits : null;
    } catch {
      return null;
    }
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const startTime = Date.now();
    const apiKey = this.getApiKey("stability");
    if (!apiKey) {
      return this.errorResult(options, options.model || "stable-image-core", "Stability API key not configured", startTime);
    }

    const model = options.model || "stable-image-core";
    const prompt = options.enhancedPrompt || options.prompt;
    const count = options.count || 1;
    const images: GeneratedImage[] = [];

    const endpointMap: Record<string, string> = {
      "stable-image-ultra": "https://api.stability.ai/v2beta/stable-image/generate/ultra",
      "stable-image-core": "https://api.stability.ai/v2beta/stable-image/generate/core",
      "sd3-large": "https://api.stability.ai/v2beta/stable-image/generate/sd3",
      "sd3-large-turbo": "https://api.stability.ai/v2beta/stable-image/generate/sd3",
    };

    const endpoint = endpointMap[model] || endpointMap["stable-image-core"];

    const balanceBefore = await this.getBalance(apiKey);

    try {
      const ref = this.decodeImageInput(options.referenceImage);

      for (let i = 0; i < count; i++) {
        const form = new FormData();
        form.append("prompt", prompt);
        form.append("output_format", options.format || "png");

        if (options.negativePrompt) form.append("negative_prompt", options.negativePrompt);
        if (options.seed) form.append("seed", String(options.seed + i));
        if (options.style) form.append("style_preset", options.style);

        if (ref) {
          // Image-to-image: the init image dictates dimensions, so aspect_ratio
          // is omitted. `strength` controls how far the result moves from it.
          form.append("mode", "image-to-image");
          form.append("image", ref.buffer, { filename: "init.png", contentType: ref.mimeType });
          form.append("strength", String(options.cfgScale ?? 0.7));
        } else {
          form.append("aspect_ratio", this.sizeToAspect(options.size || "1024x1024"));
        }

        if (model.startsWith("sd3")) {
          form.append("model", model);
        }

        const res = await axios.post(endpoint, form, {
          headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
          },
          timeout: 120000,
        });

        const b64 = res.data?.image;
        if (!b64) throw new Error("No image data in response");

        const savedPath = await this.saveImage(b64, options, i, true);
        const { width, height } = this.parseSize(options.size || "1024x1024");

        images.push({
          id: this.makeImageId(),
          path: savedPath,
          base64: b64,
          width,
          height,
          format: options.format || "png",
          seed: res.data?.seed,
          metadata: { model, finishReason: res.data?.finish_reason },
        });
      }

      const balanceAfter = await this.getBalance(apiKey);

      const costMap: Record<string, number> = {
        "stable-image-ultra": 0.08,
        "stable-image-core": 0.03,
        "sd3-large": 0.065,
        "sd3-large-turbo": 0.04,
      };

      let cost = (costMap[model] || 0.03) * images.length;
      if (balanceBefore !== null && balanceAfter !== null) {
        const creditsDeducted = balanceBefore - balanceAfter;
        if (creditsDeducted > 0) {
          cost = creditsDeducted * 0.01;
        }
      }

      return this.buildResult(
        options, model, images, startTime, prompt, cost
      );
    } catch (err: any) {
      return this.errorResult(
        options, model,
        err.response?.data?.errors?.[0] || err.response?.data?.message || err.message,
        startTime
      );
    }
  }

  // Snap any W×H to the closest aspect ratio Stability v2beta accepts.
  private sizeToAspect(size: string): string {
    const [w, h] = size.split("x").map(Number);
    if (!w || !h) return "1:1";
    const supported: Array<[string, number]> = [
      ["21:9", 21 / 9], ["16:9", 16 / 9], ["3:2", 3 / 2], ["5:4", 5 / 4],
      ["1:1", 1], ["4:5", 4 / 5], ["2:3", 2 / 3], ["9:16", 9 / 16], ["9:21", 9 / 21],
    ];
    const target = w / h;
    return supported.reduce((best, cur) =>
      Math.abs(cur[1] - target) < Math.abs(best[1] - target) ? cur : best
    )[0];
  }
}
