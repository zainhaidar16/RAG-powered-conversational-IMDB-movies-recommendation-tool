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
  western: 37,
};

function inferPersonRole(message: string): "director" | "actor" | "any" {
  const text = message.toLowerCase();
  if (text.includes("directed") || text.includes("director") || text.includes("filmmaker") || text.includes("made by")) return "director";
  if (text.includes("starring") || text.includes("actor") || text.includes("acted") || text.includes("cast") || text.includes("featuring")) return "actor";
  return "any";
}

function cleanJsonText(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.replace(/^```json/, "").replace(/```$/, "").trim();
  if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```/, "").replace(/```$/, "").trim();
  if (cleaned.startsWith("`json")) cleaned = cleaned.replace(/^`json/, "").replace(/`$/, "").trim();
  if (cleaned.startsWith("`")) cleaned = cleaned.replace(/^`/, "").replace(/`$/, "").trim();
  return cleaned;
}

export async function getTMDBParams(message: string): Promise<TMDBParams> {
  const llm = Settings.llm;
  if (!llm) throw new Error("LLM not initialized. Call setupSettings() before getTMDBParams().");

  const roleHint = inferPersonRole(message);
  const prompt = `Return ONLY valid JSON for a TMDB movie search.
Format:
{
  "search_type": "person" | "movie" | "search_query" | "discover_popular" | "discover_revenue" | "discover_top_rated" | "discover_budget",
  "person_name": "name if person search",
  "person_role": "director" | "actor" | "any",
  "movie_name": "movie title if exact movie search",
  "query": "keywords if keyword search",
  "genre": "genre if mentioned",
  "number_of_movies_requested": number
}
Rules:
- If user asks directed by, director, filmmaker, or made by a person, use search_type person and person_role director.
- If user asks starring, acted by, actor, cast, or featuring a person, use search_type person and person_role actor.
- If user asks about a person but role is unclear, use search_type person and person_role any.
- For person queries, do not limit results. Set number_of_movies_requested to 999.
- For broad discovery/search queries, default number_of_movies_requested to 50.
- Example: Christopher Nolan directed -> {"search_type":"person","person_name":"Christopher Nolan","person_role":"director","number_of_movies_requested":999}
- Example: Leonardo DiCaprio movies -> {"search_type":"person","person_name":"Leonardo DiCaprio","person_role":"any","number_of_movies_requested":999}
User message: ${message}
Role hint: ${roleHint}`;

  const response = await llm.complete({ prompt });
  const text = cleanJsonText(response.text);

  try {
    const params = JSON.parse(text);
    if (params.search_type === "person") {
      params.person_role = params.person_role || roleHint;
      params.number_of_movies_requested = 999;
    } else {
      params.number_of_movies_requested = params.number_of_movies_requested || 50;
    }
    return params;
  } catch (err) {
    console.error("Failed to parse LLM TMDB params JSON:", err, "Raw text:", text);
    return { search_type: "discover_popular", number_of_movies_requested: 50 };
  }
}

async function fetchJson(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`TMDB request failed ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchMovieSearchPages(baseUrl: string, headers: Record<string, string>, requested = 50): Promise<any[]> {
  const maxPages = Math.max(1, Math.min(Math.ceil(requested / 20), 25));
  const movies: any[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}page=${page}`;
    const data = await fetchJson(url, headers);
    if (data.results) movies.push(...data.results);
    if (!data.total_pages || page >= data.total_pages) break;
  }
  return movies;
}

export async function fetchFromTMDB(params: TMDBParams): Promise<any[]> {
  const TMDB_TOKEN = process.env.TMDB_BEARER_TOKEN;
  if (!TMDB_TOKEN) throw new Error("TMDB_BEARER_TOKEN is missing.");

  const headers = { Authorization: `Bearer ${TMDB_TOKEN}` };
  const genreId = params.genre ? TMDB_GENRES[params.genre.toLowerCase()] : null;
  let movies: any[] = [];

  if (params.search_type === "person" && params.person_name) {
    const searchUrl = `https://api.themoviedb.org/3/search/person?query=${encodeURIComponent(params.person_name)}`;
    const searchData = await fetchJson(searchUrl, headers);

    if (searchData.results && searchData.results.length > 0) {
      const personId = searchData.results[0].id;
      const creditsUrl = `https://api.themoviedb.org/3/person/${personId}/movie_credits`;
      const creditsData = await fetchJson(creditsUrl, headers);

      const directed = (creditsData.crew || [])
        .filter((c: any) => c.job === "Director")
        .map((m: any) => ({ ...m, person_job: "Director" }));

      const cast = (creditsData.cast || [])
        .map((m: any) => ({ ...m, person_job: "Actor/Cast" }));

      const role = params.person_role || "any";
      const combined = role === "director" ? directed : role === "actor" ? cast : [...directed, ...cast];

      const map = new Map();
      for (const movie of combined) {
        if (!movie.id) continue;
        if (!map.has(movie.id)) map.set(movie.id, movie);
        else if (movie.person_job === "Director") map.set(movie.id, movie);
      }

      movies = Array.from(map.values())
        .filter((m: any) => m.title || m.name)
        .sort((a: any, b: any) => {
          const yearA = Number((a.release_date || "0000").slice(0, 4));
          const yearB = Number((b.release_date || "0000").slice(0, 4));
          return yearB - yearA || (b.popularity || 0) - (a.popularity || 0);
        });
    }

    return movies;
  }

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
    const baseUrl = `https://api.themoviedb.org/3/discover/movie?with_genres=${genreId}&sort_by=${sortOption}${extraParams}`;
    movies = await fetchMovieSearchPages(baseUrl, headers, params.number_of_movies_requested || 50);
  } else if (params.search_type === "movie" && params.movie_name) {
    const baseUrl = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(params.movie_name)}`;
    movies = await fetchMovieSearchPages(baseUrl, headers, params.number_of_movies_requested || 50);
  } else if (params.search_type === "search_query" && params.query) {
    const baseUrl = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(params.query)}`;
    movies = await fetchMovieSearchPages(baseUrl, headers, params.number_of_movies_requested || 50);
  } else {
    let baseUrl = "https://api.themoviedb.org/3/movie/popular";
    if (params.search_type === "discover_top_rated") baseUrl = "https://api.themoviedb.org/3/movie/top_rated";
    else if (params.search_type === "discover_revenue") baseUrl = "https://api.themoviedb.org/3/discover/movie?sort_by=revenue.desc";
    else if (params.search_type === "discover_budget") baseUrl = "https://api.themoviedb.org/3/discover/movie?sort_by=budget.desc";
    movies = await fetchMovieSearchPages(baseUrl, headers, params.number_of_movies_requested || 50);
  }

  return movies;
}
