// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'summarize') {
    const { title, content, url } = message.data;
    
    // Create a unique ID for this summarization task
    const taskId = Date.now().toString();
    
    // Immediately respond with a taskId to prevent popup from closing
    sendResponse({ 
      success: true, 
      inProgress: true,
      taskId: taskId
    });
    
    // Store active summarization task to prevent cancellation
    chrome.storage.local.set({ 
      activeSummarizationTask: {
        taskId,
        timestamp: Date.now(),
        title,
        url
      }
    });
    
    // Function to update progress
    const updateProgress = (percentage, status) => {
      chrome.runtime.sendMessage({
        action: 'summarizationProgress',
        data: {
          taskId,
          percentage,
          status
        }
      });
    };
    
    // Start the summarization process
    updateProgress(10, 'Preparing content...');
    
    // Get the user's preferred summarization method and settings
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
        
        let summary;
        let usedFallback = false;
        let contentTruncated = false;
        let provider = summarizerType;
        
        // Estimate tokens for progress reporting
        const estimatedTokens = Math.ceil((title.length + content.length) / 4);
        const isLikelyLarge = estimatedTokens > 4000;
        
        updateProgress(20, isLikelyLarge ? 'Truncating large content...' : 'Content prepared');
        
        try {
          // Format the content based on token limits
          const { formattedContent, isTruncated } = formatContentForProvider(title, content, summarizerType, result);
          contentTruncated = isTruncated;
          
          // Use the selected provider
          updateProgress(30, `Sending to ${getProviderName(summarizerType, result)}...`);
          
          switch (summarizerType) {
            case 'local':
              summary = await summarizeWithLocalLlm(title, formattedContent, localLlmUrl);
              break;
            case 'groq':
              summary = await summarizeWithGroq(title, formattedContent, apiKeys.groqApiKey, result.groqModel);
              break;
            case 'openai':
              summary = await summarizeWithOpenAI(title, formattedContent, apiKeys.openaiApiKey, result.openaiModel);
              break;
            case 'deepseek':
              summary = await summarizeWithDeepseek(title, formattedContent, apiKeys.deepseekApiKey, result.deepseekModel);
              break;
            case 'custom':
              summary = await summarizeWithCustom(
                title, 
                formattedContent, 
                apiKeys.customApiKey, 
                result.customApiEndpoint,
                result.customApiModel,
                result.customApiHeaders
              );
              break;
            default:
              // Fallback to local LLM if invalid type
              summary = await summarizeWithLocalLlm(title, formattedContent, localLlmUrl);
          }
          
          updateProgress(90, 'Finalizing summary...');
        } catch (apiError) {
          console.error(`${summarizerType} error, falling back to Local LLM:`, apiError);
          updateProgress(40, `${getProviderName(summarizerType, result)} failed, trying Local LLM...`);
          
          // Fallback to Local LLM
          try {
            const { formattedContent } = formatContentForProvider(title, content, 'local');
            summary = await summarizeWithLocalLlm(title, formattedContent, localLlmUrl);
            usedFallback = true;
            provider = 'local';
            updateProgress(90, 'Finalizing summary...');
          } catch (localError) {
            // If local also fails, rethrow the original error
            updateProgress(0, 'All summarization methods failed');
            throw apiError;
          }
        }
        
        // Save the summary and URL to history
        saveToHistory(url, title, summary, provider);
        updateProgress(100, 'Summary complete!');
        
        // Send the completed summary
        chrome.runtime.sendMessage({
          action: 'summarizationComplete',
          data: { 
            taskId,
            success: true, 
            summary,
            usedFallback,
            contentTruncated,
            provider
          }
        });
        
        // Clear active task
        chrome.storage.local.remove('activeSummarizationTask');
      } catch (error) {
        console.error('Summarization error:', error);
        updateProgress(0, 'Summarization failed');
        
        // Send error notification
        chrome.runtime.sendMessage({
          action: 'summarizationComplete',
          data: { 
            taskId,
            success: false, 
            error: error.message
          }
        });
        
        // Clear active task
        chrome.storage.local.remove('activeSummarizationTask');
      }
    });
    
    // Return true because we're responding asynchronously
    return true;
  }
  
  // Handle chat questions
  if (message.action === 'chat') {
    const { question, context } = message.data;
    
    // Process in the background without blocking
    processChat(question, context);
    
    // Return false since we're not using sendResponse
    return false;
  }
  
  // Validate API connection
  if (message.action === 'validateApiConnection') {
    const { provider, apiKey, model, endpoint, headers } = message.data;
    
    validateApiConnection(provider, apiKey, model, endpoint, headers)
      .then(result => {
        sendResponse(result);
      })
      .catch(error => {
        console.error(`API validation error (${provider}):`, error);
        sendResponse({ 
          success: false, 
          isValid: false, 
          message: error.message 
        });
      });
    
    // Return true to indicate we'll respond asynchronously
    return true;
  }
  
  // Check for active summarization
  if (message.action === 'checkActiveSummarization') {
    chrome.storage.local.get(['activeSummarizationTask'], (result) => {
      const task = result.activeSummarizationTask;
      if (task && (Date.now() - task.timestamp) < 300000) { // 5 minute timeout
        sendResponse({ hasActiveTask: true, task });
      } else {
        if (task) {
          // Clear stale task
          chrome.storage.local.remove('activeSummarizationTask');
        }
        sendResponse({ hasActiveTask: false });
      }
    });
    return true;
  }
});

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
  const encryptionKey = 'second-brain-extension-key';
  
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
          salt: new TextEncoder().encode("second-brain-salt"),
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
              response = await chatWithLocalLlm(formattedHistory, localLlmUrl);
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
              response = await chatWithLocalLlm(formattedHistory, localLlmUrl);
          }
        } catch (apiError) {
          console.error(`${summarizerType} chat error, falling back to Local LLM:`, apiError);
          
          // Fallback to Local LLM
          response = await chatWithLocalLlm(formattedHistory, localLlmUrl);
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
async function chatWithLocalLlm(messages, localLlmUrl) {
  try {
    const response = await fetch(`${localLlmUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-r1-distill-qwen-7b',
        messages: messages,
        max_tokens: 500
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'Error calling local LLM');
    }
    
    return data.choices[0].message.content;
  } catch (error) {
    console.error('Local LLM chat error:', error);
    throw new Error(`Failed to get answer with local LLM: ${error.message}. Make sure LM Studio is running.`);
  }
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

// Function to summarize content using local LLM via LM Studio
async function summarizeWithLocalLlm(title, content, localLlmUrl) {
  const prompt = `Summarize the following content with title "${title}":\n\n${content}\n\nProvide a concise summary highlighting the key points.`;
  
  try {
    const response = await fetch(`${localLlmUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-r1-distill-qwen-7b',
        messages: [
          { role: 'system', content: 'You are a helpful assistant that provides concise summaries of web content.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'Error calling local LLM');
    }
    
    return data.choices[0].message.content;
  } catch (error) {
    console.error('Local LLM error:', error);
    throw new Error(`Failed to summarize with local LLM: ${error.message}. Make sure LM Studio is running.`);
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