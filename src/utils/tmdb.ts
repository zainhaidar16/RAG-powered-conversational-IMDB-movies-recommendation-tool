import { OpenAI } from "@llamaindex/openai";

const TMDB_TOKEN = process.env.TMDB_BEARER_TOKEN;
if (!TMDB_TOKEN) {
  console.warn("WARNING: TMDB_BEARER_TOKEN environment variable is missing.");
}

type TMDBParams = {
  search_type: "person" | "movie" | "discover_popular" | "discover_revenue" | "discover_top_rated" | "discover_budget";
  person_name?: string;
  movie_name?: string;
  number_of_movies_requested: number;
};

export async function getTMDBParams(message: string, openRouterApiKey: string): Promise<TMDBParams> {
  const llm = new OpenAI({
      model: "nvidia/nemotron-nano-9b-v2:free",
      apiKey: openRouterApiKey || "dummy",
      additionalSessionOptions: {
        baseURL: "https://openrouter.ai/api/v1",
      },
  });

  const prompt = `You are a helpful assistant. We have a TMDB movie database. Based on the following user message, decide how we should query TMDB. Return ONLY valid JSON.
Format:
{
  "search_type": "person" | "movie" | "discover_popular" | "discover_revenue" | "discover_top_rated" | "discover_budget",
  "person_name": "name of person if type is person",
  "movie_name": "name of movie if type is movie",
  "number_of_movies_requested": number (default to 20 if unspecified, up to 100)
}

Notes for search_type:
- "person" if the user is asking for movies directed by or starring a person.
- "movie" if the user is asking about a specific movie or series of movies.
- "discover_top_rated" if asking for top rated, highest rated, best movies, or imdb rating.
- "discover_revenue" if asking for highest box office, most profitable, most grossing.
- "discover_budget" if asking for highest budget movies.
- "discover_popular" if asking for popular or trending movies.

User message: ${message}
JSON Response:`;

  try {
    const response = await llm.complete({ prompt });
    let text = response.text.trim();
    if (text.startsWith("\`\`\`json")) {
        text = text.replace(/^\`\`\`json/, "").replace(/\`\`\`$/, "").trim();
    }
    const params = JSON.parse(text);
    return params;
  } catch (err) {
    console.error("Failed to parse LLM TMDB params:", err);
    return { search_type: "discover_popular", number_of_movies_requested: 20 };
  }
}

export async function fetchFromTMDB(params: TMDBParams): Promise<any[]> {
  const headers = { Authorization: `Bearer ${TMDB_TOKEN}` };
  let movies: any[] = [];
  
  if (params.search_type === "person" && params.person_name) {
    // 1. Search Person
    const searchUrl = `https://api.themoviedb.org/3/search/person?query=${encodeURIComponent(params.person_name)}`;
    const searchRes = await fetch(searchUrl, { headers });
    const searchData = await searchRes.json();
    if (searchData.results && searchData.results.length > 0) {
      const personId = searchData.results[0].id;
      // 2. Get movie credits
      const creditsUrl = `https://api.themoviedb.org/3/person/${personId}/movie_credits`;
      const creditsRes = await fetch(creditsUrl, { headers });
      const creditsData = await creditsRes.json();
      // combine cast and directing
      const directed = creditsData.crew ? creditsData.crew.filter((c: any) => c.job === "Director").map((m: any) => ({...m, person_job: "Director"})) : [];
      const cast = creditsData.cast ? creditsData.cast.map((m: any) => ({...m, person_job: "Actor/Cast"})) : [];
      const combined = [...directed, ...cast];
      // remove duplicates
      const map = new Map();
      for (const m of combined) {
        if (!map.has(m.id)) {
            map.set(m.id, m);
        } else if (m.person_job === "Director") {
            map.set(m.id, m); // Prefer Director tag if both
        }
      }
      movies = Array.from(map.values());
      // sort by popularity
      movies.sort((a,b) => (b.popularity || 0) - (a.popularity || 0));
    }
  } else if (params.search_type === "movie" && params.movie_name) {
    const searchUrl = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(params.movie_name)}`;
    const searchRes = await fetch(searchUrl, { headers });
    const searchData = await searchRes.json();
    movies = searchData.results || [];
  } else {
    // defaults for discover
    let endpoint = "";
    if (params.search_type === "discover_top_rated") {
      endpoint = "/movie/top_rated";
    } else if (params.search_type === "discover_revenue") {
      endpoint = "/discover/movie?sort_by=revenue.desc";
    } else if (params.search_type === "discover_budget") {
      endpoint = "/discover/movie?sort_by=budget.desc";
    } else {
      endpoint = "/movie/popular"; // fallback
    }

    const maxPages = Math.ceil((params.number_of_movies_requested || 20) / 20);
    const pagesToFetch = Math.min(Math.max(1, maxPages), 5); // up to 5 pages (100 movies)

    for (let page = 1; page <= pagesToFetch; page++) {
      const url = `https://api.themoviedb.org/3${endpoint}${endpoint.includes('?') ? '&' : '?'}page=${page}`;
      const res = await fetch(url, { headers });
      const data = await res.json();
      if (data.results) {
        movies.push(...data.results);
      }
    }
  }
  
  // Return the requested number of movies
  const limit = Math.min(params.number_of_movies_requested || 20, 100);
  return movies.slice(0, limit);
}
