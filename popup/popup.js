document.addEventListener('DOMContentLoaded', () => {
  const summarizeBtn = document.getElementById('summarizeBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const loader = document.getElementById('loader');
  const pageTitle = document.getElementById('pageTitle');
  const summaryContent = document.getElementById('summaryContent');
  const statusMessage = document.createElement('div');
  
  // Chat elements
  const chatInput = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const chatMessages = document.getElementById('chatMessages');
  
  // Chat context storage
  let pageContext = {
    title: '',
    url: '',
    summary: '',
    history: []
  };
  let isChatProcessing = false;
  
  // Create progress elements
  const progressContainer = document.createElement('div');
  progressContainer.className = 'progress-container';
  progressContainer.style.display = 'none';
  
  const progressBar = document.createElement('div');
  progressBar.className = 'progress-bar';
  
  const progressFill = document.createElement('div');
  progressFill.className = 'progress-fill';
  
  const progressText = document.createElement('div');
  progressText.className = 'progress-text';
  progressText.textContent = '0%';
  
  const progressStatus = document.createElement('div');
  progressStatus.className = 'progress-status';
  
  // Assemble progress elements
  progressBar.appendChild(progressFill);
  progressContainer.appendChild(progressBar);
  progressContainer.appendChild(progressText);
  progressContainer.appendChild(progressStatus);
  
  // Add to the container
  document.querySelector('.container').appendChild(progressContainer);
  
  // Add API status indicator
  const apiStatusContainer = document.createElement('div');
  apiStatusContainer.className = 'api-status-container';
  
  const apiStatusLabel = document.createElement('div');
  apiStatusLabel.className = 'api-status-label';
  apiStatusLabel.textContent = 'Groq API:';
  
  const apiStatus = document.createElement('div');
  apiStatus.className = 'api-status';
  apiStatus.innerHTML = '<span class="status-indicator unknown"></span> <span class="status-text">Checking...</span>';
  
  apiStatusContainer.appendChild(apiStatusLabel);
  apiStatusContainer.appendChild(apiStatus);
  
  // Insert after the controls
  const controlsDiv = document.querySelector('.controls');
  controlsDiv.parentNode.insertBefore(apiStatusContainer, controlsDiv.nextSibling);
  
  // Check API connection status
  checkApiStatus();
  
  // Add status message to popup
  statusMessage.className = 'status-message';
  document.querySelector('.container').appendChild(statusMessage);
  
  // Track the current summarization task
  let currentTaskId = null;
  
  // Check for active summarization when popup opens
  chrome.runtime.sendMessage({ action: 'checkActiveSummarization' }, (response) => {
    if (response && response.hasActiveTask) {
      // Resume the active task
      currentTaskId = response.task.taskId;
      pageTitle.textContent = response.task.title;
      showProgressUI();
      summarizeBtn.disabled = true;
    }
  });

  // Handle progress updates and completion
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'summarizationProgress' && currentTaskId === message.data.taskId) {
      updateProgress(message.data.percentage, message.data.status);
    }
    
    if (message.action === 'summarizationComplete' && currentTaskId === message.data.taskId) {
      handleSummarizationComplete(message.data);
    }
    
    if (message.action === 'chatResponse') {
      handleChatResponse(message.data);
    }
    
    // Need to return false as we're not using sendResponse
    return false;
  });

  // Handle summarize button click
  summarizeBtn.addEventListener('click', async () => {
    if (currentTaskId) return; // Prevent multiple tasks
    
    showProgressUI();
    summarizeBtn.disabled = true;
    statusMessage.textContent = '';
    
    // Clear previous chat
    chatMessages.innerHTML = '';
    chatInput.disabled = true;
    sendBtn.disabled = true;
    pageContext.history = [];
    
    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Send message to content script to scrape the page
      chrome.tabs.sendMessage(tab.id, { action: 'scrapeContent' }, async (response) => {
        if (chrome.runtime.lastError) {
          hideProgressUI();
          showError('Failed to connect to page. Please refresh and try again.');
          summarizeBtn.disabled = false;
          return;
        }
        
        if (!response || !response.success) {
          hideProgressUI();
          showError('Failed to scrape content. Please try again.');
          summarizeBtn.disabled = false;
          return;
        }
        
        const { title, content } = response;
        pageTitle.textContent = title;
        
        // Save current page context
        pageContext.title = title;
        pageContext.url = tab.url;
        
        // Send content to background script for summarization
        chrome.runtime.sendMessage({
          action: 'summarize',
          data: { title, content, url: tab.url }
        }, (response) => {
          if (chrome.runtime.lastError || !response) {
            hideProgressUI();
            showError('Failed to start summarization. Please try again.');
            summarizeBtn.disabled = false;
            return;
          }
          
          // Store the task ID for tracking
          if (response.inProgress && response.taskId) {
            currentTaskId = response.taskId;
          }
        });
      });
    } catch (error) {
      hideProgressUI();
      showError(`Error: ${error.message}`);
      summarizeBtn.disabled = false;
    }
  });
  
  // Open settings page
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  // Handle chat input
  sendBtn.addEventListener('click', () => {
    sendChatMessage();
  });
  
  // Support Enter key to send message (Shift+Enter for new line)
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
  
  function sendChatMessage() {
    const question = chatInput.value.trim();
    if (!question || isChatProcessing) return;
    
    // Show user message
    addChatMessage(question, 'user');
    chatInput.value = '';
    
    // Show thinking indicator
    const thinkingEl = document.createElement('div');
    thinkingEl.className = 'chat-thinking';
    thinkingEl.textContent = 'Thinking...';
    chatMessages.appendChild(thinkingEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Disable input while processing
    isChatProcessing = true;
    chatInput.disabled = true;
    sendBtn.disabled = true;
    
    // Get the current tab URL for context
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url || '';
      
      // Send question to background script
      chrome.runtime.sendMessage({
        action: 'chat',
        data: {
          question,
          context: pageContext
        }
      });
    });
  }
  
  function handleChatResponse(data) {
    // Remove thinking indicator
    const thinkingEl = document.querySelector('.chat-thinking');
    if (thinkingEl) thinkingEl.remove();
    
    if (data.error) {
      addChatMessage('Sorry, I encountered an error: ' + data.error, 'ai');
    } else {
      addChatMessage(data.response, 'ai');
      
      // Update chat history
      pageContext.history.push(
        { role: 'user', content: data.question },
        { role: 'assistant', content: data.response }
      );
    }
    
    // Re-enable input
    isChatProcessing = false;
    chatInput.disabled = false;
    sendBtn.disabled = false;
    chatInput.focus();
  }
  
  function addChatMessage(message, role) {
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${role}-message`;
    messageEl.textContent = message;
    chatMessages.appendChild(messageEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  
  // Update progress UI
  function updateProgress(percentage, status) {
    progressFill.style.width = `${percentage}%`;
    progressText.textContent = `${percentage}%`;
    progressStatus.textContent = status || '';
  }
  
  // Show progress UI
  function showProgressUI() {
    loader.style.display = 'none';
    progressContainer.style.display = 'block';
    summaryContent.innerHTML = '<p class="placeholder">Processing...</p>';
    updateProgress(0, 'Starting...');
  }
  
  // Hide progress UI
  function hideProgressUI() {
    progressContainer.style.display = 'none';
    currentTaskId = null;
  }
  
  // Handle summarization completion
  function handleSummarizationComplete(data) {
    hideProgressUI();
    summarizeBtn.disabled = false;
    
    if (!data.success) {
      showError(`Failed to generate summary: ${data.error}`);
      return;
    }
    
    summaryContent.innerHTML = `<p>${data.summary}</p>`;
    
    // Save the summary for chat context
    pageContext.summary = data.summary;
    
    // Enable chat functionality
    chatInput.disabled = false;
    sendBtn.disabled = false;
    
    // Add initial message
    chatMessages.innerHTML = '';
    addChatMessage('I can answer questions about this page. What would you like to know?', 'ai');
    
    // Show status messages
    if (data.contentTruncated) {
      const truncatedMessage = document.createElement('div');
      truncatedMessage.className = 'truncated-notice';
      truncatedMessage.textContent = 'Note: Content was truncated due to length. This summary covers only the beginning portion of the page.';
      summaryContent.appendChild(truncatedMessage);
    }
    
    // Show fallback message if we used Local LLM as fallback
    if (data.usedFallback) {
      statusMessage.textContent = 'Notice: Groq API failed. Summary was generated using Local LLM instead. Please check your API key in settings.';
      statusMessage.className = 'status-message warning';
      
      // Update API status if fallback occurred
      updateApiStatus(false, 'Connection failed');
    }
  }
  
  function showError(message) {
    summaryContent.innerHTML = `<p class="error">${message}</p>`;
    currentTaskId = null;
    summarizeBtn.disabled = false;
  }
  
  // Function to check API connection status
  async function checkApiStatus() {
    // Get stored settings
    chrome.storage.sync.get(['summarizerType'], async (result) => {
      const summarizerType = result.summarizerType || 'local';
      
      // Update the API status label based on provider
      let providerName = 'API';
      switch (summarizerType) {
        case 'local':
          providerName = 'Local LLM';
          updateApiStatus(null, 'Using Local LLM');
          break;
        case 'groq':
          providerName = 'Groq API';
          testApiConnection('groq');
          break;
        case 'openai':
          providerName = 'OpenAI API';
          testApiConnection('openai');
          break;
        case 'deepseek':
          providerName = 'Deepseek API';
          testApiConnection('deepseek');
          break;
        case 'custom':
          // Get custom provider name
          chrome.storage.sync.get(['customApiName'], (customResult) => {
            const customName = customResult.customApiName || 'Custom API';
            apiStatusLabel.textContent = `${customName}:`;
            testApiConnection('custom');
          });
          return; // Handle custom separately due to async
      }
      
      apiStatusLabel.textContent = `${providerName}:`;
    });
  }
  
  // Function to test API connection
  async function testApiConnection(provider) {
    updateApiStatus(null, 'Checking...');
    
    try {
      const result = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { 
            action: 'validateApiConnection', 
            data: { provider }
          },
          (response) => resolve(response)
        );
      });
      
      updateApiStatus(
        result.success && result.isValid, 
        result.isValid ? 'Connected' : (result.message || 'Connection failed')
      );
    } catch (error) {
      console.error(`Error checking ${provider} API status:`, error);
      updateApiStatus(false, 'Connection error');
    }
  }
  
  // Function to update API status display
  function updateApiStatus(isConnected, message) {
    const indicator = apiStatus.querySelector('.status-indicator');
    const text = apiStatus.querySelector('.status-text');
    
    if (isConnected === null) {
      // Unknown or not applicable state
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

  // Enhanced monitoring function
  function monitorSummarizationProgress() {
    chrome.storage.local.get(['activeSummarizationTask'], (result) => {
      const task = result.activeSummarizationTask;
      const resetBtn = document.getElementById('reset-btn');
      
      if (task) {
        const currentTime = Date.now();
        const elapsedTime = currentTime - task.timestamp;
        
        // After 30 seconds, show the reset button
        if (elapsedTime > 30000) {
          if (resetBtn) resetBtn.style.display = 'block';
        }
        
        // After 3 minutes, auto-reset
        if (elapsedTime > 180000) {
          console.log('Detected stuck summarization task, cleaning up...');
          
          // Clear the stuck task
          chrome.storage.local.remove('activeSummarizationTask');
          
          // Update UI to show error
          const progressBar = document.getElementById('progress-bar');
          const progressText = document.getElementById('progress-text');
          const summary = document.getElementById('summary');
          
          if (progressBar) progressBar.style.width = '0%';
          if (progressText) progressText.textContent = 'Process timed out';
          if (summary) {
            summary.textContent = 'The summarization process timed out. This might happen if:'
              + '\n\n1. LM Studio is not running or crashed'
              + '\n2. The model is taking too long to respond'
              + '\n3. The content is too large for the model to process'
              + '\n\nPlease try again with a smaller section of content or check LM Studio.';
          }
          
          // Enable the summarize button again
          const summarizeBtn = document.getElementById('summarize-btn');
          if (summarizeBtn) summarizeBtn.disabled = false;
          
          // Hide the reset button
          if (resetBtn) resetBtn.style.display = 'none';
        }
      } else {
        // No active task, hide reset button
        if (resetBtn) resetBtn.style.display = 'none';
      }
    });
  }

  // Immediately check for and clear any stuck tasks
  chrome.storage.local.get(['activeSummarizationTask'], (result) => {
    const task = result.activeSummarizationTask;
    
    if (task) {
      // Check if the task is older than 2 minutes
      const currentTime = Date.now();
      const elapsedTime = currentTime - task.timestamp;
      
      if (elapsedTime > 120000) { // 2 minutes
        console.log('Found a stuck task on popup open, cleaning up...');
        chrome.storage.local.remove('activeSummarizationTask');
        
        // If we have progress elements already, update them
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');
        if (progressBar) progressBar.style.width = '0%';
        if (progressText) progressText.textContent = 'Ready';
      }
    }
  });

  // Add a reset button to the popup.html
  // Add this HTML to popup.html, near the progress bar:
  // <button id="reset-btn" class="reset-button">Reset</button>

  // Then add this to popup.js:
  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      // Force clear any active tasks
      chrome.storage.local.remove('activeSummarizationTask');
      
      // Reset UI
      if (progressBar) progressBar.style.width = '0%';
      if (progressText) progressText.textContent = 'Ready';
      summarizeBtn.disabled = false;
      
      // Update summary area
      summaryContent.textContent = 'Summarization has been reset. You can try again.';
      
      console.log('Summarization process manually reset by user');
    });
  }

  // Reduce the monitoring interval to check more frequently
  setInterval(monitorSummarizationProgress, 15000); // Check every 15 seconds instead of every minute
}); 