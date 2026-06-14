import { Settings } from "llamaindex";

type TMDBParams = {
  search_type: "person" | "movie" | "search_query" | "discover_popular" | "discover_revenue" | "discover_top_rated" | "discover_budget";
  person_name?: string;
  person_role?: "director" | "actor" | "any";
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

export async function getTMDBParams(message: string): Promise<TMDBParams> {
  const llm = Settings.llm;
  if (!llm) {
    throw new Error("LLM not initialized. Call setupSettings() before getTMDBParams().");
  }

  const lowerMessage = message.toLowerCase();
  const roleHint = lowerMessage.includes("directed") || lowerMessage.includes("director")
    ? "director"
    : lowerMessage.includes("starring") || lowerMessage.includes("acted") || lowerMessage.includes("actor") || lowerMessage.includes("cast")
      ? "actor"
      : "any";

  const prompt = `You are a movie search parameter extractor. Based on the user message, extract search query parameters for The Movie Database (TMDB). Return ONLY valid JSON.
Format:
{
  "search_type": "person" | "movie" | "search_query" | "discover_popular" | "discover_revenue" | "discover_top_rated" | "discover_budget",
  "person_name": "name of person if type is person",
  "person_role": "director" | "actor" | "any",
  "movie_name": "name of movie if type is movie",
  "query": "search keywords if type is search_query",
  "genre": "action" | "adventure" | "animation" | "comedy" | "crime" | "documentary" | "drama" | "family" | "fantasy" | "history" | "horror" | "music" | "mystery" | "romance" | "scifi" | "thriller" | "war" | "western" (if a specific genre is mentioned),
  "number_of_movies_requested": number (default to 20 if unspecified, up to 30)
}

CRITICAL RULES:
- Use search_type "person" when the user asks for movies directed by, starring, acted by, or made by a person.
- If the message says directed by, director, or filmmaker, set person_role to "director".
- If the message says starring, actor, acted by, cast, or featuring, set person_role to "actor".
- If the person role is unclear, set person_role to "any".
- Strip conversational filler from query and movie_name.
- Example: "Christopher Nolan directed" -> {"search_type":"person","person_name":"Christopher Nolan","person_role":"director","number_of_movies_requested":20}
- Example: "movies starring Leonardo DiCaprio" -> {"search_type":"person","person_name":"Leonardo DiCaprio","person_role":"actor","number_of_movies_requested":20}
- Example: "best rated romantic movies" -> {"search_type":"discover_top_rated","genre":"romance","number_of_movies_requested":20}

User message: ${message}
Role hint from rules: ${roleHint}
JSON Response:`;

  const response = await llm.complete({ prompt });
  let text = response.text.trim();

  if (text.startsWith("```json")) text = text.replace(/^```json/, "").replace(/```$/, "").trim();
  if (text.startsWith("```")) text = text.replace(/^```/, "").replace(/```$/, "").trim();
  if (text.startsWith("`json")) text = text.replace(/^`json/, "").replace(/```$/, "").trim();
  if (text.startsWith("`")) text = text.replace(/^`/, "").replace(/```$/, "").trim();

  try {
    const params = JSON.parse(text);
    if (params.search_type === "person") {
      params.person_role = params.person_role || roleHint;
    }
    params.number_of_movies_requested = params.number_of_movies_requested || 20;
    return params;
  } catch (err) {
    console.error("Failed to parse LLM TMDB params JSON:", err, "Raw text:", text);
    return { search_type: "discover_popular", number_of_movies_requested: 20 };
  }
}

export async function fetchFromTMDB(params: TMDBParams): Promise<any[]> {
  const TMDB_TOKEN = process.env.TMDB_BEARER_TOKEN;
  if (!TMDB_TOKEN) {
    throw new Error("TMDB_BEARER_TOKEN is missing. Check that .env is in the project root and the variable name is exactly TMDB_BEARER_TOKEN.");
  }

  const headers = { Authorization: `Bearer ${TMDB_TOKEN}` };
  let movies: any[] = [];
  const genreId = params.genre ? TMDB_GENRES[params.genre.toLowerCase()] : null;

  if (genreId) {
    let sortOption = "popularity.desc";
    let extraParams = "";
    if (params.search_type === "discover_top_rated") {
      sortOption = "vote_average.desc";
      extraParams = "&vote_count.gte=200";
    } else if (params.search_type === "discover_revenue") {
      sortOption = "revenue.desc";
    } else if (params.search_type === "discover_budget") {
      sortOption = "budget.desc";
    }

    const maxPages = Math.ceil((params.number_of_movies_requested || 20) / 20);
    const pagesToFetch = Math.min(Math.max(1, maxPages), 2);
    for (let page = 1; page <= pagesToFetch; page++) {
      const url = `https://api.themoviedb.org/3/discover/movie?with_genres=${genreId}&sort_by=${sortOption}${extraParams}&page=${page}`;
      const res = await fetch(url, { headers });
      const data = await res.json();
      if (data.results) movies.push(...data.results);
    }
  } else if (params.search_type === "person" && params.person_name) {
    const searchUrl = `https://api.themoviedb.org/3/search/person?query=${encodeURIComponent(params.person_name)}`;
    const searchRes = await fetch(searchUrl, { headers });
    const searchData = await searchRes.json();

    if (searchData.results && searchData.results.length > 0) {
      const personId = searchData.results[0].id;
      const creditsUrl = `https://api.themoviedb.org/3/person/${personId}/movie_credits`;
      const creditsRes = await fetch(creditsUrl, { headers });
      const creditsData = await creditsRes.json();

      const directed = creditsData.crew
        ? creditsData.crew
            .filter((c: any) => c.job === "Director")
            .map((m: any) => ({ ...m, person_job: "Director" }))
        : [];

      const cast = creditsData.cast
        ? creditsData.cast.map((m: any) => ({ ...m, person_job: "Actor/Cast" }))
        : [];

      const role = params.person_role || "any";
      let combined: any[] = [];
      if (role === "director") combined = directed;
      else if (role === "actor") combined = cast;
      else combined = [...directed, ...cast];

      const map = new Map();
      for (const m of combined) {
        if (!map.has(m.id)) map.set(m.id, m);
        else if (m.person_job === "Director") map.set(m.id, m);
      }

      movies = Array.from(map.values());
      movies.sort((a, b) => {
        const yearA = Number((a.release_date || "0000").slice(0, 4));
        const yearB = Number((b.release_date || "0000").slice(0, 4));
        return yearB - yearA || (b.popularity || 0) - (a.popularity || 0);
      });
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
    let endpoint = "";
    if (params.search_type === "discover_top_rated") endpoint = "/movie/top_rated";
    else if (params.search_type === "discover_revenue") endpoint = "/discover/movie?sort_by=revenue.desc";
    else if (params.search_type === "discover_budget") endpoint = "/discover/movie?sort_by=budget.desc";
    else endpoint = "/movie/popular";

    const maxPages = Math.ceil((params.number_of_movies_requested || 20) / 20);
    const pagesToFetch = Math.min(Math.max(1, maxPages), 2);
    for (let page = 1; page <= pagesToFetch; page++) {
      const url = `https://api.themoviedb.org/3${endpoint}${endpoint.includes("?") ? "&" : "?"}page=${page}`;
      const res = await fetch(url, { headers });
      const data = await res.json();
      if (data.results) movies.push(...data.results);
    }
  }

  const limit = Math.min(params.number_of_movies_requested || 20, 30);
  return movies.slice(0, limit);
}
