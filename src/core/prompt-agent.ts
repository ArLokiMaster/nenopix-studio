import axios from "axios";
import { EnhancedPrompt, EnhancementOptions } from "../types/index.js";
import { credentialStore } from "../storage/credentials.js";
import { config } from "../storage/config.js";

// ─── Rule-based Enhancement ───────────────────────────────────────────────────

const QUALITY_MODIFIERS = [
  "highly detailed",
  "professional",
  "8k resolution",
  "sharp focus",
  "masterpiece",
  "ultra-realistic",
];

const STYLE_PRESETS: Record<string, string[]> = {
  photorealistic: [
    "photorealistic",
    "DSLR",
    "natural lighting",
    "shallow depth of field",
    "RAW photo",
  ],
  cinematic: [
    "cinematic",
    "movie still",
    "dramatic lighting",
    "anamorphic lens",
    "film grain",
  ],
  anime: [
    "anime style",
    "vibrant colors",
    "clean linework",
    "studio quality",
    "detailed illustration",
  ],
  concept: [
    "concept art",
    "digital painting",
    "trending on ArtStation",
    "by Greg Rutkowski",
    "detailed",
  ],
  watercolor: [
    "watercolor painting",
    "soft edges",
    "flowing colors",
    "traditional media",
    "artistic",
  ],
  "3d": [
    "3D render",
    "octane render",
    "ray tracing",
    "ambient occlusion",
    "subsurface scattering",
  ],
  minimal: ["minimalist", "clean", "simple", "white background", "vector-style"],
  dark: [
    "dark fantasy",
    "moody atmosphere",
    "low key lighting",
    "dramatic shadows",
    "noir",
  ],
};

const PROVIDER_HINTS: Record<string, string> = {
  openai: "high quality, detailed",
  gemini: "vibrant, colorful, detailed",
  stability: "highly detailed, 8k, professional photography",
  replicate: "masterpiece, best quality, highly detailed",
  huggingface: "best quality, masterpiece, sharp, detailed",
};

function enhanceRuleBased(
  prompt: string,
  options: EnhancementOptions
): EnhancedPrompt {
  const styleKeywords: string[] = [];
  const qualityModifiers: string[] = [];

  // Detect existing quality keywords — don't add if already present
  const hasQuality =
    QUALITY_MODIFIERS.some((q) => prompt.toLowerCase().includes(q)) ||
    /\b(hd|4k|8k|high quality|detailed)\b/i.test(prompt);

  // Apply style preset
  if (options.style && STYLE_PRESETS[options.style]) {
    styleKeywords.push(...STYLE_PRESETS[options.style]);
  }

  // Add quality modifiers if not already present
  if (!hasQuality && options.quality !== "draft") {
    if (options.quality === "hd" || options.quality === "ultra") {
      qualityModifiers.push("highly detailed", "8k resolution", "masterpiece");
    } else {
      qualityModifiers.push("highly detailed", "professional");
    }
  }

  // Provider-specific hint
  const providerHint = options.targetProvider
    ? PROVIDER_HINTS[options.targetProvider]
    : undefined;

  const parts = [prompt];
  if (styleKeywords.length) parts.push(styleKeywords.slice(0, 3).join(", "));
  if (qualityModifiers.length) parts.push(qualityModifiers.slice(0, 2).join(", "));
  if (providerHint && !hasQuality) parts.push(providerHint);

  const enhanced = parts.join(", ");

  return {
    original: prompt,
    enhanced,
    suggestions: [
      ...STYLE_PRESETS["photorealistic"].slice(0, 2),
      ...STYLE_PRESETS["cinematic"].slice(0, 2),
    ],
    styleKeywords,
    qualityModifiers,
  };
}

// ─── AI-Powered Enhancement via OpenAI/Gemini ─────────────────────────────────

async function enhanceWithAI(
  prompt: string,
  options: EnhancementOptions
): Promise<EnhancedPrompt> {
  const enhanceProvider = config.get("enhanceProvider");
  const openaiKey = credentialStore.get("openai")?.apiKey;
  const geminiKey = credentialStore.get("gemini")?.apiKey;

  const systemPrompt = `You are an expert AI image generation prompt engineer.
Your job is to enhance user prompts for better image generation results.
Rules:
- Keep the core subject/idea intact
- Add technical quality keywords (lighting, composition, style)
- Keep it concise — under 150 words
- Adapt to the target provider if specified
- Return ONLY the enhanced prompt, no explanations`;

  const userMsg = `Enhance this image prompt${options.targetProvider ? ` for ${options.targetProvider}` : ""}${options.style ? ` in ${options.style} style` : ""}:\n\n"${prompt}"`;

  try {
    if ((enhanceProvider === "openai" || !geminiKey) && openaiKey) {
      const res = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMsg },
          ],
          max_tokens: 200,
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 15000,
        }
      );
      const enhanced = res.data.choices[0]?.message?.content?.trim() || prompt;
      return {
        original: prompt,
        enhanced,
        suggestions: [],
        styleKeywords: [],
        qualityModifiers: [],
      };
    }

    if (geminiKey) {
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiKey}`,
        {
          contents: [{ parts: [{ text: `${systemPrompt}\n\n${userMsg}` }] }],
          generationConfig: { maxOutputTokens: 200, temperature: 0.7 },
        },
        { timeout: 15000 }
      );
      const enhanced =
        res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || prompt;
      return {
        original: prompt,
        enhanced,
        suggestions: [],
        styleKeywords: [],
        qualityModifiers: [],
      };
    }
  } catch {
    // Fall through to rule-based
  }

  return enhanceRuleBased(prompt, options);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class PromptAgent {
  async enhance(
    prompt: string,
    options: EnhancementOptions = {}
  ): Promise<EnhancedPrompt> {
    const enhanceProvider = config.get("enhanceProvider");

    if (enhanceProvider === "rule-based") {
      return enhanceRuleBased(prompt, options);
    }

    return enhanceWithAI(prompt, options);
  }

  getStylePresets(): string[] {
    return Object.keys(STYLE_PRESETS);
  }

  getStyleKeywords(style: string): string[] {
    return STYLE_PRESETS[style] || [];
  }
}

export const promptAgent = new PromptAgent();
