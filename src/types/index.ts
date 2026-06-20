// ─── Core Types ──────────────────────────────────────────────────────────────

export type ImageSize =
  | "256x256"
  | "512x512"
  | "768x768"
  | "1024x1024"
  | "1280x720"
  | "1920x1080"
  | "1024x1792"
  | "1792x1024"
  | "2048x2048"
  | string;

export type ImageQuality = "draft" | "standard" | "hd" | "ultra";
export type ImageFormat = "png" | "jpg" | "webp";
export type ProviderStatus = "available" | "unconfigured" | "error" | "degraded";

// ─── Generation Options ───────────────────────────────────────────────────────

export interface GenerateOptions {
  prompt: string;
  enhancedPrompt?: string;
  provider?: string;
  model?: string;
  size?: ImageSize;
  quality?: ImageQuality;
  style?: string;
  count?: number;
  outputDir?: string;
  outputPrefix?: string;
  format?: ImageFormat;
  seed?: number;
  enhance?: boolean;
  referenceImage?: string;
  negativePrompt?: string;
  steps?: number;
  cfgScale?: number;
  json?: boolean;
  batch?: boolean;
}

export interface GenerateResult {
  success: boolean;
  images: GeneratedImage[];
  provider: string;
  model: string;
  prompt: string;
  enhancedPrompt?: string;
  duration: number;
  cost?: number;
  error?: string;
}

export interface GeneratedImage {
  id: string;
  path?: string;
  url?: string;
  base64?: string;
  width: number;
  height: number;
  format: ImageFormat;
  seed?: number;
  metadata: Record<string, unknown>;
}

// ─── Provider System ──────────────────────────────────────────────────────────

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  website: string;
  models: ModelInfo[];
  status: ProviderStatus;
  requiresApiKey: boolean;
  freetier: boolean;
  costPerImage?: string;
  features: ProviderFeature[];
}

export type ProviderFeature =
  | "text-to-image"
  | "image-to-image"
  | "inpainting"
  | "outpainting"
  | "upscaling"
  | "variations"
  | "editing"
  | "batch"
  | "streaming"
  | "seeds"
  | "negative-prompts"
  | "style-presets";

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  maxSize: ImageSize;
  sizes: ImageSize[];
  qualities?: ImageQuality[];
  styles?: string[];
  costPerImage?: string;
  recommended?: boolean;
}

// ─── Plugin System ────────────────────────────────────────────────────────────

export interface ImageForgePlugin {
  name: string;
  version: string;
  description: string;
  author: string;
  providers?: ProviderConstructor[];
  commands?: PluginCommand[];
  hooks?: PluginHooks;
}

export interface ProviderConstructor {
  id: string;
  factory: () => BaseProvider;
}

export interface PluginCommand {
  name: string;
  description: string;
  action: (args: string[], options: Record<string, unknown>) => Promise<void>;
}

export interface PluginHooks {
  beforeGenerate?: (options: GenerateOptions) => Promise<GenerateOptions>;
  afterGenerate?: (result: GenerateResult) => Promise<GenerateResult>;
  beforePromptEnhance?: (prompt: string) => Promise<string>;
  afterPromptEnhance?: (original: string, enhanced: string) => Promise<string>;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

export interface StoredCredentials {
  [providerId: string]: {
    apiKey?: string;
    baseUrl?: string;
    organization?: string;
    extras?: Record<string, string>;
    testedAt?: string;
    valid?: boolean;
  };
}

export interface AppConfig {
  defaultProvider: string;
  defaultModel: string;
  defaultSize: ImageSize;
  defaultQuality: ImageQuality;
  defaultFormat: ImageFormat;
  outputDir: string;
  enhancePrompts: boolean;
  enhanceProvider: string;
  jsonOutput: boolean;
  verbose: boolean;
  noBanner: boolean;
  setupComplete: boolean;
  installedPlugins: string[];
  version: string;
}

// ─── Prompt Enhancement ───────────────────────────────────────────────────────

export interface EnhancementOptions {
  targetProvider?: string;
  style?: string;
  quality?: ImageQuality;
}

export interface EnhancedPrompt {
  original: string;
  enhanced: string;
  suggestions: string[];
  styleKeywords: string[];
  qualityModifiers: string[];
}

// ─── Abstract Base ────────────────────────────────────────────────────────────

export abstract class BaseProvider {
  abstract readonly id: string;
  abstract readonly info: ProviderInfo;

  abstract isConfigured(): Promise<boolean>;
  abstract testConnection(): Promise<{ success: boolean; message: string }>;
  abstract generate(options: GenerateOptions): Promise<GenerateResult>;
  abstract listModels(): Promise<ModelInfo[]>;
}

// ─── SDK Types ────────────────────────────────────────────────────────────────

export interface ImageForgeSDKOptions {
  provider?: string;
  model?: string;
  apiKeys?: Record<string, string>;
  outputDir?: string;
  enhance?: boolean;
}

export interface BatchJob {
  id: string;
  prompts: string[];
  options: Omit<GenerateOptions, "prompt">;
  status: "pending" | "running" | "completed" | "failed";
  results: GenerateResult[];
  progress: number;
  startedAt?: Date;
  completedAt?: Date;
}
