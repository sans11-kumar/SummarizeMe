// At the top of the file, use importScripts instead
importScripts('./embedder.js', './rag.js', './llm_processor.js');

// And then reference the classes directly (assuming they're exposed globally in those files)
const embedder = new Embedder();
const ragComponent = new RAGComponent();
const llmProcessor = new LLMProcessor();

// Add this at the top of the file after the imports
let localLlmStatus = { available: false };

// Initialize components
async function initializeComponents() {
  try {
    await embedder.initialize();
    await ragComponent.initialize();
    await llmProcessor.initialize();
    return true;
  } catch (error) {
    console.error("Failed to initialize components:", error);
    return false;
  }
}

// Replace these chrome.runtime.onMessage listeners with self.onmessage
// Remove this
// chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
//   if (message.action === "init" && message.localLlmStatus) {
//     // Store LLM status with enhanced information
//     localLlmStatus = message.localLlmStatus;
//     console.log("Worker received LLM status:", localLlmStatus);
//     
//     // Log more details if available
//     if (localLlmStatus.models && localLlmStatus.models.length > 0) {
//       console.log("Available models:", localLlmStatus.models.map(m => m.id || m.name).join(', '));
//     }
//     if (localLlmStatus.activeModel) {
//       console.log("Active model:", localLlmStatus.activeModel.id || localLlmStatus.activeModel.name);
//     }
//   }
//   else if (message.target === "llm_worker" && message.action === "summarize") {
//     try {
//       // Check if local LLM is available when using that provider
//       const settings = message.settings || {};
//       if (settings.summarizerType === 'local' && !localLlmStatus.available) {
//         chrome.runtime.sendMessage({
//           action: "summarization_error",
//           error: `LM Studio is not available: ${localLlmStatus.error || 'Connection failed'}`
//         });
//         return;
//       }
//       
//       const result = await summarizeContent(message.content);
//       chrome.runtime.sendMessage({
//         action: "summarization_result",
//         result: result
//       });
//     } catch (error) {
//       chrome.runtime.sendMessage({
//         action: "summarization_error",
//         error: error.message
//       });
//     }
//   }
//   return true;
// });

// Add this instead
self.onmessage = async function(event) {
  const message = event.data;
  
  if (message.action === "init" && message.localLlmStatus) {
    // Store LLM status with enhanced information
    localLlmStatus = message.localLlmStatus;
    console.log("Worker received LLM status:", localLlmStatus);
    
    // Log more details if available
    if (localLlmStatus.models && localLlmStatus.models.length > 0) {
      console.log("Available models:", localLlmStatus.models.map(m => m.id || m.name).join(', '));
    }
    if (localLlmStatus.activeModel) {
      console.log("Active model:", localLlmStatus.activeModel.id || localLlmStatus.activeModel.name);
    }
  }
  else if (message.target === "llm_worker" && message.action === "summarize") {
    try {
      // Check if local LLM is available when using that provider
      const settings = message.settings || {};
      if (settings.summarizerType === 'local' && !localLlmStatus.available) {
        self.postMessage({
          action: "summarization_error",
          error: `LM Studio is not available: ${localLlmStatus.error || 'Connection failed'}`
        });
        return;
      }
      
      const result = await summarizeContent(message.content);
      self.postMessage({
        action: "summarization_result",
        result: result
      });
    } catch (error) {
      self.postMessage({
        action: "summarization_error",
        error: error.message
      });
    }
  }
};

// Summarize content
async function summarizeContent(content) {
  try {
    // Make sure components are initialized
    if (!embedder.initialized || !ragComponent.initialized || !llmProcessor.initialized) {
      await initializeComponents();
    }
    
    // Generate embedding for content
    const embedding = await embedder.embed(content.text);
    
    // Add to RAG for context retrieval
    await ragComponent.addDocument(content.text, embedding);
    
    // Generate summary using LLM
    const summary = await llmProcessor.summarize(content.text, content.title);
    
    return {
      title: content.title,
      url: content.url,
      summary: summary.summary,
      keyPoints: summary.keyPoints,
      success: true
    };
  } catch (error) {
    console.error("Summarization failed:", error);
    return {
      error: error.message,
      success: false
    };
  }
}

// Initialize on load
initializeComponents(); 