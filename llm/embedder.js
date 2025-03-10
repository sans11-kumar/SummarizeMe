// Embedder class for text embedding functionality
class Embedder {
  constructor() {
    this.model = null;
    this.initialized = false;
  }
  
  async initialize() {
    try {
      // Simple placeholder embedding model that returns random vectors
      // In production, use a proper embedding model
      this.model = {
        embed: (text) => {
          // Create a simple deterministic vector based on text content
          const vector = new Array(384).fill(0);
          for (let i = 0; i < Math.min(text.length, 384); i++) {
            vector[i] = text.charCodeAt(i % text.length) / 255;
          }
          return vector;
        }
      };
      this.initialized = true;
      return true;
    } catch (error) {
      console.error("Embedder initialization failed:", error);
      return false;
    }
  }
  
  embed(text) {
    if (!this.initialized) {
      throw new Error("Embedder not initialized");
    }
    
    try {
      return this.model.embed(text);
    } catch (error) {
      console.error("Embedding error:", error);
      throw new Error("Failed to generate embedding");
    }
  }
}

// Make it available globally for importScripts
self.Embedder = Embedder;

// Also support ES modules
try {
  if (typeof module !== 'undefined') {
    module.exports = { Embedder };
  }
} catch (e) {
  // Ignore if not in a module context
} 