/**
 * ImageForge Example Plugin
 * This demonstrates how to create a custom provider plugin.
 *
 * To create your own plugin:
 * 1. Copy this file
 * 2. Implement the BaseProvider interface
 * 3. Publish to npm as "imageforge-plugin-<your-name>"
 * 4. Install with: imageforge plugin install imageforge-plugin-<your-name>
 */

class ExampleCustomProvider {
  constructor() {
    this.id = "example-custom";
    this.info = {
      id: "example-custom",
      name: "Example Custom Provider",
      description: "A demonstration provider that returns placeholder images",
      website: "https://example.com",
      models: [
        {
          id: "example-model-v1",
          name: "Example Model",
          description: "Placeholder image generator",
          maxSize: "1024x1024",
          sizes: ["512x512", "1024x1024"],
          costPerImage: "Free",
          recommended: true,
        },
      ],
      status: "available",
      requiresApiKey: false,
      freetier: true,
      features: ["text-to-image"],
    };
  }

  async isConfigured() {
    return true; // No API key required for this example
  }

  async testConnection() {
    return { success: true, message: "Example provider always available" };
  }

  async listModels() {
    return this.info.models;
  }

  async generate(options) {
    const startTime = Date.now();

    // In a real plugin, you would call your API here
    // This example just returns a placeholder
    return {
      success: true,
      images: [
        {
          id: `example-${Date.now()}`,
          url: `https://via.placeholder.com/1024x1024.png?text=${encodeURIComponent(options.prompt.substring(0, 50))}`,
          width: 1024,
          height: 1024,
          format: "png",
          metadata: { placeholder: true },
        },
      ],
      provider: this.id,
      model: options.model || "example-model-v1",
      prompt: options.prompt,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Plugin manifest — this is what ImageForge reads when loading your plugin
 */
const plugin = {
  name: "imageforge-plugin-example",
  version: "1.0.0",
  description: "Example plugin demonstrating the ImageForge plugin API",
  author: "Your Name",

  // Register custom providers
  providers: [
    {
      id: "example-custom",
      factory: () => new ExampleCustomProvider(),
    },
  ],

  // Optional: add hooks that run before/after generation
  hooks: {
    async beforeGenerate(options) {
      // Modify options before generation
      // e.g., add a watermark text to prompt
      return options;
    },

    async afterGenerate(result) {
      // Process result after generation
      // e.g., auto-upload to S3
      return result;
    },

    async beforePromptEnhance(prompt) {
      // Modify prompt before enhancement
      return prompt;
    },

    async afterPromptEnhance(original, enhanced) {
      // Modify enhanced prompt
      return enhanced;
    },
  },
};

module.exports = plugin;
module.exports.default = plugin;
