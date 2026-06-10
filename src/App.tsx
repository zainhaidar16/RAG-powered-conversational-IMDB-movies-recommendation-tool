import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Send, Loader2, Clapperboard, RefreshCw, Trash2, Copy, Check } from "lucide-react";
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
  content: "Hello! I am your personal TMDB movie expert. I can recommend movies from around the world based on your preferences. Try asking for a 'sci-fi movie about space', the 'best crime dramas', or 'all movies directed by Christopher Nolan'!",
};

const SUGGESTIONS = ["Action", "Comedy", "Sci-Fi", "Top Rated", "Directed by Nolan"];

function CopyButton({ text, movies }: { text: string; movies?: any[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    let fullText = text;
    if (movies && movies.length > 0) {
      fullText += "\n\nRecommended Movies:\n" + movies.map(m => `- ${m.title} (${m.release_date?.substring(0,4) || 'N/A'})`).join("\n");
    }
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex flex-col h-screen bg-slate-50 text-slate-900 font-sans">
        {/* Header */}
        <header className="flex-shrink-0 flex justify-between items-center py-4 px-6 bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-indigo-100 text-indigo-600">
              <Clapperboard className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-800">Cinematic Intelligence</h1>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-widest mt-0.5">Powered by TMDB</p>
            </div>
          </div>
          <button
            onClick={handleClearChat}
            className="flex items-center space-x-2 px-3 py-2 text-sm font-medium text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100"
            title="Clear Chat"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden sm:inline">Clear Chat</span>
          </button>
        </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto px-4 py-8 mb-4">
        <div className="max-w-3xl mx-auto space-y-8 flex flex-col justify-end min-h-full">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className={cn(
                  "flex w-full",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] sm:max-w-[75%] rounded-2xl px-5 py-4 leading-relaxed tracking-wide shadow-sm group",
                    msg.role === "user"
                      ? "bg-slate-800 text-white rounded-tr-sm"
                      : "bg-white text-slate-800 border border-slate-200 rounded-tl-sm ring-1 ring-black/5"
                  )}
                >
                  {msg.role === "assistant" ? (
                    <div className="flex flex-col gap-4 relative">
                      <div className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <CopyButton text={msg.content} movies={msg.metadata} />
                      </div>
                      {msg.inferredParams && (
                        <div className="text-[10px] text-indigo-700 bg-indigo-50/50 border border-indigo-100 px-2 py-1 rounded-md self-start font-mono flex flex-wrap items-center gap-1.5 shadow-sm">
                          <span className="font-bold uppercase tracking-wider">{msg.inferredParams.search_type.replace(/_/g, ' ')}</span>
                          {msg.inferredParams.person_name && (
                            <>
                              <span className="text-slate-300">•</span>
                              <span>Person: <strong className="text-slate-700">{msg.inferredParams.person_name}</strong></span>
                            </>
                          )}
                          {msg.inferredParams.movie_name && (
                            <>
                              <span className="text-slate-300">•</span>
                              <span>Movie: <strong className="text-slate-700">{msg.inferredParams.movie_name}</strong></span>
                            </>
                          )}
                          <span className="text-slate-300">•</span>
                          <span>Limit: <strong className="text-slate-700">{msg.inferredParams.number_of_movies_requested}</strong></span>
                        </div>
                      )}
                      <div className="prose prose-sm md:prose-base prose-slate max-w-none break-words [&>p:last-child]:mb-0 pr-6">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                      {msg.metadata && msg.metadata.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mt-2">
                          {msg.metadata.map((movie, idx) => (
                            <motion.div 
                              key={idx}
                              initial={{ opacity: 0, y: 15 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.4, delay: idx * 0.1, ease: "easeOut" }}
                            >
                              <Tooltip.Root>
                                <Tooltip.Trigger asChild>
                                  <a 
                                    href={`https://www.themoviedb.org/movie/${movie.tmdbId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex flex-col h-full bg-slate-100 rounded-lg shadow-sm border border-slate-200 cursor-pointer overflow-hidden hover:ring-2 hover:ring-indigo-400 transition-all hover:scale-[1.02] duration-200"
                                  >
                                    <img 
                                      src={movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : `https://placehold.co/300x450/1e293b/ffffff?text=${encodeURIComponent(movie.title)}`} 
                                      alt={movie.title} 
                                      className="w-full aspect-[2/3] object-cover"
                                    />
                                    <div className="p-2 text-xs font-semibold text-slate-700 truncate text-center bg-white flex-1 flex items-center justify-center">
                                      {movie.title}
                                    </div>
                                  </a>
                                </Tooltip.Trigger>
                                <Tooltip.Portal>
                                  <Tooltip.Content
                                    className="z-50 max-w-xs bg-slate-900 text-white p-3 rounded-xl shadow-xl text-sm leading-relaxed border border-slate-700 pointer-events-none"
                                    sideOffset={5}
                                  >
                                    <div className="font-semibold text-base mb-1">{movie.title}</div>
                                    <div className="flex items-center space-x-2 text-indigo-300 text-xs font-medium mb-2">
                                      <span>{movie.release_date || "Unknown date"}</span>
                                      <span>•</span>
                                      <span>⭐ {movie.vote_average ? movie.vote_average.toFixed(1) : "N/A"}/10</span>
                                    </div>
                                    <p className="text-slate-300 text-xs line-clamp-4">{movie.overview || "No overview available."}</p>
                                    <Tooltip.Arrow className="fill-slate-900" />
                                  </Tooltip.Content>
                                </Tooltip.Portal>
                              </Tooltip.Root>
                            </motion.div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap font-medium">{msg.content}</p>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          
          {isLoading && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex justify-start w-full"
            >
              <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-6 py-5 shadow-sm ring-1 ring-black/5 flex items-center space-x-3 text-slate-500">
                <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                <span className="text-sm font-medium animate-pulse">Syncing with cinematic database...</span>
              </div>
            </motion.div>
          )}

          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex justify-center w-full"
            >
              <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg border border-red-100 flex items-center space-x-2 text-sm shadow-sm">
                <RefreshCw className="w-4 h-4" />
                <span>{error}</span>
              </div>
            </motion.div>
          )}

          <div ref={messagesEndRef} className="h-px" />
        </div>
      </main>

      {/* Input Area */}
      <footer className="flex-shrink-0 bg-white border-t border-slate-200 p-4">
        <div className="max-w-3xl mx-auto relative">
          {/* Quick Filters */}
          <div className="flex flex-wrap gap-2 mb-3">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => setInput((prev) => prev + (prev ? " " : "") + suggestion)}
                disabled={isLoading}
                className="px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 rounded-full transition-colors disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>

          <form
            onSubmit={handleSubmit}
            className="relative flex items-center border border-slate-300 rounded-full shadow-sm bg-slate-50 focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-400 transition-all duration-200"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="E.g., Which movies were directed by Christopher Nolan?"
              disabled={isLoading}
              className="flex-1 bg-transparent py-4 pl-6 pr-14 outline-none placeholder:text-slate-400 text-slate-700 text-[15px]"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="absolute right-2 p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full flex items-center justify-center transition-all disabled:opacity-50 disabled:bg-slate-400 shadow-sm"
            >
              <Send className="w-4 h-4 ml-0.5" />
            </button>
          </form>
          <div className="flex flex-col sm:flex-row items-center justify-center mt-4 space-y-2 sm:space-y-0 sm:space-x-3">
             <p className="text-[11px] font-medium text-slate-400 tracking-wide text-center">Responses are AI-generated based on The Movie Database (TMDB).</p>
             <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer" className="flex items-center">
                <img src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg" alt="TMDB Logo" className="h-4" />
             </a>
          </div>
        </div>
      </footer>
      </div>
    </Tooltip.Provider>
  );
}
