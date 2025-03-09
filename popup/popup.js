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
    chrome.storage.sync.get(['summarizerType', 'groqApiKey'], async (result) => {
      const summarizerType = result.summarizerType || 'local';
      const groqApiKey = result.groqApiKey || '';
      
      // If using local LLM, show that instead
      if (summarizerType === 'local') {
        updateApiStatus(null, 'Using Local LLM');
        return;
      }
      
      // If no API key, show not configured
      if (!groqApiKey) {
        updateApiStatus(false, 'Not configured');
        return;
      }
      
      // Test the API key
      try {
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { 
              action: 'validateGroqApiKey', 
              data: { apiKey: groqApiKey } 
            },
            (response) => resolve(response)
          );
        });
        
        updateApiStatus(
          response.success && response.isValid, 
          response.isValid ? 'Connected' : 'Connection failed'
        );
      } catch (error) {
        console.error('Error checking API status:', error);
        updateApiStatus(false, 'Connection error');
      }
    });
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
}); 