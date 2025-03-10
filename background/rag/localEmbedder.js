// Initialize singleton instance
export const embedder = new LocalEmbedder();

export class LocalEmbedder {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    // Load local embedding model
    if (typeof window !== 'undefined' && window.TransformersJs) {
      this.model = await window.TransformersJs.from_pretrained('Xenova/all-MiniLM-L6-v2');
      this.initialized = true;
      return;
    }
    throw new Error('Local embedding model not available');
  }

  async generateEmbedding(text) {
    if (!this.initialized) throw new Error('Embedder not initialized');
    const output = await this.model(text);
    return Array.from(output.data);
  }
}
