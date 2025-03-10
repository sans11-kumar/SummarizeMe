# Summarize Me - Web Content Summarizer Extension

A Chrome extension that summarizes web content using either a local LLM through LM Studio or various API providers.

## Features

- Summarize any web page with a single click
- Ask follow-up questions about the content
- Multiple LLM providers:
  - Local LLM via LM Studio (no API keys needed!)
  - Groq API
  - OpenAI API
  - Deepseek API
  - Custom API support
- Secure API key storage with encryption
- Automatic provider fallback if one fails

## Installation

1. Download the extension files
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top-right corner
4. Click "Load unpacked" and select the extension folder
5. The extension icon will appear in your toolbar

## Setup and Usage

### Local LLM Setup (Recommended)

1. Download and install [LM Studio](https://lmstudio.ai/)
2. Start LM Studio and load a model (recommended: Deepseek Qwen 7B)
3. Start the local server in LM Studio
4. In the extension settings, ensure "Local LLM" is selected
5. Click the "Test Connection" button to verify LM Studio is working

### Using Cloud API Providers

1. Open the extension settings and select your preferred provider
2. Enter your API key for the selected provider
3. Choose the model you want to use
4. Save your settings

### Summarizing Content

1. Navigate to any webpage you want to summarize
2. Click the extension icon in your toolbar
3. Press "Summarize This Page"
4. Wait for the summary to generate
5. Use the chat interface to ask follow-up questions

## Troubleshooting

### Local LLM Issues

- **Connection error**: Make sure LM Studio is running and the server is started
- **No model loaded**: Load a model in LM Studio and restart the server
- **Slow responses**: Consider using a smaller model in LM Studio
- **API URL format**: The default URL is `http://localhost:1234/v1` - change only if you've configured LM Studio differently

### API Provider Issues

- **Invalid API key**: Double-check your API key for typos
- **Connection timeouts**: There might be network issues or the provider might be experiencing high traffic
- **Model not available**: Some models might be restricted by the provider - try a different model

## Privacy and Security

- API keys are stored locally on your device
- Optional encryption is available for added security
- No data is sent to our servers - all processing happens either locally or directly with your chosen provider

## Support

For issues, questions, or contributions, please visit our GitHub repository.

## Project Structure

```
summarize-me/
├── manifest.json         # Extension configuration
├── README.md             # Documentation
├── project_explanation.md # Technical architecture documentation
├── background/           # Service worker and AI processing
│   ├── background.js     # Main background script
│   └── rag/              # Retrieval-Augmented Generation
│       └── embedder-impl.js # Content embedding implementation
├── llm/                  # LLM processing components
│   ├── llm_worker.js     # Worker for non-blocking LLM operations
│   ├── embedder.js       # Handles text embeddings
│   ├── rag.js            # RAG component for context retrieval
│   └── llm_processor.js  # LLM inference handling
├── popup/                # Extension popup UI
│   ├── popup.html        # Popup HTML structure with chat interface
│   ├── popup.css         # Popup styling
│   └── popup.js          # Popup interaction logic
├── content/              # Content scripts
│   └── content.js        # Scrapes webpage content
├── settings/             # Settings page
│   ├── settings.html     # Settings UI with multiple providers
│   ├── settings.css      # Settings styling
│   └── settings.js       # Settings logic with encryption
└── icons/                # Extension icons
    ├── icon16.png        # 16x16 icon
    ├── icon48.png        # 48x48 icon
    └── icon128.png       # 128x128 icon
```

### Key Directories Explained

- **background/**: Contains the service worker that runs in the background. The `rag/` subdirectory holds components for retrieval-augmented generation.

- **llm/**: Handles all language model operations in a separate worker thread to avoid blocking the UI. This includes text processing, summarization, and context-aware responses.

- **popup/**: The user interface that appears when clicking the extension icon, showing summarized content and the chat interface.

- **content/**: Scripts that are injected into web pages to extract content for summarization.

- **settings/**: The configuration page where users can select providers and enter API keys.

## Limitations

- Local LLM option requires LM Studio to be running in the background
- Long pages will be truncated based on the token limits of the selected provider
- Some pages with complex layouts may not be scraped correctly
- API providers may have rate limits or costs associated with their use

## Tools Used

- Chrome Extension APIs
- LM Studio for local LLM inference
- Web Crypto API for secure encryption
- Various LLM APIs (Groq, OpenAI, Deepseek, etc.)

## Architecture Overview

The extension uses a modular architecture with clear separation of concerns:

1. **User Interface Layer**:
   - `popup/` provides the main UI for viewing summaries and chatting
   - `settings/` handles configuration options

2. **Background Processing Layer**:
   - `background/background.js` coordinates activities and manages communication
   - Handles provider selection and API integration

3. **Content Processing Layer**:
   - `content/content.js` extracts text content from web pages
   - Handles DOM traversal and content cleaning

4. **LLM Processing Layer**:
   - `llm/` directory contains all LLM-related processing
   - Uses a worker thread for non-blocking operations
   - Manages RAG pipeline for context-aware responses

5. **Storage Layer**:
   - Uses Chrome's storage APIs for persistence
   - Securely handles API keys and user preferences

This layered approach ensures separation of concerns, making the extension easier to maintain and extend.

## Conclusion

The project has a sensible structure overall, but there are some redundancies and the documentation doesn't fully explain the purpose
