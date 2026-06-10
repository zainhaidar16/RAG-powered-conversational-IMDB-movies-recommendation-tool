import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Send, 
  Loader2, 
  Clapperboard, 
  RefreshCw, 
  Trash2, 
  Copy, 
  Check, 
  Star, 
  Calendar, 
  TrendingUp, 
  X, 
  ExternalLink, 
  Sparkles,
  ArrowUpDown,
  Compass
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import * as Tooltip from "@radix-ui/react-tooltip";
import { cn } from "./lib/utils";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: any[];
  inferredParams?: any;
};

const INITIAL_MESSAGE: Message = {
  id: "welcome",
  role: "assistant",
  content: "Hello! I am **CineRAG**, your intelligent movie recommendation assistant. I pull real-time data from **The Movie Database (TMDB)** and index it dynamically into a **local Vector Store RAG pipeline** powered by **Ollama** to answer your questions semantically.\n\nTry asking me things like:\n* *\"Recommend some high-concept sci-fi movies about time travel and space exploration\"*\n* *\"What are Christopher Nolan's highest-rated movies? Tell me about the plot of Interstellar.\"*\n* *\"Show me some high-revenue action thriller films from the 2000s\"*",
};

const SUGGESTIONS = [
  "Time Travel Sci-Fi", 
  "Christopher Nolan Directed", 
  "Top Rated Comedy Dramas", 
  "Mind-bending Thrillers", 
  "Space Exploration"
];

function CopyButton({ text, movies }: { text: string; movies?: any[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    let fullText = text;
    if (movies && movies.length > 0) {
      fullText += "\n\nRecommended Movies:\n" + movies.map(m => `- ${m.title} (${m.release_date?.substring(0,4) || 'N/A'}) - Rating: ⭐ ${m.vote_average?.toFixed(1) || 'N/A'}/10`).join("\n");
    }
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 text-slate-400 hover:text-indigo-400 rounded-md hover:bg-slate-800 transition-colors"
      title="Copy message and recommendations"
    >
      {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

// Expandable Movie Detail Modal Component
function MovieModal({ movie, onClose }: { movie: any; onClose: () => void }) {
  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl shadow-indigo-500/10"
        >
          {/* Close button */}
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 p-2 bg-slate-950/60 hover:bg-slate-800/80 text-slate-400 hover:text-white rounded-full border border-slate-800/50 backdrop-blur-sm z-10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex flex-col md:flex-row">
            {/* Poster column */}
            <div className="w-full md:w-2/5 aspect-[2/3] md:aspect-auto md:h-full bg-slate-950 relative">
              <img 
                src={movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : `https://placehold.co/300x450/1e293b/ffffff?text=${encodeURIComponent(movie.title)}`} 
                alt={movie.title} 
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent md:bg-gradient-to-r md:from-transparent md:to-slate-900" />
            </div>

            {/* Content column */}
            <div className="w-full md:w-3/5 p-6 flex flex-col justify-between">
              <div>
                <h3 className="text-2xl font-bold text-white mb-2 leading-tight tracking-tight">{movie.title}</h3>
                
                {/* Meta stats */}
                <div className="flex flex-wrap gap-3 items-center text-xs font-semibold text-slate-400 mb-4">
                  <span className="flex items-center text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20">
                    <Calendar className="w-3.5 h-3.5 mr-1" />
                    {movie.release_date ? movie.release_date.substring(0, 4) : "N/A"}
                  </span>
                  <span className="flex items-center text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                    <Star className="w-3.5 h-3.5 mr-1 fill-amber-400/20" />
                    {movie.vote_average ? movie.vote_average.toFixed(1) : "N/A"}/10
                  </span>
                  {movie.popularity && (
                    <span className="flex items-center text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                      <TrendingUp className="w-3.5 h-3.5 mr-1" />
                      Pop: {Math.round(movie.popularity || 0)}
                    </span>
                  )}
                </div>

                <div className="text-slate-300 text-sm leading-relaxed mb-6 space-y-2 max-h-48 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-800">
                  <h4 className="text-xs uppercase font-bold text-slate-400 tracking-wider">Overview</h4>
                  <p>{movie.overview || "No overview available for this movie."}</p>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                <span className="text-[10px] text-slate-500 font-mono">TMDB ID: {movie.tmdbId}</span>
                <a 
                  href={`https://www.themoviedb.org/movie/${movie.tmdbId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm rounded-xl transition-colors shadow-lg shadow-indigo-600/20"
                >
                  View on TMDB
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // States for sorting recommended movies
  const [sortField, setSortField] = useState<"rating" | "date" | "popularity">("rating");
  const [selectedMovie, setSelectedMovie] = useState<any | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: input.trim() };
    const updatedMessages = [...messages, userMsg];
    
    setMessages(updatedMessages);
    setInput("");
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          messages: updatedMessages.map(m => ({ role: m.role, content: m.content })) 
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to get response");
      }
      
      setMessages((prev) => [
        ...prev,
        { 
          id: Date.now().toString(), 
          role: "assistant", 
          content: data.reply, 
          metadata: data.movies,
          inferredParams: data.inferredParams
        },
      ]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearChat = () => {
    setMessages([INITIAL_MESSAGE]);
    setError("");
  };

  // Sort function for recommended movies array
  const sortMovies = (movies: any[]) => {
    const sorted = [...movies];
    if (sortField === "rating") {
      return sorted.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
    }
    if (sortField === "date") {
      return sorted.sort((a, b) => {
        const dateA = a.release_date ? new Date(a.release_date).getTime() : 0;
        const dateB = b.release_date ? new Date(b.release_date).getTime() : 0;
        return dateB - dateA;
      });
    }
    if (sortField === "popularity") {
      return sorted.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    }
    return sorted;
  };

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans antialiased overflow-hidden">
        
        {/* Decorative background glow circles */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] pointer-events-none" />

        {/* Header */}
        <header className="flex-shrink-0 flex justify-between items-center py-4 px-6 bg-slate-900/60 backdrop-blur-md border-b border-slate-800/80 sticky top-0 z-10 shadow-lg shadow-black/20">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/20">
              <Clapperboard className="w-5.5 h-5.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400 bg-clip-text text-transparent tracking-tight">CineRAG</h1>
                <span className="text-[9px] font-extrabold uppercase tracking-widest text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">Active RAG</span>
              </div>
              <p className="text-[10px] font-medium text-slate-500 tracking-wider uppercase">Conversational Movie Explorer</p>
            </div>
          </div>
          <button
            onClick={handleClearChat}
            className="flex items-center space-x-2 px-3 py-2 text-xs font-semibold text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all border border-slate-800 hover:border-rose-500/20 bg-slate-950/40"
            title="Clear Chat History"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Clear Chat</span>
          </button>
        </header>

        {/* Chat Feed Area */}
        <main className="flex-1 overflow-y-auto px-4 py-8 mb-2 scrollbar-thin scrollbar-thumb-slate-800">
          <div className="max-w-4xl mx-auto space-y-8 flex flex-col justify-end min-h-full">
            <AnimatePresence initial={false}>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 12, scale: 0.99 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                  className={cn(
                    "flex w-full",
                    msg.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "rounded-2xl px-5 py-4 leading-relaxed tracking-wide shadow-xl relative group",
                      msg.role === "user"
                        ? "max-w-[85%] sm:max-w-[80%] bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-tr-sm shadow-indigo-600/10"
                        : "w-full bg-slate-900/95 text-slate-200 border border-slate-800/80 rounded-tl-sm ring-1 ring-white/5 shadow-black/40"
                    )}
                  >
                    {msg.role === "assistant" ? (
                      <div className="flex flex-col gap-4 relative">
                        {/* Copy button displayed on hover */}
                        <div className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <CopyButton text={msg.content} movies={msg.metadata} />
                        </div>

                        {/* RAG Parameter Inferences */}
                        {msg.inferredParams && (
                          <div className="text-[10px] text-indigo-400 bg-indigo-500/5 border border-indigo-500/20 px-2.5 py-1.5 rounded-lg self-start font-mono flex flex-wrap items-center gap-1.5 shadow-inner">
                            <span className="flex items-center gap-1 font-bold uppercase tracking-wider text-indigo-300">
                              <Sparkles className="w-3 h-3 text-indigo-400" />
                              {msg.inferredParams.search_type.replace(/_/g, ' ')}
                            </span>
                            {msg.inferredParams.person_name && (
                              <>
                                <span className="text-slate-700">•</span>
                                <span>Person: <strong className="text-slate-300">{msg.inferredParams.person_name}</strong></span>
                              </>
                            )}
                            {msg.inferredParams.movie_name && (
                              <>
                                <span className="text-slate-700">•</span>
                                <span>Movie: <strong className="text-slate-300">{msg.inferredParams.movie_name}</strong></span>
                              </>
                            )}
                            {msg.inferredParams.query && (
                              <>
                                <span className="text-slate-700">•</span>
                                <span>Query: <strong className="text-slate-300">"{msg.inferredParams.query}"</strong></span>
                              </>
                            )}
                            <span className="text-slate-700">•</span>
                            <span>Limit: <strong className="text-slate-300">{msg.inferredParams.number_of_movies_requested}</strong></span>
                          </div>
                        )}

                        {/* Content text */}
                        <div className="prose prose-sm md:prose-base prose-invert max-w-none break-words [&>p:last-child]:mb-0 pr-6 text-slate-300">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>

                        {/* Recommended Movies Section */}
                        {msg.metadata && msg.metadata.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-slate-800/80">
                            
                            {/* Metadata Header & Sort Controls */}
                            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                              <h4 className="text-xs uppercase font-extrabold text-indigo-400 tracking-wider flex items-center gap-1.5">
                                <Compass className="w-3.5 h-3.5" />
                                RAG Recommendations ({msg.metadata.length})
                              </h4>
                              
                              <div className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-800/80 px-2 py-1 rounded-xl">
                                <span className="text-[10px] text-slate-500 font-semibold flex items-center gap-1">
                                  <ArrowUpDown className="w-3 h-3" />
                                  Sort:
                                </span>
                                <button 
                                  onClick={() => setSortField("rating")}
                                  className={cn(
                                    "text-[10px] font-bold px-2 py-0.5 rounded transition-all",
                                    sortField === "rating" ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/20" : "text-slate-400 hover:text-slate-200"
                                  )}
                                >
                                  Rating
                                </button>
                                <button 
                                  onClick={() => setSortField("date")}
                                  className={cn(
                                    "text-[10px] font-bold px-2 py-0.5 rounded transition-all",
                                    sortField === "date" ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/20" : "text-slate-400 hover:text-slate-200"
                                  )}
                                >
                                  Date
                                </button>
                                <button 
                                  onClick={() => setSortField("popularity")}
                                  className={cn(
                                    "text-[10px] font-bold px-2 py-0.5 rounded transition-all",
                                    sortField === "popularity" ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/20" : "text-slate-400 hover:text-slate-200"
                                  )}
                                >
                                  Popularity
                                </button>
                              </div>
                            </div>

                            {/* Movies poster grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
                              {sortMovies(msg.metadata).map((movie, idx) => (
                                <motion.div 
                                  key={idx}
                                  initial={{ opacity: 0, y: 15 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ duration: 0.4, delay: idx * 0.08, ease: "easeOut" }}
                                  onClick={() => setSelectedMovie(movie)}
                                >
                                  <Tooltip.Root>
                                    <Tooltip.Trigger asChild>
                                      <div className="flex flex-col h-full bg-slate-950 rounded-xl overflow-hidden border border-slate-800/80 cursor-pointer shadow-md hover:border-indigo-500/50 hover:shadow-indigo-500/5 transition-all hover:-translate-y-1 duration-200 group/card">
                                        <div className="relative aspect-[2/3] w-full bg-slate-900">
                                          <img 
                                            src={movie.poster_path ? `https://image.tmdb.org/t/p/w300${movie.poster_path}` : `https://placehold.co/300x450/1e293b/ffffff?text=${encodeURIComponent(movie.title)}`} 
                                            alt={movie.title} 
                                            className="w-full h-full object-cover group-hover/card:scale-105 transition-transform duration-300"
                                            loading="lazy"
                                          />
                                          {/* Mini score badge on poster */}
                                          {movie.vote_average > 0 && (
                                            <div className="absolute top-2 right-2 bg-slate-950/80 backdrop-blur-sm border border-slate-800 text-[10px] font-extrabold text-amber-400 px-1.5 py-0.5 rounded flex items-center gap-0.5 shadow">
                                              <Star className="w-2.5 h-2.5 fill-amber-400/20" />
                                              {movie.vote_average.toFixed(1)}
                                            </div>
                                          )}
                                        </div>
                                        <div className="p-2.5 text-xs font-bold text-slate-300 truncate text-center bg-slate-900 border-t border-slate-950 flex-1 flex items-center justify-center group-hover/card:text-white transition-colors">
                                          {movie.title}
                                        </div>
                                      </div>
                                    </Tooltip.Trigger>
                                    <Tooltip.Portal>
                                      <Tooltip.Content
                                        className="z-50 max-w-xs bg-slate-950 text-white p-3.5 rounded-xl shadow-2xl text-xs leading-relaxed border border-slate-800 pointer-events-none"
                                        sideOffset={5}
                                      >
                                        <div className="font-bold text-sm mb-1 text-white">{movie.title}</div>
                                        <div className="flex items-center space-x-2 text-indigo-400 font-bold mb-2">
                                          <span>{movie.release_date ? movie.release_date.substring(0, 4) : "Unknown Year"}</span>
                                          <span>•</span>
                                          <span>⭐ {movie.vote_average ? movie.vote_average.toFixed(1) : "N/A"}/10</span>
                                        </div>
                                        <p className="text-slate-400 line-clamp-3 leading-normal">{movie.overview || "No overview available."}</p>
                                        <div className="text-[10px] text-slate-500 mt-2 font-semibold italic">Click card to see details</div>
                                        <Tooltip.Arrow className="fill-slate-950 border-t border-slate-800" />
                                      </Tooltip.Content>
                                    </Tooltip.Portal>
                                  </Tooltip.Root>
                                </motion.div>
                              ))}
                            </div>

                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap font-semibold tracking-wide text-slate-100">{msg.content}</p>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            
            {/* Syncing loader */}
            {isLoading && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-start w-full"
              >
                <div className="bg-slate-900 border border-slate-800/80 rounded-2xl rounded-tl-sm px-5 py-4 shadow-xl ring-1 ring-white/5 flex items-center space-x-3 text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
                  <span className="text-sm font-semibold animate-pulse text-slate-300">Searching dynamic Vector Store RAG...</span>
                </div>
              </motion.div>
            )}

            {/* Error badge */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-center w-full"
              >
                <div className="bg-rose-500/10 text-rose-400 px-4 py-3 rounded-xl border border-rose-500/20 flex items-center space-x-2 text-sm shadow-lg shadow-rose-950/20">
                  <RefreshCw className="w-4 h-4" />
                  <span className="font-semibold">{error}</span>
                </div>
              </motion.div>
            )}

            <div ref={messagesEndRef} className="h-px" />
          </div>
        </main>

        {/* Input Controls Area */}
        <footer className="flex-shrink-0 bg-slate-900/40 backdrop-blur-md border-t border-slate-800/80 p-4">
          <div className="max-w-4xl mx-auto relative">
            
            {/* Quick suggestions tags */}
            <div className="flex flex-wrap gap-2 mb-3.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  disabled={isLoading}
                  className="px-3.5 py-1.5 text-xs font-semibold text-slate-400 hover:text-white bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 rounded-full transition-all disabled:opacity-50 shadow-sm"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            {/* Chat submit input form */}
            <form
              onSubmit={handleSubmit}
              className="relative flex items-center border border-slate-800 rounded-full shadow-2xl bg-slate-900/90 focus-within:ring-2 focus-within:ring-indigo-500/30 focus-within:border-indigo-500/80 transition-all duration-300"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask CineRAG: E.g., Recommend high-concept space sci-fi movies..."
                disabled={isLoading}
                className="flex-1 bg-transparent py-4 pl-6 pr-14 outline-none placeholder:text-slate-600 text-slate-200 text-sm font-medium"
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="absolute right-2 p-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-full flex items-center justify-center transition-all disabled:opacity-50 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-600 shadow-lg"
              >
                <Send className="w-4 h-4 ml-0.5" />
              </button>
            </form>
            
            <div className="flex flex-col sm:flex-row items-center justify-center mt-4 space-y-2 sm:space-y-0 sm:space-x-3">
               <p className="text-[10px] font-semibold text-slate-600 tracking-wider uppercase text-center">Data fetched dynamically from TMDB & indexed locally</p>
               <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer" className="flex items-center opacity-40 hover:opacity-75 transition-opacity">
                  <img src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg" alt="TMDB Logo" className="h-3.5" />
               </a>
            </div>
          </div>
        </footer>

        {/* Modal for detailed movie overview on click */}
        {selectedMovie && (
          <MovieModal movie={selectedMovie} onClose={() => setSelectedMovie(null)} />
        )}

      </div>
    </Tooltip.Provider>
  );
}
