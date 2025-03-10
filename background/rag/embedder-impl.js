// This file uses standard JS, not ES modules
class EmbedderImpl {
  constructor() {
    this.model = null;
    this.initialized = false;
    
    // Initialize immediately in constructor
    this.initialize();
  }
  
  initialize() {
    try {
      // Simple placeholder implementation
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
      this.initialized = false;
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

// Similarly create RAGComponentImpl here
class RAGComponentImpl {
  constructor() {
    this.initialized = false;
    this.documents = [];
    this.embeddings = [];
    
    // Initialize immediately in constructor
    this.initialize();
  }
  
  initialize() {
    try {
      // Initialize any resources needed for RAG
      this.initialized = true;
      return true;
    } catch (error) {
      console.error("RAG initialization failed:", error);
      this.initialized = false;
      return false;
    }
  }
  
  addDocument(text, embedding) {
    if (!this.initialized) {
      console.warn("RAG not initialized when adding document");
      return false;
    }
    
    this.documents.push(text);
    this.embeddings.push(embedding);
    return true;
  }
  
  findRelevantContext(queryEmbedding, maxResults = 3) {
    if (!this.initialized || this.embeddings.length === 0) {
      return [];
    }
    
    // Simple cosine similarity
    const similarities = this.embeddings.map(embedding => {
      return this.cosineSimilarity(queryEmbedding, embedding);
    });
    
    // Get indices of top similarities
    const indices = similarities
      .map((score, idx) => ({ score, idx }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(item => item.idx);
    
    // Return relevant documents
    return indices.map(idx => this.documents[idx]);
  }
  
  process(query, queryEmbedding) {
    if (!this.initialized) {
      throw new Error("RAG not initialized");
    }
    
    // Get relevant context
    const relevantContext = this.findRelevantContext(queryEmbedding);
    
    // Return the result (in a real implementation, this would pass to an LLM)
    return {
      query,
      relevantContext,
      result: "Processed with RAG: " + query
    };
  }
  
  // Cosine similarity helper
  cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

// Add these lines at the end of the file to make the classes available globally
const embedderImpl = new EmbedderImpl();
const ragComponentImpl = new RAGComponentImpl();

// Add this so they're accessible from the background script
self.embedderImpl = embedderImpl;
self.ragComponentImpl = ragComponentImpl; 