import { ChromaClient } from 'chromadb';

class VectorDB {
  constructor() {
    this.client = new ChromaClient();
    this.collection = null;
  }

  async initialize() {
    this.collection = await this.client.getOrCreateCollection({
      name: "content_embeddings",
      metadata: { "hnsw:space": "cosine" }
    });
  }

  async addDocuments(docs) {
    return this.collection.add({
      ids: docs.map((_, i) => `doc_${Date.now()}_${i}`),
      embeddings: docs.map(d => d.embedding),
      metadatas: docs.map(d => d.metadata),
      documents: docs.map(d => d.content)
    });
  }

  async query(queryEmbedding, nResults=5) {
    return this.collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults,
      include: ["metadatas", "documents", "distances"]
    });
  }
}

export const vectorDB = new VectorDB();
