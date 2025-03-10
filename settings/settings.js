document.addEventListener('DOMContentLoaded', async () => {
  const settingsForm = document.getElementById('settingsForm');
  const summarizerTypeInputs = document.getElementsByName('summarizerType');
  const localSettings = document.getElementById('localSettings');
  const groqSettings = document.getElementById('groqSettings');
  const openaiSettings = document.getElementById('openaiSettings');
  const deepseekSettings = document.getElementById('deepseekSettings');
  const customSettings = document.getElementById('customSettings');
  const allApiSettings = document.querySelectorAll('.api-setting');
  
  const localLlmUrlInput = document.getElementById('localLlmUrl');
  const groqApiKeyInput = document.getElementById('groqApiKey');
  const groqModelSelect = document.getElementById('groqModel');
  const openaiApiKeyInput = document.getElementById('openaiApiKey');
  const openaiModelSelect = document.getElementById('openaiModel');
  const deepseekApiKeyInput = document.getElementById('deepseekApiKey');
  const deepseekModelSelect = document.getElementById('deepseekModel');
  const customApiNameInput = document.getElementById('customApiName');
  const customApiEndpointInput = document.getElementById('customApiEndpoint');
  const customApiKeyInput = document.getElementById('customApiKey');
  const customApiModelInput = document.getElementById('customApiModel');
  const customApiHeadersInput = document.getElementById('customApiHeaders');
  
  const encryptionEnabledInput = document.getElementById('encryptionEnabled');
  const saveButton = document.querySelector('button[type="submit"]');
  const testConnectionBtn = document.getElementById('testConnectionBtn');
  const statusMessage = document.createElement('div');
  
  // Create connection status element
  const connectionStatus = document.createElement('div');
  connectionStatus.className = 'connection-status';
  connectionStatus.innerHTML = '<span class="status-indicator"></span> <span class="status-text">Not tested</span>';
  
  // Add connection status below all API settings
  allApiSettings.forEach(setting => {
    const statusClone = connectionStatus.cloneNode(true);
    setting.appendChild(statusClone);
  });
  
  // Setup status message element
  statusMessage.className = 'status-message';
  settingsForm.appendChild(statusMessage);
  
  // Encryption helpers
  const encryptionKey = 'summarize-me-extension-key';
  
  // Function to encrypt sensitive data
  async function encryptData(data) {
    if (!encryptionEnabledInput.checked) {
      return btoa(data); // Simple base64 encoding if encryption is disabled
    }
    
    try {
      // Create a random initialization vector
      const iv = crypto.getRandomValues(new Uint8Array(12));
      
      // Convert the encryption key to a CryptoKey
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
        ["encrypt"]
      );
      
      // Encrypt the data
      const encrypted = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: iv
        },
        key,
        new TextEncoder().encode(data)
      );
      
      // Combine the IV and encrypted data and convert to base64
      const encryptedArray = new Uint8Array(iv.byteLength + encrypted.byteLength);
      encryptedArray.set(iv, 0);
      encryptedArray.set(new Uint8Array(encrypted), iv.byteLength);
      
      return btoa(String.fromCharCode.apply(null, encryptedArray));
    } catch (error) {
      console.error('Encryption error:', error);
      // Fallback to base64 if encryption fails
      return btoa(data);
    }
  }
  
  // Function to decrypt sensitive data
  async function decryptData(encryptedData) {
    if (!encryptedData) return '';
    
    try {
      // If it's just base64 (no encryption), decode it
      if (!encryptionEnabledInput.checked) {
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
  
  // Load saved settings
  async function loadSettings() {
    chrome.storage.sync.get([
      'summarizerType', 
      'localLlmUrl', 
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
      'encryptionEnabled'
    ], async (result) => {
      const summarizerType = result.summarizerType || 'local';
      const localLlmUrl = result.localLlmUrl || 'http://localhost:1234/v1';
      const encryptionEnabled = result.encryptionEnabled !== undefined ? result.encryptionEnabled : true;
      
      // Decrypt sensitive data
      encryptionEnabledInput.checked = encryptionEnabled;
      
      // Set values for all inputs
      localLlmUrlInput.value = localLlmUrl;
      
      if (result.encryptedGroqApiKey) {
        groqApiKeyInput.value = await decryptData(result.encryptedGroqApiKey);
      }
      
      if (result.groqModel) {
        groqModelSelect.value = result.groqModel;
      }
      
      if (result.encryptedOpenaiApiKey) {
        openaiApiKeyInput.value = await decryptData(result.encryptedOpenaiApiKey);
      }
      
      if (result.openaiModel) {
        openaiModelSelect.value = result.openaiModel;
      }
      
      if (result.encryptedDeepseekApiKey) {
        deepseekApiKeyInput.value = await decryptData(result.encryptedDeepseekApiKey);
      }
      
      if (result.deepseekModel) {
        deepseekModelSelect.value = result.deepseekModel;
      }
      
      if (result.customApiName) {
        customApiNameInput.value = result.customApiName;
      }
      
      if (result.customApiEndpoint) {
        customApiEndpointInput.value = result.customApiEndpoint;
      }
      
      if (result.encryptedCustomApiKey) {
        customApiKeyInput.value = await decryptData(result.encryptedCustomApiKey);
      }
      
      if (result.customApiModel) {
        customApiModelInput.value = result.customApiModel;
      }
      
      if (result.customApiHeaders) {
        customApiHeadersInput.value = result.customApiHeaders;
      }
      
      // Set the radio button based on saved type
      for (const input of summarizerTypeInputs) {
        if (input.value === summarizerType) {
          input.checked = true;
          break;
        }
      }
      
      // Show the appropriate settings section
      updateVisibleSettings(summarizerType);
      
      // Validate current API key if one is set
      if (summarizerType !== 'local') {
        validateCurrentProvider();
      }
    });
  }
  
  // Load settings on page load
  loadSettings();
  
  // Handle radio button changes to show/hide appropriate settings
  function updateVisibleSettings(selectedType) {
    // Hide all API settings
    allApiSettings.forEach(setting => setting.style.display = 'none');
    
    // Show local settings by default
    localSettings.style.display = 'block';
    
    // Show the selected API settings if not local
    switch (selectedType) {
      case 'local':
        break;
      case 'groq':
        groqSettings.style.display = 'block';
        break;
      case 'openai':
        openaiSettings.style.display = 'block';
        break;
      case 'deepseek':
        deepseekSettings.style.display = 'block';
        break;
      case 'custom':
        customSettings.style.display = 'block';
        break;
    }
  }
  
  // Handle radio button changes
  for (const input of summarizerTypeInputs) {
    input.addEventListener('change', (e) => {
      updateVisibleSettings(e.target.value);
      validateCurrentProvider();
    });
  }
  
  // Test connection button
  testConnectionBtn.addEventListener('click', () => {
    validateCurrentProvider();
  });
  
  // Get the active provider type and settings
  function getActiveProvider() {
    let type = 'local';
    for (const input of summarizerTypeInputs) {
      if (input.checked) {
        type = input.value;
        break;
      }
    }
    
    return type;
  }
  
  // Validate the current provider's API key
  async function validateCurrentProvider() {
    const type = getActiveProvider();
    if (type === 'local') return;
    
    // Find the relevant connection status element
    let statusElement;
    let apiKey = '';
    let modelValue = '';
    let endpoint = '';
    let headers = {};
    
    switch (type) {
      case 'groq':
        statusElement = groqSettings.querySelector('.connection-status');
        apiKey = groqApiKeyInput.value.trim();
        modelValue = groqModelSelect.value;
        break;
      case 'openai':
        statusElement = openaiSettings.querySelector('.connection-status');
        apiKey = openaiApiKeyInput.value.trim();
        modelValue = openaiModelSelect.value;
        break;
      case 'deepseek':
        statusElement = deepseekSettings.querySelector('.connection-status');
        apiKey = deepseekApiKeyInput.value.trim();
        modelValue = deepseekModelSelect.value;
        break;
      case 'custom':
        statusElement = customSettings.querySelector('.connection-status');
        apiKey = customApiKeyInput.value.trim();
        modelValue = customApiModelInput.value.trim();
        endpoint = customApiEndpointInput.value.trim();
        try {
          headers = JSON.parse(customApiHeadersInput.value || '{}');
        } catch (e) {
          updateConnectionStatus(statusElement, false, 'Invalid headers JSON');
          return;
        }
        break;
    }
    
    if (!apiKey) {
      updateConnectionStatus(statusElement, false, 'No API key provided');
      return;
    }
    
    updateConnectionStatus(statusElement, null, 'Testing connection...');
    
    try {
      const result = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { 
            action: 'validateApiConnection', 
            data: { 
              provider: type,
              apiKey,
              model: modelValue,
              endpoint,
              headers
            } 
          },
          (response) => resolve(response)
        );
      });
      
      updateConnectionStatus(
        statusElement,
        result.success && result.isValid, 
        result.isValid ? 'Connected successfully' : result.message || 'Connection failed'
      );
      
      return result.success && result.isValid;
    } catch (error) {
      console.error(`${type} API validation error:`, error);
      updateConnectionStatus(statusElement, false, 'Connection error');
      return false;
    }
  }
  
  // Update connection status display
  function updateConnectionStatus(statusElement, isConnected, message) {
    const indicator = statusElement.querySelector('.status-indicator');
    const text = statusElement.querySelector('.status-text');
    
    if (isConnected === null) {
      // Unknown state
      indicator.className = 'status-indicator unknown';
    } else if (isConnected) {
      // Connected
      indicator.className = 'status-indicator connected';
    } else {
      // Not connected
      indicator.className = 'status-indicator disconnected';
    }
    
    text.textContent = message;
  }
  
  // Save settings
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    saveButton.disabled = true;
    statusMessage.textContent = 'Validating settings...';
    statusMessage.className = 'status-message info';
    
    // Get the selected summarizer type
    let summarizerType = 'local';
    for (const input of summarizerTypeInputs) {
      if (input.checked) {
        summarizerType = input.value;
        break;
      }
    }
    
    // Get other values
    const localLlmUrl = localLlmUrlInput.value.trim() || 'http://localhost:1234/v1';
    const groqApiKey = groqApiKeyInput.value.trim();
    const groqModel = groqModelSelect.value;
    const openaiApiKey = openaiApiKeyInput.value.trim();
    const openaiModel = openaiModelSelect.value;
    const deepseekApiKey = deepseekApiKeyInput.value.trim();
    const deepseekModel = deepseekModelSelect.value;
    const customApiName = customApiNameInput.value.trim();
    const customApiEndpoint = customApiEndpointInput.value.trim();
    const customApiKey = customApiKeyInput.value.trim();
    const customApiModel = customApiModelInput.value.trim();
    const customApiHeaders = customApiHeadersInput.value.trim();
    const encryptionEnabled = encryptionEnabledInput.checked;
    
    // Validate if selected provider is valid
    if (summarizerType !== 'local') {
      const isValid = await validateCurrentProvider();
      
      if (!isValid) {
        statusMessage.textContent = `Invalid ${summarizerType.toUpperCase()} API settings. Please check your API key and other settings.`;
        statusMessage.className = 'status-message error';
        saveButton.disabled = false;
        return;
      }
    }
    
    // Encrypt sensitive data
    const encryptedGroqApiKey = groqApiKey ? await encryptData(groqApiKey) : '';
    const encryptedOpenaiApiKey = openaiApiKey ? await encryptData(openaiApiKey) : '';
    const encryptedDeepseekApiKey = deepseekApiKey ? await encryptData(deepseekApiKey) : '';
    const encryptedCustomApiKey = customApiKey ? await encryptData(customApiKey) : '';
    
    // Save to storage
    chrome.storage.sync.set({
      summarizerType,
      localLlmUrl,
      encryptedGroqApiKey,
      groqModel,
      encryptedOpenaiApiKey,
      openaiModel,
      encryptedDeepseekApiKey,
      deepseekModel,
      customApiName,
      customApiEndpoint,
      encryptedCustomApiKey,
      customApiModel,
      customApiHeaders,
      encryptionEnabled
    }, () => {
      // Show success message
      statusMessage.textContent = 'Settings saved successfully!';
      statusMessage.className = 'status-message success';
      saveButton.disabled = false;
      
      // Remove message after 3 seconds
      setTimeout(() => {
        statusMessage.textContent = '';
      }, 3000);
    });
  });

  // Add local LLM test functionality
  const testLocalLlmBtn = document.getElementById('testLocalLlmBtn');
  const localLlmStatus = document.getElementById('localLlmStatus');
  const localLlmUrl = document.getElementById('localLlmUrl');
  
  if (testLocalLlmBtn && localLlmStatus) {
    testLocalLlmBtn.addEventListener('click', async function() {
      // Get the current URL from the input
      const url = localLlmUrl.value.trim();
      
      if (!url) {
        localLlmStatus.textContent = 'Please enter a URL first';
        localLlmStatus.className = 'connection-status status-error';
        return;
      }
      
      // Update status to testing
      localLlmStatus.textContent = 'Testing connection...';
      localLlmStatus.className = 'connection-status status-pending';
      
      // Add a timeout for UI feedback
      let responseReceived = false;
      const uiTimeout = setTimeout(() => {
        if (!responseReceived) {
          localLlmStatus.textContent = 'Connection test is taking longer than expected...';
          localLlmStatus.className = 'connection-status status-pending';
        }
      }, 5000);
      
      // Call the background script to test the connection
      chrome.runtime.sendMessage(
        { 
          action: 'testLocalLlm', 
          url: url 
        },
        function(response) {
          responseReceived = true;
          clearTimeout(uiTimeout);
          
          if (!response) {
            localLlmStatus.textContent = 'Connection test failed';
            localLlmStatus.className = 'connection-status status-error';
            return;
          }
          
          const status = response.status;
          
          if (status.connected && status.modelLoaded) {
            // Get model details
            const modelName = status.activeModel?.name || status.activeModel?.id || 'LM Studio';
            const modelId = status.activeModel?.id || 'unknown';
            
            // Show more comprehensive status with HTML entity instead of Unicode character
            localLlmStatus.innerHTML = `
              <div class="status-success"><span class="checkmark"></span> Connected successfully</div>
              <div class="model-details">
                <strong>Model:</strong> ${modelName}<br>
                <strong>ID:</strong> ${modelId}
              </div>
            `;
            localLlmStatus.className = 'connection-status status-success';
            
            // Add style for model details
            const style = document.createElement('style');
            style.textContent = `
              .model-details {
                margin-top: 5px;
                font-size: 12px;
                line-height: 1.4;
                padding: 5px;
                background: #f8f8f8;
                border-radius: 3px;
              }
              .checkmark {
                display: inline-block;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                background-color: #2e7d32;
                position: relative;
              }
              .checkmark:after {
                content: '';
                position: absolute;
                width: 5px;
                height: 8px;
                border: solid white;
                border-width: 0 2px 2px 0;
                transform: rotate(45deg);
                top: 1px;
                left: 4px;
              }
            `;
            document.head.appendChild(style);
          } else if (status.connected) {
            localLlmStatus.textContent = '⚠️ Connected to LM Studio, but no model is loaded';
            localLlmStatus.className = 'connection-status status-pending';
          } else {
            localLlmStatus.textContent = `❌ ${status.error || 'Connection failed'}`;
            localLlmStatus.className = 'connection-status status-error';
          }
        }
      );
    });
  }

  // Load the saved settings including local LLM URL
  chrome.storage.sync.get(['localLlmUrl'], function(data) {
    if (data.localLlmUrl && localLlmUrl) {
      localLlmUrl.value = data.localLlmUrl;
    }
  });
  
  // Save the local LLM URL when it changes
  if (localLlmUrl) {
    localLlmUrl.addEventListener('change', function() {
      chrome.storage.sync.set({ localLlmUrl: localLlmUrl.value });
      // Clear the status when URL changes
      if (localLlmStatus) {
        localLlmStatus.textContent = '';
        localLlmStatus.className = 'connection-status';
      }
    });
  }

  // Update the radio button event handler in settings.js
  function handleSummarizerTypeChange() {
    // Get the selected summarizer type
    const selectedType = document.querySelector('input[name="summarizerType"]:checked').value;
    
    // Hide all API settings sections first
    document.querySelectorAll('.setting.api-setting, #localSettings').forEach(section => {
      section.style.display = 'none';
    });
    
    // Show the selected section
    switch (selectedType) {
      case 'groq':
        document.getElementById('groqSettings').style.display = 'block';
        break;
      case 'openai':
        document.getElementById('openaiSettings').style.display = 'block';
        break;
      case 'deepseek':
        document.getElementById('deepseekSettings').style.display = 'block';
        break;
      case 'custom':
        document.getElementById('customSettings').style.display = 'block';
        break;
      case 'local':
        document.getElementById('localSettings').style.display = 'block';
        break;
    }
  }

  // Make sure the local settings element is properly marked for hiding
  document.getElementById('localSettings').className = 'setting local-setting';

  // Add event listeners to all radio buttons
  document.querySelectorAll('input[name="summarizerType"]').forEach(radio => {
    radio.addEventListener('change', handleSummarizerTypeChange);
  });

  // Call the function on load to set initial state
  handleSummarizerTypeChange();
}); 