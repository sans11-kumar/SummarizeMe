export class WebSearch {
  constructor(engine = 'google', apiKey) {
    this.engine = engine;
    this.apiKey = apiKey;
    this.baseUrls = {
      google: 'https://customsearch.googleapis.com/customsearch/v1',
      serpapi: 'https://serpapi.com/search'
    };
  }

  async search(query, numResults = 3) {
    const params = new URLSearchParams({
      q: query,
      num: numResults,
      ...(this.engine === 'google' ? { key: this.apiKey } : { api_key: this.apiKey })
    });

    try {
      const response = await fetch(`${this.baseUrls[this.engine]}?${params}`);
      const results = await response.json();
      
      return results.items?.map(item => ({
        title: item.title,
        link: item.link,
        snippet: item.snippet
      })) || [];
    } catch (error) {
      console.error('Web search failed:', error);
      return [];
    }
  }
}
