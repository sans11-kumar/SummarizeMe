console.log('Background script loaded');

importScripts('./rag/embedder-impl.js');  // This file should define the embedder

// Create and manage worker
let llmWorker = null;

async function initializeLLMWorker() {
  console.log('Starting LLM check');
  console.log('Initializing worker');
  try {
    // Check if worker already exists
    if (llmWorker) {
      console.log('Worker already exists, reusing');
      return;
    }
    
    console.log('Creating new LLM worker');
    
    // Check local LLM status first
    const localLlmStatus = await checkAndValidateLMStudio();
    
    // Store the status
    chrome.storage.local.set({ localLlmStatus });
    
    // Create new worker with proper error handling
    try {
      llmWorker = new Worker(chrome.runtime.getURL('llm/llm_worker.js'), {
        type: 'module' // This allows the worker to use ES modules
      });
      
      console.log('Worker created successfully');
      
      // Set up message handler
      llmWorker.onmessage = function(event) {
        const message = event.data;
        console.log('Message from worker:', message);
        
        // Forward messages from worker back to extension
        if (message.action === "summarization_result" || 
            message.action === "summarization_error") {
          chrome.runtime.sendMessage(message);
        }
      };
      
      // Add error handler
      llmWorker.onerror = function(error) {
        console.error('Worker error:', error);
        chrome.storage.local.set({ 
          localLlmStatus: { available: false, error: 'Worker error: ' + error.message } 
        });
      };
      
      // Send initial status to worker
      llmWorker.postMessage({
        action: "init",
        localLlmStatus: localLlmStatus
      });
      
      console.log('LLM Worker initialized successfully');
    } catch (workerError) {
      console.error('Failed to create worker:', workerError);
      throw workerError;
    }
  } catch (error) {
    console.error('Failed to initialize LLM Worker:', error);
    
    // Store error status
    chrome.storage.local.set({ 
      localLlmStatus: { available: false, error: error.message } 
    });
  }
}

// Initialize worker on startup
initializeLLMWorker();

// Update message listener to handle LLM status requests with the new validator
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'checkLocalLlm') {
    // Use our comprehensive checker
    checkAndValidateLMStudio().then(status => {
      const formattedStatus = {
        available: status.connected && status.modelLoaded,
        models: status.models || [],
        activeModel: status.activeModel || null,
        error: status.error || null,
        lastChecked: Date.now()
      };
      
      // Store the status for future reference
      chrome.storage.local.set({ localLlmStatus: formattedStatus });
      
      // Send response
      sendResponse({status: formattedStatus});
    });
    return true; // Keep the message channel open for the async response
  }
  
  if (message.action === 'summarize') {
    try {
      // Check if local LLM is available using the comprehensive checker
      checkAndValidateLMStudio().then(status => {
        // Format status appropriately
        const formattedStatus = {
          available: status.connected && status.modelLoaded,
          models: status.models || [],
          activeModel: status.activeModel || null,
          error: status.error || null,
          lastChecked: Date.now()
        };
        
        // Store the status
        chrome.storage.local.set({ localLlmStatus: formattedStatus });
        
        // Send status to popup if it's not available
        if (!formattedStatus.available) {
          chrome.runtime.sendMessage({
            action: 'localLlmStatus',
            status: formattedStatus
          });
        }

        // Check if worker exists, create if needed
        if (!llmWorker) {
          console.log('Worker not found, initializing...');
          initializeLLMWorker().then(() => {
            sendToWorker();
          }).catch(workerError => {
            console.error('Failed to initialize worker:', workerError);
            sendResponse({status: "error", message: 'Failed to initialize worker: ' + workerError.message});
          });
        } else {
          sendToWorker();
        }
        
        function sendToWorker() {
          // Include the settings in the message to worker
          chrome.storage.sync.get(['summarizerType'], settings => {
            console.log('Sending message to worker with settings:', settings);
            try {
              // Send message to worker
              llmWorker.postMessage({
                target: "llm_worker",
                action: "summarize",
                content: message.content,
                settings: settings
              });
              
              // Let the sender know we're processing
              sendResponse({status: "processing"});
            } catch (postError) {
              console.error('Error posting to worker:', postError);
              sendResponse({status: "error", message: 'Error communicating with worker: ' + postError.message});
            }
          });
        }
      }).catch(error => {
        console.error('Error checking LLM status:', error);
        sendResponse({status: "error", message: 'Failed to check LLM status: ' + error.message});
      });
    } catch (error) {
      console.error('Error in summarize handler:', error);
      sendResponse({status: "error", message: error.message});
    }
    return true; // Keep the message channel open for the async response
  }
  
  if (message.action === 'testLocalLlm') {
    const url = message.url;
    
    // Set a timeout to ensure we always respond
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          connected: false,
          modelLoaded: false,
          error: 'Connection test timed out after 10 seconds'
        });
      }, 10000);
    });
    
    // Race the actual test with the timeout
    Promise.race([
      checkAndValidateLMStudio(url),
      timeoutPromise
    ])
    .then(status => {
      console.log('Connection test completed with status:', status);
      sendResponse({ status: status });
      })
      .catch(error => {
      console.error('Error testing LM Studio connection:', error);
        sendResponse({ 
        status: { 
          connected: false, 
          modelLoaded: false, 
          error: error.message || 'Unknown error occurred during connection test'
        } 
        });
      });
    
    return true; // Keep the message channel open for the async response
  }
  
    return true;
});

// Then create a separate worker or page for LLM processing

// Format content based on provider's token limits
function formatContentForProvider(title, content, provider, settings = {}) {
  // Default token limits by provider
  const tokenLimits = {
    'local': 8000,    // LM Studio with smaller models
    'groq': 4000,     // Groq has 6000 TPM limit
    'openai': 12000,  // GPT-3.5 has 16K, adjust based on model
    'deepseek': 6000, // Deepseek Chat
    'custom': 6000    // Default for custom providers
  };
  
  // Adjust based on specific models if needed
  if (provider === 'openai' && settings.openaiModel === 'gpt-4') {
    tokenLimits.openai = 6000; // GPT-4 has an 8K context
  } else if (provider === 'openai' && settings.openaiModel === 'gpt-4-turbo') {
    tokenLimits.openai = 100000; // GPT-4 Turbo has a 128K context
  }
  
  // Estimate the current tokens (roughly 4 chars per token)
  const estimatedTokens = Math.ceil((title.length + content.length) / 4);
  
  // Check if content needs truncation
  if (estimatedTokens <= tokenLimits[provider]) {
    return { formattedContent: content, isTruncated: false };
  }
  
  // Truncate content to fit within token limit
  const maxContentChars = tokenLimits[provider] * 4 - title.length - 200; // Buffer for prompt
  const truncatedContent = content.substring(0, maxContentChars) + 
    "\n\n[Content truncated due to length limits. This summary covers only the beginning portion of the content.]";
    
  return { formattedContent: truncatedContent, isTruncated: true };
}

// Get human-readable provider name
function getProviderName(provider, settings = {}) {
  switch (provider) {
    case 'local':
      return 'Local LLM';
    case 'groq':
      return 'Groq API';
    case 'openai':
      return 'OpenAI API';
    case 'deepseek':
      return 'Deepseek API';
    case 'custom':
      return settings.customApiName || 'Custom API';
    default:
      return 'AI Service';
  }
}

// Decrypt API keys from storage
async function decryptApiKeys(settings) {
  // Encryption helpers
  const encryptionKey = 'summarize-me-extension-key';
  
  async function decryptData(encryptedData) {
    if (!encryptedData) return '';
    
    try {
      // Try simple base64 decode first (no encryption)
      if (!settings.encryptionEnabled) {
        return atob(encryptedData);
      }
      
      // Convert base64 to array buffer
      const encryptedBytes = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
      
      // Extract the IV and ciphertext
      const iv = encryptedBytes.slice(0, 12);
      const ciphertext = encryptedBytes.slice(12);
      
      // Import the encryption key
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(encryptionKey),
        { name: "PBKDF2" },
        false,
        ["deriveBits", "deriveKey"]
      );
      
      const key = await crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: new TextEncoder().encode("summarize-me-salt"),
          iterations: 100000,
          hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"]
      );
      
      // Decrypt the data
      const decrypted = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv
        },
        key,
        ciphertext
      );
      
      return new TextDecoder().decode(decrypted);
    } catch (error) {
      console.error('Decryption error:', error);
      try {
        // Try simple base64 decode as fallback
        return atob(encryptedData);
      } catch (e) {
        console.error('Base64 decode error:', e);
        return '';
      }
    }
  }
  
  return {
    groqApiKey: await decryptData(settings.encryptedGroqApiKey),
    openaiApiKey: await decryptData(settings.encryptedOpenaiApiKey),
    deepseekApiKey: await decryptData(settings.encryptedDeepseekApiKey),
    customApiKey: await decryptData(settings.encryptedCustomApiKey)
  };
}

// Process chat messages and respond using the appropriate LLM
async function processChat(question, context) {
  try {
    // Get the user's preferred LLM settings
    chrome.storage.sync.get([
      'summarizerType', 
      'encryptedGroqApiKey',
      'groqModel',
      'encryptedOpenaiApiKey',
      'openaiModel',
      'encryptedDeepseekApiKey',
      'deepseekModel',
      'customApiName',
      'customApiEndpoint',
      'encryptedCustomApiKey',
      'customApiModel',
      'customApiHeaders',
      'localLlmUrl'
    ], async (result) => {
      try {
        // Decrypt API keys
        const apiKeys = await decryptApiKeys(result);
        
        const summarizerType = result.summarizerType || 'local';
        const localLlmUrl = result.localLlmUrl || 'http://localhost:1234/v1';
        
        let response;
        let provider = summarizerType;
        
        // Format chat history for context
        const formattedHistory = context.history.length > 0 
          ? context.history
          : [{ role: 'system', content: 'You are a helpful assistant that answers questions about web content.' }];
        
        // Create context message
        const contextMessage = `You are answering questions about a webpage with the title "${context.title}" 
and URL ${context.url}. Here is a summary of the content: ${context.summary}
The user wants to know more about the content of this webpage. Answer their questions based on the summary.
If you can't answer based on the summary, say so and suggest what information might be needed.`;
        
        // Make sure system instructions are first
        if (formattedHistory[0].role !== 'system') {
          formattedHistory.unshift({ role: 'system', content: contextMessage });
        } else {
          formattedHistory[0].content = contextMessage;
        }
        
        // Add this question
        formattedHistory.push({ role: 'user', content: question });
        
        try {
          // Use the selected provider
          switch (summarizerType) {
            case 'local':
              response = await chatWithLocalLlm(formattedHistory);
              break;
            case 'groq':
              response = await chatWithGroq(formattedHistory, apiKeys.groqApiKey, result.groqModel);
              break;
            case 'openai':
              response = await chatWithOpenAI(formattedHistory, apiKeys.openaiApiKey, result.openaiModel);
              break;
            case 'deepseek':
              response = await chatWithDeepseek(formattedHistory, apiKeys.deepseekApiKey, result.deepseekModel);
              break;
            case 'custom':
              response = await chatWithCustom(
                formattedHistory,
                apiKeys.customApiKey,
                result.customApiEndpoint,
                result.customApiModel,
                result.customApiHeaders
              );
              break;
            default:
              // Fallback to local LLM
              response = await chatWithLocalLlm(formattedHistory);
          }
        } catch (apiError) {
          console.error(`${summarizerType} chat error, falling back to Local LLM:`, apiError);
          
          // Fallback to Local LLM
          response = await chatWithLocalLlm(formattedHistory);
          provider = 'local';
        }
        
        // Send the response back
        chrome.runtime.sendMessage({
          action: 'chatResponse',
          data: {
            question,
            response,
            provider,
            success: true
          }
        });
      } catch (error) {
        console.error('Chat error:', error);
        
        // Send error message
        chrome.runtime.sendMessage({
          action: 'chatResponse',
          data: {
            question,
            error: error.message,
            success: false
          }
        });
      }
    });
  } catch (error) {
    console.error('Error processing chat:', error);
    
    // Send error message
    chrome.runtime.sendMessage({
      action: 'chatResponse',
      data: {
        question,
        error: 'Failed to process your question. Please try again.',
        success: false
      }
    });
  }
}

// Validate API Connection
async function validateApiConnection(provider, apiKey, model, endpoint, headers) {
  if (!apiKey) {
    return { success: false, isValid: false, message: 'No API key provided' };
  }
  
  try {
    switch (provider) {
      case 'groq':
        return await validateGroqApiKey(apiKey);
      
      case 'openai':
        return await validateOpenAIApiKey(apiKey);
        
      case 'deepseek':
        return await validateDeepseekApiKey(apiKey);
        
      case 'custom':
        return await validateCustomApiKey(apiKey, endpoint, headers);
        
      default:
        return { success: false, isValid: false, message: 'Unknown provider' };
    }
  } catch (error) {
    console.error(`API validation error (${provider}):`, error);
    return { 
      success: false, 
      isValid: false, 
      message: error.message || 'Connection error' 
    };
  }
}

// Function to validate Groq API key
async function validateGroqApiKey(apiKey) {
  if (!apiKey) {
    return { success: false, isValid: false, message: 'No API key provided' };
  }
  
  try {
    // Make a simple request to Groq API to check if the key is valid
    // Using the models endpoint as it's lightweight
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    // Check the response
    if (response.ok) {
      return { success: true, isValid: true };
    } else {
      const errorData = await response.json();
      return { 
        success: false, 
        isValid: false, 
        message: errorData.error?.message || 'Invalid API key' 
      };
    }
  } catch (error) {
    console.error('Groq API validation error:', error);
    return { 
      success: false, 
      isValid: false, 
      message: error.message || 'Connection error'
    };
  }
}

// Function to validate OpenAI API key
async function validateOpenAIApiKey(apiKey) {
  if (!apiKey) {
    return { success: false, isValid: false, message: 'No API key provided' };
  }
  
  try {
    // Make a simple request to OpenAI API to check if the key is valid
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    // Check the response
    if (response.ok) {
      return { success: true, isValid: true };
    } else {
      const errorData = await response.json();
      return { 
        success: false, 
        isValid: false, 
        message: errorData.error?.message || 'Invalid API key' 
      };
    }
  } catch (error) {
    console.error('OpenAI API validation error:', error);
    return { 
      success: false, 
      isValid: false, 
      message: error.message || 'Connection error'
    };
  }
}

// Function to validate Deepseek API key
async function validateDeepseekApiKey(apiKey) {
  if (!apiKey) {
    return { success: false, isValid: false, message: 'No API key provided' };
  }
  
  try {
    // Make a simple request to Deepseek API to check if the key is valid
    const response = await fetch('https://api.deepseek.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    // Check the response
    if (response.ok) {
      return { success: true, isValid: true };
    } else {
      const errorData = await response.json();
      return { 
        success: false, 
        isValid: false, 
        message: errorData.error?.message || 'Invalid API key' 
      };
    }
  } catch (error) {
    console.error('Deepseek API validation error:', error);
    return { 
      success: false, 
      isValid: false, 
      message: error.message || 'Connection error'
    };
  }
}

// Function to validate Custom API key
async function validateCustomApiKey(apiKey, endpoint, customHeaders = {}) {
  if (!apiKey) {
    return { success: false, isValid: false, message: 'No API key provided' };
  }
  
  if (!endpoint) {
    return { success: false, isValid: false, message: 'No API endpoint provided' };
  }
  
  try {
    // Parse the headers if it's a string
    let headers = typeof customHeaders === 'string' 
      ? JSON.parse(customHeaders || '{}') 
      : customHeaders;
    
    // Add authorization header
    headers = {
      ...headers,
      'Authorization': `Bearer ${apiKey}`
    };
    
    // Make a request to the endpoint
    const response = await fetch(endpoint, {
      method: 'GET',
      headers
    });
    
    // Check if we got any response
    if (response.ok) {
      return { success: true, isValid: true };
    } else {
      let message = 'Invalid API key or endpoint';
      try {
        const errorData = await response.json();
        message = errorData.error?.message || message;
      } catch (e) {
        // Ignore JSON parse errors
      }
      
      return { 
        success: false, 
        isValid: false, 
        message
      };
    }
  } catch (error) {
    console.error('Custom API validation error:', error);
    return { 
      success: false, 
      isValid: false, 
      message: error.message || 'Connection error'
    };
  }
}

// Function to chat using Groq API
async function chatWithGroq(messages, apiKey, model = 'llama3-8b-8192') {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: 500
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'Error calling Groq API');
    }
    
    return data.choices[0].message.content;
  } catch (error) {
    console.error('Groq API chat error:', error);
    throw new Error(`Failed to get answer from Groq: ${error.message}`);
  }
}

// Function to chat using OpenAI API
async function chatWithOpenAI(messages, apiKey, model = 'gpt-3.5-turbo') {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: 500
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'Error calling OpenAI API');
    }
    
    return data.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI API chat error:', error);
    throw new Error(`Failed to get answer from OpenAI: ${error.message}`);
  }
}

// Function to chat using Deepseek API
async function chatWithDeepseek(messages, apiKey, model = 'deepseek-chat') {
  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: 500
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'Error calling Deepseek API');
    }
    
    return data.choices[0].message.content;
  } catch (error) {
    console.error('Deepseek API chat error:', error);
    throw new Error(`Failed to get answer from Deepseek: ${error.message}`);
  }
}

// Function to chat using Custom API
async function chatWithCustom(messages, apiKey, endpoint, model, customHeaders = '{}') {
  try {
    // Parse headers if it's a string
    let headers = typeof customHeaders === 'string' 
      ? JSON.parse(customHeaders || '{}') 
      : customHeaders;
    
    // Add standard headers
    headers = {
      ...headers,
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: 500
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'Error calling Custom API');
    }
    
    // Attempt to extract response using standard OpenAI format
    if (data.choices && data.choices[0] && data.choices[0].message) {
      return data.choices[0].message.content;
    } else if (data.output || data.response || data.text || data.content) {
      // Try alternative response formats
      return data.output || data.response || data.text || data.content;
    } else {
      // If we can't find the response in a standard place, return the whole JSON
      return JSON.stringify(data);
    }
  } catch (error) {
    console.error('Custom API chat error:', error);
    throw new Error(`Failed to get answer from Custom API: ${error.message}`);
  }
}

// Function to chat using local LLM via LM Studio
async function chatWithLocalLlm(messages) {
  // Get the custom URL from settings or use default
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(['localLlmUrl'], async function(data) {
      const localLlmUrl = (data.localLlmUrl || 'http://localhost:1234/v1').trim();
      
      try {
        // Check if LM Studio is available at the specified URL
        const lmStatus = await checkAndValidateLMStudio(localLlmUrl);
        
        // Store the latest status
        chrome.storage.local.set({ localLlmStatus: {
          available: lmStatus.connected && lmStatus.modelLoaded,
          models: lmStatus.models || [],
          error: lmStatus.error || null,
          lastChecked: Date.now()
        }});
        
        // If not connected or no model loaded, return error
        if (!lmStatus.connected) {
          reject(new Error(lmStatus.error || 'Cannot connect to LM Studio'));
          return;
        }
        
        if (!lmStatus.modelLoaded) {
          reject(new Error(lmStatus.error || 'No model loaded in LM Studio'));
          return;
        }
        
        console.log('Starting local LLM chat with model:', 
          lmStatus.activeModel?.name || lmStatus.activeModel?.id || 'default');
        
        // Create an AbortController for timeout handling
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30-second timeout
        
        fetch(`${localLlmUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
            model: lmStatus.activeModel?.id || lmStatus.activeModel?.name || 'default',
        messages: messages,
        max_tokens: 500
          }),
          signal: controller.signal
        })
        .then(response => {
          clearTimeout(timeoutId);
          console.log('Local LLM response status:', response.status);
          return response.json();
        })
        .then(data => {
          console.log('Local LLM response data:', data);
          if (!data.choices || !data.choices[0]) {
            console.error('Invalid LLM response format:', data);
            reject(new Error("Invalid response from LLM"));
            return;
          }
          resolve(data.choices[0].message.content);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          console.error('Local LLM error:', error);
          
          if (error.name === 'AbortError') {
            reject(new Error('LM Studio request timed out after 30 seconds'));
          } else {
            reject(new Error(`Failed to get response from LM Studio: ${error.message}`));
          }
        });
  } catch (error) {
        console.error('Local LLM setup error:', error);
        reject(error);
  }
    });
  });
}

// Function to summarize content using Groq API
async function summarizeWithGroq(title, content, apiKey, model = 'llama3-8b-8192') {
  const prompt = `Summarize the following content with title "${title}":\n\n${content}\n\nProvide a concise summary highlighting the key points.`;
  
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: 'You are a helpful assistant that provides concise summaries of web content.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'Error calling Groq API');
    }
    
    return data.choices[0].message.content;
  } catch (error) {
    console.error('Groq API error:', error);
    throw new Error(`Failed to summarize with Groq: ${error.message}`);
  }
}

// Function to summarize content using OpenAI API
async function summarizeWithOpenAI(title, content, apiKey, model = 'gpt-3.5-turbo') {
  const prompt = `Summarize the following content with title "${title}":\n\n${content}\n\nProvide a concise summary highlighting the key points.`;
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: 'You are a helpful assistant that provides concise summaries of web content.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'Error calling OpenAI API');
    }
    
    return data.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw new Error(`Failed to summarize with OpenAI: ${error.message}`);
  }
}

// Function to summarize content using Deepseek API
async function summarizeWithDeepseek(title, content, apiKey, model = 'deepseek-chat') {
  const prompt = `Summarize the following content with title "${title}":\n\n${content}\n\nProvide a concise summary highlighting the key points.`;
  
  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: 'You are a helpful assistant that provides concise summaries of web content.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'Error calling Deepseek API');
    }
    
    return data.choices[0].message.content;
  } catch (error) {
    console.error('Deepseek API error:', error);
    throw new Error(`Failed to summarize with Deepseek: ${error.message}`);
  }
}

// Function to summarize content using custom API
async function summarizeWithCustom(title, content, apiKey, endpoint, model, customHeaders = '{}') {
  const prompt = `Summarize the following content with title "${title}":\n\n${content}\n\nProvide a concise summary highlighting the key points.`;
  
  try {
    // Parse headers if it's a string
    let headers = typeof customHeaders === 'string' 
      ? JSON.parse(customHeaders || '{}') 
      : customHeaders;
    
    // Add standard headers
    headers = {
      ...headers,
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: 'You are a helpful assistant that provides concise summaries of web content.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'Error calling Custom API');
    }
    
    // Attempt to extract response using standard OpenAI format
    if (data.choices && data.choices[0] && data.choices[0].message) {
      return data.choices[0].message.content;
    } else if (data.output || data.response || data.text || data.content) {
      // Try alternative response formats
      return data.output || data.response || data.text || data.content;
    } else {
      // If we can't find the response in a standard place, return the whole JSON
      return JSON.stringify(data);
    }
  } catch (error) {
    console.error('Custom API error:', error);
    throw new Error(`Failed to summarize with Custom API: ${error.message}`);
  }
}

// RAG Component Initialization
let vectorDB;

async function initializeRAGComponents() {
  // Use the already initialized components
  if (embedder && ragComponent && embedder.initialized && ragComponent.initialized) {
    console.log('RAG components already initialized');
    return;
  }
  
  try {
    // Initialize if not already done
    if (!embedder || !embedder.initialized) {
      if (!embedder) {
        embedder = new EmbedderImpl();
      } else {
        embedder.initialize();
      }
      console.log('Embedder initialized successfully');
    }
    
    if (!ragComponent || !ragComponent.initialized) {
      if (!ragComponent) {
        ragComponent = new RAGComponentImpl();
      } else {
        ragComponent.initialize();
      }
      console.log('RAG component initialized successfully');
    }
  } catch (error) {
    console.error('RAG initialization failed:', error);
    throw new Error(`RAG initialization failed: ${error.message}`);
  }
}

// Web Search class
class WebSearch {
  async search(query, maxResults = 3) {
    try {
      const response = await fetch(`https://serper.dev/search?q=${encodeURIComponent(query)}`, {
        method: 'GET',
        headers: {
          'X-API-KEY': await getSerperApiKey(),
          'Content-Type': 'application/json'
        }
      });
      return response.json().then(data => data.results.slice(0, maxResults));
    } catch (error) {
      console.error('Web search error:', error);
      return [];
    }
  }
}

// Save summary to history
function saveToHistory(url, title, summary, provider = 'unknown') {
  chrome.storage.local.get(['history'], (result) => {
    const history = result.history || [];
    
    // Add new entry
    history.push({
      url,
      title,
      summary,
      provider,
      timestamp: Date.now()
    });
    
    // Keep only the last 100 entries
    if (history.length > 100) {
      history.shift();
    }
    
    chrome.storage.local.set({ history });
  });
}

// Define embedder and RAG component directly in the background.js file
let embedder = null;
let ragComponent = null;

// Initialize components on service worker startup
function initializeComponents() {
  try {
    // Create embedder instance using code from imported scripts
    embedder = new EmbedderImpl();  // This class should be defined in embedder-impl.js
    ragComponent = new RAGComponentImpl();  // Similarly defined in an imported script
    
    return true;
  } catch (error) {
    console.error("Component initialization failed:", error);
    return false;
  }
}

// Initialize right away
initializeComponents();

// Replace the existing checkAndValidateLMStudio function with this more robust version
async function checkAndValidateLMStudio(localLlmUrl = 'http://localhost:1234/v1') {
  console.log('Starting LM Studio connection test to:', localLlmUrl);
  
  // Ensure URL is properly formatted
  if (!localLlmUrl) {
    localLlmUrl = 'http://localhost:1234/v1';
  }
  
  // Make sure the URL has a protocol
  if (!localLlmUrl.startsWith('http://') && !localLlmUrl.startsWith('https://')) {
    localLlmUrl = 'http://' + localLlmUrl;
  }
  
  // Ensure URL ends with '/v1' as required by the OpenAI-compatible API
  if (!localLlmUrl.endsWith('/v1')) {
    localLlmUrl = localLlmUrl.endsWith('/') ? localLlmUrl + 'v1' : localLlmUrl + '/v1';
  }

  console.log('Normalized URL for testing:', localLlmUrl);
  
  try {
    // First try basic connectivity with a longer timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    console.log('Testing basic connectivity...');
    let response;
    
    try {
      // Try a simple health check first (this works for most OpenAI-compatible APIs)
      response = await fetch(`${localLlmUrl}/health`, {
        method: 'GET',
        signal: controller.signal
      });
      
      if (response.ok) {
        console.log('Health check passed');
        clearTimeout(timeoutId);
      }
    } catch (healthError) {
      console.log('Health check not available, trying models endpoint instead');
      // Health check failed, fall back to models endpoint
    }
    
    // If health check failed or wasn't available, try models endpoint
    if (!response || !response.ok) {
      try {
        response = await fetch(`${localLlmUrl}/models`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);
      } catch (modelError) {
        clearTimeout(timeoutId);
        throw modelError; // rethrow to be caught by outer catch
      }
    }
    
    // Check if any response was valid
    if (!response || !response.ok) {
      const errorStatus = response ? response.status : 'unknown';
      const errorText = response ? await response.text().catch(() => 'No response text') : 'No response';
      console.error(`LM Studio API returned error ${errorStatus}:`, errorText);
      return { 
        connected: false, 
        modelLoaded: false, 
        error: `LM Studio returned error: ${errorStatus} - ${errorText.substring(0, 100)}` 
      };
    }
    
    // Parse response and skip model checking if we just did a health check
    let hasModel = false;
    let modelInfo = { id: 'model', name: 'LM Studio Model' };
    
    if (response.url.includes('/models')) {
      // Try to parse models response
      try {
        const data = await response.json();
        console.log('LM Studio API response:', data);
        
        // Handle different API response formats
        let models = [];
        if (data.data) models = data.data;
        else if (data.models) models = data.models;
        else if (Array.isArray(data)) models = data;
        
        // If any data is returned, consider it a success even if models array is empty
        hasModel = true;
        if (models.length > 0) {
          modelInfo = models[0];
        }
      } catch (parseError) {
        console.error('Error parsing models response:', parseError);
        // Continue anyway, we'll test inference directly
      }
    } else {
      // If health check succeeded, assume a model is loaded
      hasModel = true;
    }
    
    // Always test inference regardless of model detection
    console.log('Testing inference capability...');
    try {
      // Create a new timeout for the inference test
      const inferenceController = new AbortController();
      const inferenceTimeoutId = setTimeout(() => inferenceController.abort(), 15000); // 15 seconds for inference
      
      const testResponse = await fetch(`${localLlmUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
          model: modelInfo.id || 'default',
        messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Say "working" if you can read this.' }
          ],
          max_tokens: 10,
          temperature: 0.1
        }),
        signal: inferenceController.signal
      });
      
      clearTimeout(inferenceTimeoutId);
      
      if (!testResponse.ok) {
        const inferenceError = await testResponse.text().catch(() => 'Unknown error');
        console.error('Inference test failed:', inferenceError);
        return { 
          connected: true, 
          modelLoaded: false, 
          error: `Connected to LM Studio but inference failed: ${testResponse.status} - ${inferenceError.substring(0, 100)}` 
        };
      }
      
      // Try to parse the inference response
      const inferenceData = await testResponse.json().catch(() => null);
      
      if (!inferenceData || !inferenceData.choices || !inferenceData.choices[0]) {
        console.warn('Inference succeeded but returned unexpected format:', inferenceData);
        // Inference still worked even though response format is unexpected
      }
      
      // If we got here, inference worked!
      console.log('Inference test passed');
      
      return { 
        connected: true, 
        modelLoaded: true, 
        models: [modelInfo],
        activeModel: {
          id: modelInfo.id || 'default-model',
          name: inferenceData?.model || modelInfo.name || 'Deepseek Qwen 7B'
        }
      };
      
    } catch (inferenceError) {
      console.error('Inference test error:', inferenceError);
      return { 
        connected: true, 
        modelLoaded: false, 
        error: `Connected to LM Studio but inference failed: ${inferenceError.message}` 
      };
    }
    
  } catch (error) {
    console.error('LM Studio connectivity check failed:', error);
    
    // Determine if this is a timeout
    if (error.name === 'AbortError') {
      return {
        connected: false,
        modelLoaded: false,
        error: 'Connection timed out. Make sure LM Studio is running and responding.'
      };
    }
    
    // Handle connection refused and other network errors
    let errorMessage = error.message;
    if (error.message.includes('Failed to fetch') || 
        error.message.includes('NetworkError') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('Network request failed')) {
      errorMessage = 'Cannot connect to LM Studio. Make sure LM Studio is running on your computer.';
    }
    
    return { 
      connected: false, 
      modelLoaded: false, 
      error: errorMessage
    };
  }
}

// Add this function for testing API keys with proper error handling
async function testApiConnection(apiType, apiKey, model) {
  try {
    console.log(`Testing ${apiType} API connection`);
    
    // Set up abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    let endpoint, headers, body;
    
    switch(apiType) {
      case 'groq':
        endpoint = 'https://api.groq.com/v1/models';
        headers = {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        };
        break;
      // Add other API types here...
      default:
        throw new Error(`Unknown API type: ${apiType}`);
    }
    
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: headers,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `API returned error ${response.status}: ${errorText}`
      };
    }
    
    return {
      success: true,
      data: await response.json()
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      return {
        success: false,
        error: 'Connection timed out after 10 seconds'
      };
    }
    
    return {
      success: false,
      error: error.message || 'Unknown error occurred'
    };
  }
}
