import { DeepSeek } from '@deepseek/ai';
import * as sentenceTransformers from 'sentence-transformers';

class Embedder {
  constructor() {
    this.localModel = new sentenceTransformers.SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2');
  }

  async generateEmbedding(text) {
    try {
      // Get API key from extension settings
      const { encryptedDeepseekApiKey } = await new Promise(resolve => 
        chrome.storage.sync.get(['encryptedDeepseekApiKey'], resolve));

      // Decrypt API key using extension's encryption logic
      const apiKey = await this.decryptData(encryptedDeepseekApiKey);
      
      const deepseek = new DeepSeek(apiKey);
      const response = await deepseek.embeddings.create({
        input: text,
        model: 'deepseek-embedding-1.0'
      });
      return response.data[0].embedding;
    } catch (error) {
      console.warn('Deepseek API failed, using local model:', error);
      return this.localModel.encode(text);
    }
  }

  async decryptData(encryptedData) {
    if (!encryptedData) return '';
    try {
      // Simple base64 decode for unencrypted keys
      return atob(encryptedData);
    } catch (error) {
      console.error('API key decryption failed:', error);
      return '';
    }
  }
}

export const embedder = new Embedder();
