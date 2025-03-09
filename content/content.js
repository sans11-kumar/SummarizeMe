// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'scrapeContent') {
    try {
      // Extract title
      const title = document.title || '';
      
      // Extract content based on page type
      let content = '';
      
      // For articles and blogs - prioritize main content
      const articleContent = getArticleContent();
      if (articleContent) {
        content = articleContent;
      } else {
        // Fallback to grab all visible text
        content = getAllVisibleText();
      }
      
      sendResponse({ success: true, title, content });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }
});

// Extract content from article-like pages
function getArticleContent() {
  // Try to find the main content by common selectors
  const selectors = [
    'article', 
    '[role="main"]', 
    '.post-content', 
    '.article-content',
    '.content-body',
    'main',
    '#content'
  ];
  
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element.textContent.trim();
    }
  }
  
  // Special handling for video pages (YouTube, etc.)
  if (window.location.hostname.includes('youtube.com')) {
    const title = document.querySelector('h1.title')?.textContent || '';
    const description = document.querySelector('#description-text')?.textContent || '';
    return `${title}\n\n${description}`;
  }
  
  return null;
}

// Get all visible text as fallback
function getAllVisibleText() {
  // Skip script, style, and hidden elements
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        const element = node.parentElement;
        const style = window.getComputedStyle(element);
        
        if (
          element.tagName === 'SCRIPT' || 
          element.tagName === 'STYLE' || 
          element.tagName === 'NOSCRIPT' ||
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.opacity === '0'
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  
  let text = '';
  let node;
  while (node = walker.nextNode()) {
    text += node.textContent.trim() + ' ';
  }
  
  return text.trim();
} 