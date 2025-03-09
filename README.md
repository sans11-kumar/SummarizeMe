# Summarize Me Chrome Extension

A Chrome extension that allows you to summarize web content and ask follow-up questions using multiple LLM providers, including local options and various cloud APIs.

## Features

- Record any URL (blog/video)
- Scrape the title and content of the page
- Generate concise summaries using AI
- Interactive chat interface to ask follow-up questions
- Multiple LLM provider options with smart fallback
- Secure, encrypted storage for API keys
- Progress tracking during summarization
- Content length optimization for each provider

## Supported LLM Providers

- **Local LLM**: Run locally via LM Studio (no API key needed)
- **Groq API**: Fast, efficient models like Llama-3 and Mixtral
- **OpenAI API**: GPT-3.5 Turbo, GPT-4, and GPT-4 Turbo
- **Deepseek API**: Deepseek Chat and Coder models
- **Custom API**: Support for any OpenAI-compatible API endpoint

## Installation

### From Source

1. Clone or download this repository
2. **Create the icon files**: Before loading the extension, make sure to create icon files in the `icons` directory:
   - Create `icon16.png` (16x16 pixels)
   - Create `icon48.png` (48x48 pixels)
   - Create `icon128.png` (128x128 pixels)
   - You can use tools like Canva, favicon.cc, or Flaticon to create these icons
3. Open Chrome and navigate to `chrome://extensions/`
4. Enable "Developer mode" in the top right
5. Click "Load unpacked" and select this extension directory
6. The extension should now be installed and visible in your toolbar

## Setup

### Local LLM (No API Key Required)

1. Download and install [LM Studio](https://lmstudio.ai/)
2. Open LM Studio and download the `deepseek-r1-distill-qwen-7b` model
3. Start the local server in LM Studio (it should run on http://localhost:1234 by default)
4. Click the extension icon and go to Settings
5. Select "Local LLM" as the summarization method
6. Enter the local API URL (default: http://localhost:1234/v1)
7. Save settings

### Groq API

1. Sign up for a [Groq account](https://groq.com/) and get an API key
2. Click the extension icon and go to Settings
3. Select "Groq API" as the summarization method
4. Enter your Groq API key
5. Choose a model from the dropdown (Llama-3 8B, Llama-3 70B, or Mixtral)
6. Click "Test Connection" to verify your API key works
7. Save settings

### OpenAI API

1. Sign up for an [OpenAI account](https://openai.com/) and get an API key
2. Click the extension icon and go to Settings
3. Select "OpenAI API" as the summarization method
4. Enter your OpenAI API key
5. Choose a model from the dropdown (GPT-3.5 Turbo, GPT-4, or GPT-4 Turbo)
6. Click "Test Connection" to verify your API key works
7. Save settings

### Deepseek API

1. Sign up for a [Deepseek account](https://deepseek.ai/) and get an API key
2. Click the extension icon and go to Settings
3. Select "Deepseek API" as the summarization method
4. Enter your Deepseek API key
5. Choose a model from the dropdown
6. Click "Test Connection" to verify your API key works
7. Save settings

### Custom API

1. Obtain an API key for your preferred OpenAI-compatible API provider
2. Click the extension icon and go to Settings
3. Select "Custom API" as the summarization method
4. Enter a name for your provider
5. Enter the API endpoint URL
6. Enter your API key
7. Specify the model name
8. Add any additional headers if required (in JSON format)
9. Click "Test Connection" to verify your settings
10. Save settings

## Usage

1. Navigate to any webpage you want to summarize
2. Click the extension icon in your toolbar
3. Click "Summarize This Page"
4. Watch the progress bar as content is extracted and processed
5. The summary will appear in the extension popup
6. Use the chat interface below the summary to ask follow-up questions about the content

## Security Features

- **API Key Encryption**: All API keys are encrypted before storage using the Web Crypto API
- **Local Storage Only**: API keys are stored only in your browser's secure storage
- **No Remote Transmission**: Keys are never sent anywhere except to their respective API services
- **Optional Encryption**: You can toggle encryption on/off in settings (enabled by default)
- **No Plaintext Storage**: Keys are never stored in plaintext in the extension code

## Git Security Considerations

If you're planning to push this code to a Git repository:

1. **No API Keys in Code**: The extension is designed so API keys are stored only in your browser's secure storage, not in the code
2. **Check Before Committing**: Always review your changes before committing to ensure no secrets are included
3. **Consider Adding .gitignore**: Add any development-specific files to .gitignore

## Troubleshooting

If the extension doesn't work properly, check the following:

1. **Icons are missing**: Make sure you've created the icon files in the `icons` directory
2. **Local LLM not working**: Ensure LM Studio is running with the local server enabled
3. **API keys invalid**: Check that your API keys are correct and have the necessary permissions
4. **Content scraping issues**: Some websites may have complex layouts that are difficult to scrape
5. **Token limits**: Very long pages will be automatically truncated
6. **Chrome Developer console**: Check for any errors in the console by right-clicking the extension popup and selecting "Inspect"

## Project Structure

```
second-brain/
├── manifest.json         # Extension configuration
├── README.md             # This file
├── background/           # Background service worker
│   └── background.js     # Handles summarization and AI logic
├── content/              # Content scripts
│   └── content.js        # Scrapes webpage content
├── popup/                # Extension popup UI
│   ├── popup.html        # Popup HTML structure with chat interface
│   ├── popup.css         # Popup styling
│   └── popup.js          # Popup interaction logic
├── settings/             # Settings page
│   ├── settings.html     # Settings UI with multiple providers
│   ├── settings.css      # Settings styling
│   └── settings.js       # Settings logic with encryption
└── icons/                # Extension icons
    ├── icon16.png        # 16x16 icon
    ├── icon48.png        # 48x48 icon
    └── icon128.png       # 128x128 icon
```

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
