import { OpenAI } from "@llamaindex/openai";
import { Settings } from "llamaindex";
import dotenv from "dotenv";

dotenv.config();

const TMDB_TOKEN = process.env.TMDB_BEARER_TOKEN;
if (!TMDB_TOKEN) {
  console.warn("WARNING: TMDB_BEARER_TOKEN environment variable is missing.");
}

type TMDBParams = {
  search_type: "person" | "movie" | "search_query" | "discover_popular" | "discover_revenue" | "discover_top_rated" | "discover_budget";
  person_name?: string;
  movie_name?: string;
  query?: string;
  genre?: string;
  number_of_movies_requested: number;
};

const TMDB_GENRES: Record<string, number> = {
  action: 28,
  adventure: 12,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  fantasy: 14,
  history: 36,
  horror: 27,
  music: 10402,
  mystery: 9648,
  romance: 10749,
  romantic: 10749,
  scifi: 878,
  "science fiction": 878,
  thriller: 53,
  war: 10752,
  western: 37
};

export async function getTMDBParams(message: string, openRouterApiKey: string): Promise<TMDBParams> {
  const llm = Settings.llm || new OpenAI({
      model: "nvidia/nemotron-nano-9b-v2:free",
      apiKey: openRouterApiKey || "dummy",
      additionalSessionOptions: {
        baseURL: "https://openrouter.ai/api/v1",
      },
  });

  const prompt = `You are a movie search parameter extractor. Based on the user message, extract search query parameters for The Movie Database (TMDB). Return ONLY valid JSON.
Format:
{
  "search_type": "person" | "movie" | "search_query" | "discover_popular" | "discover_revenue" | "discover_top_rated" | "discover_budget",
  "person_name": "name of person if type is person",
  "movie_name": "name of movie if type is movie",
  "query": "search keywords if type is search_query",
  "genre": "action" | "adventure" | "animation" | "comedy" | "crime" | "documentary" | "drama" | "family" | "fantasy" | "history" | "horror" | "music" | "mystery" | "romance" | "scifi" | "thriller" | "war" | "western" (if a specific genre is mentioned),
  "number_of_movies_requested": number (default to 50 if unspecified, up to 100)
}

CRITICAL RULES FOR EXTRACTION:
1. Strip all conversational filler and search metadata from the "query" and "movie_name" fields. Extract ONLY clean subject keywords.
   - Do NOT include words like "best rated", "highest rated", "movies", "films", "recommend", "show me", "list of", "drama", "romance", "comedy" (if it is a genre, put it in the "genre" field instead).
   - Example user query: "best rated romantic movies" -> search_type: "discover_top_rated", genre: "romance", query: null, movie_name: null.
   - Example user query: "recommend high rated drama movies" -> search_type: "discover_top_rated", genre: "drama", query: null, movie_name: null.
   - Example user query: "Space Exploration" -> search_type: "search_query", query: "Space Exploration".
   - Example user query: "time travel sci-fi movies" -> search_type: "search_query", genre: "scifi", query: "time travel".

Notes for search_type:
- "person" if the user is asking for movies directed by or starring a specific person.
- "movie" if the user is asking about a specific movie title or series (e.g. 'Inception').
- "search_query" if the user is asking for general themes, keywords, or topics (e.g. 'time travel', 'zombies', 'space exploration').
- "discover_top_rated" if asking for top rated, highest rated, best, high rated movies.
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
    return { search_type: "discover_popular", number_of_movies_requested: 50 };
  }
}

export async function fetchFromTMDB(params: TMDBParams): Promise<any[]> {
  const headers = { Authorization: `Bearer ${TMDB_TOKEN}` };
  let movies: any[] = [];
  
  const genreId = params.genre ? TMDB_GENRES[params.genre.toLowerCase()] : null;

  if (genreId) {
    // If a genre filter is requested, use discover/movie which supports sorting & genre filtering
    let sortOption = "popularity.desc";
    let extraParams = "";
    if (params.search_type === "discover_top_rated") {
      sortOption = "vote_average.desc";
      extraParams = "&vote_count.gte=200"; // Ensure reputable movies, not single vote 10s
    } else if (params.search_type === "discover_revenue") {
      sortOption = "revenue.desc";
    } else if (params.search_type === "discover_budget") {
      sortOption = "budget.desc";
    } else if (params.search_type === "discover_popular") {
      sortOption = "popularity.desc";
    }

    const maxPages = Math.ceil((params.number_of_movies_requested || 50) / 20);
    const pagesToFetch = Math.min(Math.max(1, maxPages), 5);

    for (let page = 1; page <= pagesToFetch; page++) {
      const url = `https://api.themoviedb.org/3/discover/movie?with_genres=${genreId}&sort_by=${sortOption}${extraParams}&page=${page}`;
      const res = await fetch(url, { headers });
      const data = await res.json();
      if (data.results) {
        movies.push(...data.results);
      }
    }
  } else if (params.search_type === "person" && params.person_name) {
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
  } else if (params.search_type === "search_query" && params.query) {
    const searchUrl = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(params.query)}`;
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

    const maxPages = Math.ceil((params.number_of_movies_requested || 50) / 20);
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
  const limit = Math.min(params.number_of_movies_requested || 50, 100);
  return movies.slice(0, limit);
}
