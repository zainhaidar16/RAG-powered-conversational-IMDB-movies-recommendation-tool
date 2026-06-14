import { Settings } from "llamaindex";

type TMDBParams = {
  search_type: "person" | "movie" | "search_query" | "discover_popular" | "discover_revenue" | "discover_top_rated" | "discover_budget";
  person_name?: string;
  person_role?: "director" | "actor" | "any";
  movie_name?: string;
  query?: string;
  genre?: string;
  genres?: string[];
  keywords?: string[];
  year_from?: number;
  year_to?: number;
  sort_by?: "popularity" | "rating" | "revenue" | "budget" | "release_date";
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
  "sci-fi": 878,
  "science fiction": 878,
  thriller: 53,
  war: 10752,
  western: 37,
};

function cleanJsonText(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.replace(/^```json/, "").replace(/```$/, "").trim();
  if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```/, "").replace(/```$/, "").trim();
  if (cleaned.startsWith("`json")) cleaned = cleaned.replace(/^`json/, "").replace(/`$/, "").trim();
  if (cleaned.startsWith("`")) cleaned = cleaned.replace(/^`/, "").replace(/`$/, "").trim();
  return cleaned;
}

function cleanPersonName(name: string): string {
  return name
    .replace(/\b(show|me|all|list|movies|movie|films|film|by|from|of|the|a|an|please|recommend|give|highest|rated|best|top|tell|about|plot)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferGenres(text: string): string[] {
  const genres: string[] = [];
  for (const name of Object.keys(TMDB_GENRES)) {
    if (text.includes(name)) {
      const normalized = name === "sci-fi" || name === "science fiction" ? "scifi" : name;
      if (!genres.includes(normalized)) genres.push(normalized);
    }
  }
  return genres;
}

function inferKeywords(text: string): string[] {
  const keywords: string[] = [];
  const keywordHints = [
    "time travel",
    "space exploration",
    "space travel",
    "space",
    "aliens",
    "alien invasion",
    "parallel universe",
    "multiverse",
    "artificial intelligence",
    "robot",
    "cyberpunk",
    "dystopia",
    "revenge",
    "heist",
    "serial killer",
    "post apocalyptic",
  ];
  for (const keyword of keywordHints) {
    if (text.includes(keyword)) keywords.push(keyword);
  }
  return keywords;
}

function inferYears(text: string): { year_from?: number; year_to?: number } {
  const decade = text.match(/\b(19\d0|20\d0)s\b/);
  if (decade) {
    const start = Number(decade[1]);
    return { year_from: start, year_to: start + 9 };
  }

  const fromTo = text.match(/\b(19\d{2}|20\d{2})\s*(?:to|-|through)\s*(19\d{2}|20\d{2})\b/);
  if (fromTo) return { year_from: Number(fromTo[1]), year_to: Number(fromTo[2]) };

  const year = text.match(/\b(19\d{2}|20\d{2})\b/);
  if (year) return { year_from: Number(year[1]), year_to: Number(year[1]) };

  return {};
}

function deterministicParams(message: string): TMDBParams | null {
  const original = message.replace(/["']/g, " ").replace(/\s+/g, " ").trim();
  const text = original.toLowerCase();
  const years = inferYears(text);
  const genres = inferGenres(text);
  const keywords = inferKeywords(text);
  const wantsRevenue = /high[- ]?revenue|box office|grossing|profitable|revenue/.test(text);
  const wantsRating = /highest[- ]?rated|top[- ]?rated|best rated|rating|rated/.test(text);
  const wantsBudget = /budget|expensive/.test(text);

  const directedBy = original.match(/(?:movies|films)?\s*directed\s+by\s+([a-zA-Z .'-]+)/i);
  if (directedBy?.[1]) {
    return { search_type: "person", person_name: cleanPersonName(directedBy[1]), person_role: "director", sort_by: wantsRating ? "rating" : "release_date", number_of_movies_requested: 999 };
  }

  if (text.includes("directed") || text.includes("director") || text.includes("filmmaker") || text.includes("made by")) {
    const match = original.match(/([a-zA-Z .'-]+?)\s+(?:directed|director|filmography as director|movies as director)/i) || original.match(/(?:director|filmmaker)\s+([a-zA-Z .'-]+)/i) || original.match(/(?:movies|films)\s+by\s+([a-zA-Z .'-]+)/i);
    const person = match?.[1] ? cleanPersonName(match[1]) : "";
    if (person && person.split(" ").length >= 2) {
      return { search_type: "person", person_name: person, person_role: "director", sort_by: wantsRating ? "rating" : "release_date", number_of_movies_requested: 999 };
    }
  }

  if (text.includes("starring") || text.includes("featuring") || text.includes("acted") || text.includes("actor") || text.includes("cast")) {
    const match = original.match(/(?:movies|films)?\s*(?:starring|featuring)\s+([a-zA-Z .'-]+)/i) || original.match(/([a-zA-Z .'-]+?)\s+(?:movies|films|acting credits|actor credits)/i) || original.match(/(?:actor|actress)\s+([a-zA-Z .'-]+)/i);
    const person = match?.[1] ? cleanPersonName(match[1]) : "";
    if (person && person.split(" ").length >= 2) {
      return { search_type: "person", person_name: person, person_role: "actor", sort_by: wantsRating ? "rating" : "release_date", number_of_movies_requested: 999 };
    }
  }

  const possessivePerson = original.match(/([A-Z][a-zA-Z.'-]+\s+[A-Z][a-zA-Z.'-]+)'?s\s+(?:highest[- ]rated|best|top|movies|films)/);
  if (possessivePerson?.[1]) {
    return { search_type: "person", person_name: cleanPersonName(possessivePerson[1]), person_role: "any", sort_by: wantsRating ? "rating" : "popularity", number_of_movies_requested: 999 };
  }

  const plotMovie = original.match(/plot\s+of\s+([a-zA-Z0-9 .:'-]+)/i) || original.match(/about\s+the\s+plot\s+of\s+([a-zA-Z0-9 .:'-]+)/i);
  if (plotMovie?.[1] && !possessivePerson) {
    return { search_type: "movie", movie_name: plotMovie[1].trim(), number_of_movies_requested: 10 };
  }

  if (wantsRevenue || wantsRating || wantsBudget || genres.length > 0 || keywords.length > 0 || years.year_from) {
    return {
      search_type: wantsRevenue ? "discover_revenue" : wantsBudget ? "discover_budget" : wantsRating ? "discover_top_rated" : "search_query",
      query: keywords.length > 0 ? keywords.join(" ") : original,
      genres,
      keywords,
      ...years,
      sort_by: wantsRevenue ? "revenue" : wantsBudget ? "budget" : wantsRating ? "rating" : "popularity",
      number_of_movies_requested: 50,
    };
  }

  return null;
}

export async function getTMDBParams(message: string): Promise<TMDBParams> {
  const deterministic = deterministicParams(message);
  if (deterministic) {
    console.log("Using deterministic TMDB params:", deterministic);
    return deterministic;
  }

  const llm = Settings.llm;
  if (!llm) throw new Error("LLM not initialized. Call setupSettings() before getTMDBParams().");

  const prompt = `Return ONLY valid JSON for a TMDB movie search plan.
Format:
{
  "search_type": "person" | "movie" | "search_query" | "discover_popular" | "discover_revenue" | "discover_top_rated" | "discover_budget",
  "person_name": "name if person search",
  "person_role": "director" | "actor" | "any",
  "movie_name": "movie title if exact movie search",
  "query": "theme or keyword query",
  "genres": ["action", "thriller", "scifi", "drama"],
  "keywords": ["time travel", "space exploration"],
  "year_from": 2000,
  "year_to": 2009,
  "sort_by": "popularity" | "rating" | "revenue" | "budget" | "release_date",
  "number_of_movies_requested": number
}
Rules:
- For person/director/actor queries, use search_type person and person_role correctly.
- For high revenue, box office, grossing, use discover_revenue and sort_by revenue.
- For highest rated, top rated, best rated, use discover_top_rated and sort_by rating.
- For action thriller, include genres ["action", "thriller"].
- For sci-fi, use genre "scifi".
- For 2000s, set year_from 2000 and year_to 2009.
- For themes like time travel, space exploration, AI, cyberpunk, use keywords.
- For person queries, set number_of_movies_requested to 999.
- For discovery/search queries, set number_of_movies_requested to 50.
User message: ${message}`;

  const response = await llm.complete({ prompt });
  const text = cleanJsonText(response.text);

  try {
    const params = JSON.parse(text);
    if (params.genre && !params.genres) params.genres = [params.genre];
    params.number_of_movies_requested = params.search_type === "person" ? 999 : params.number_of_movies_requested || 50;
    return params;
  } catch (err) {
    console.error("Failed to parse LLM TMDB params JSON:", err, "Raw text:", text);
    return { search_type: "search_query", query: message, number_of_movies_requested: 50 };
  }
}

async function fetchJson(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`TMDB request failed ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchKeywordIds(keywords: string[], headers: Record<string, string>): Promise<number[]> {
  const ids: number[] = [];
  for (const keyword of keywords) {
    const data = await fetchJson(`https://api.themoviedb.org/3/search/keyword?query=${encodeURIComponent(keyword)}`, headers);
    const first = data.results?.[0];
    if (first?.id) ids.push(first.id);
  }
  return Array.from(new Set(ids));
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

function sortPersonMovies(movies: any[], sortBy?: string): any[] {
  return movies.sort((a: any, b: any) => {
    if (sortBy === "rating") return (b.vote_average || 0) - (a.vote_average || 0) || (b.popularity || 0) - (a.popularity || 0);
    if (sortBy === "popularity") return (b.popularity || 0) - (a.popularity || 0);
    const yearA = Number((a.release_date || "0000").slice(0, 4));
    const yearB = Number((b.release_date || "0000").slice(0, 4));
    return yearB - yearA || (b.popularity || 0) - (a.popularity || 0);
  });
}

export async function fetchFromTMDB(params: TMDBParams): Promise<any[]> {
  const TMDB_TOKEN = process.env.TMDB_BEARER_TOKEN;
  if (!TMDB_TOKEN) throw new Error("TMDB_BEARER_TOKEN is missing.");

  const headers = { Authorization: `Bearer ${TMDB_TOKEN}` };
  const genreNames = params.genres || (params.genre ? [params.genre] : []);
  const genreIds = genreNames.map((g) => TMDB_GENRES[g.toLowerCase()]).filter(Boolean);
  let movies: any[] = [];

  if (params.search_type === "person" && params.person_name) {
    const searchData = await fetchJson(`https://api.themoviedb.org/3/search/person?query=${encodeURIComponent(params.person_name)}`, headers);
    if (searchData.results && searchData.results.length > 0) {
      const personId = searchData.results[0].id;
      const creditsData = await fetchJson(`https://api.themoviedb.org/3/person/${personId}/movie_credits`, headers);
      const directed = (creditsData.crew || []).filter((c: any) => c.job === "Director").map((m: any) => ({ ...m, person_job: "Director" }));
      const cast = (creditsData.cast || []).map((m: any) => ({ ...m, person_job: "Actor/Cast" }));
      const role = params.person_role || "any";
      const combined = role === "director" ? directed : role === "actor" ? cast : [...directed, ...cast];
      const map = new Map();
      for (const movie of combined) {
        if (!movie.id) continue;
        if (!map.has(movie.id)) map.set(movie.id, movie);
        else if (movie.person_job === "Director") map.set(movie.id, movie);
      }
      movies = sortPersonMovies(Array.from(map.values()).filter((m: any) => m.title || m.name), params.sort_by);
    }
    return movies;
  }

  if (params.search_type === "movie" && params.movie_name) {
    return fetchMovieSearchPages(`https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(params.movie_name)}`, headers, params.number_of_movies_requested || 20);
  }

  const discoverSearch = params.search_type.startsWith("discover") || genreIds.length > 0 || params.year_from || params.keywords?.length;
  if (discoverSearch) {
    let sortOption = "popularity.desc";
    if (params.search_type === "discover_top_rated" || params.sort_by === "rating") sortOption = "vote_average.desc&vote_count.gte=200";
    else if (params.search_type === "discover_revenue" || params.sort_by === "revenue") sortOption = "revenue.desc";
    else if (params.search_type === "discover_budget" || params.sort_by === "budget") sortOption = "budget.desc";
    else if (params.sort_by === "release_date") sortOption = "primary_release_date.desc";

    const query: string[] = [`sort_by=${sortOption}`];
    if (genreIds.length > 0) query.push(`with_genres=${genreIds.join(",")}`);
    if (params.year_from) query.push(`primary_release_date.gte=${params.year_from}-01-01`);
    if (params.year_to) query.push(`primary_release_date.lte=${params.year_to}-12-31`);
    if (params.keywords?.length) {
      const keywordIds = await fetchKeywordIds(params.keywords, headers);
      if (keywordIds.length > 0) query.push(`with_keywords=${keywordIds.join("|")}`);
    }
    movies = await fetchMovieSearchPages(`https://api.themoviedb.org/3/discover/movie?${query.join("&")}`, headers, params.number_of_movies_requested || 50);
  } else if (params.search_type === "search_query" && params.query) {
    movies = await fetchMovieSearchPages(`https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(params.query)}`, headers, params.number_of_movies_requested || 50);
  } else {
    movies = await fetchMovieSearchPages("https://api.themoviedb.org/3/movie/popular", headers, params.number_of_movies_requested || 50);
  }

  return movies;
}
