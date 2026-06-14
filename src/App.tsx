import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUpDown,
  Bot,
  Calendar,
  Check,
  Copy,
  ExternalLink,
  Film,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Star,
  Trash2,
  TrendingUp,
  X,
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

const APP_NAME = "MovieRAG AI";

const INITIAL_MESSAGE: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "Welcome to **MovieRAG AI**. Ask natural movie questions and I will turn them into a live TMDB retrieval plan, build a RAG context, and answer with matching films.\n\nTry questions like:\n\n- Recommend some high-concept sci-fi movies about time travel and space exploration\n- What are Christopher Nolan's highest-rated movies? Tell me about the plot of Interstellar.\n- Show me some high-revenue action thriller films from the 2000s",
};

const SUGGESTIONS = [
  "Recommend high-concept sci-fi movies about time travel",
  "What are Christopher Nolan's highest-rated movies?",
  "Show high-revenue action thriller films from the 2000s",
  "Tell me about the plot of Interstellar",
];

function CopyButton({ text, movies }: { text: string; movies?: any[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    let fullText = text;
    if (movies && movies.length > 0) {
      fullText +=
        "\n\nMovie Results:\n" +
        movies
          .map(
            (movie) =>
              `- ${movie.title} (${movie.release_date?.substring(0, 4) || "N/A"}) - Rating: ${movie.vote_average?.toFixed(1) || "N/A"}/10`
          )
          .join("\n");
    }
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 shadow-sm transition hover:border-zinc-300 hover:text-zinc-900"
      title="Copy answer"
    >
      {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

function MovieModal({ movie, onClose }: { movie: any; onClose: () => void }) {
  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 p-4 backdrop-blur-xl">
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.96 }}
          className="relative grid w-full max-w-4xl overflow-hidden rounded-[2rem] border border-white/30 bg-white shadow-2xl md:grid-cols-[280px_1fr]"
        >
          <button
            onClick={onClose}
            className="absolute right-4 top-4 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white/90 text-zinc-500 shadow-sm backdrop-blur transition hover:text-zinc-950"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="relative min-h-[420px] bg-zinc-100">
            <img
              src={movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : `https://placehold.co/400x600/f4f4f5/18181b?text=${encodeURIComponent(movie.title)}`}
              alt={movie.title}
              className="h-full w-full object-cover"
            />
          </div>

          <div className="flex flex-col justify-between p-8">
            <div>
              <div className="mb-4 inline-flex items-center rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600">
                TMDB ID {movie.tmdbId}
              </div>
              <h2 className="text-3xl font-semibold tracking-tight text-zinc-950">{movie.title}</h2>
              <div className="mt-4 flex flex-wrap gap-2 text-sm font-medium">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-3 py-1.5 text-white">
                  <Calendar className="h-4 w-4" />
                  {movie.release_date ? movie.release_date.substring(0, 4) : "N/A"}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-amber-800">
                  <Star className="h-4 w-4 fill-amber-500/30" />
                  {movie.vote_average ? movie.vote_average.toFixed(1) : "N/A"}/10
                </span>
              </div>
              <div className="mt-8">
                <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-400">Overview</h3>
                <p className="mt-3 max-h-72 overflow-y-auto text-base leading-7 text-zinc-700">
                  {movie.overview || "No overview available for this movie."}
                </p>
              </div>
            </div>

            <a
              href={`https://www.themoviedb.org/movie/${movie.tmdbId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 inline-flex w-fit items-center gap-2 rounded-full bg-zinc-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800"
            >
              View on TMDB
              <ExternalLink className="h-4 w-4" />
            </a>
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
  const [sortField, setSortField] = useState<"rating" | "date" | "popularity">("rating");
  const [selectedMovie, setSelectedMovie] = useState<any | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
        body: JSON.stringify({ messages: updatedMessages.map((message) => ({ role: message.role, content: message.content })) }),
      });

      const data = await response.json();
      if (!response.ok) {
        const detail = data.details ? `, ${data.details}` : "";
        throw new Error((data.error || "Failed to get response") + detail);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          content: data.reply,
          metadata: data.movies,
          inferredParams: data.inferredParams,
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

  const sortMovies = (movies: any[]) => {
    const sorted = [...movies];
    if (sortField === "rating") return sorted.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
    if (sortField === "date") {
      return sorted.sort((a, b) => {
        const dateA = a.release_date ? new Date(a.release_date).getTime() : 0;
        const dateB = b.release_date ? new Date(b.release_date).getTime() : 0;
        return dateB - dateA;
      });
    }
    if (sortField === "popularity") return sorted.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    return sorted;
  };

  return (
    <Tooltip.Provider delayDuration={250}>
      <div className="min-h-screen bg-[#f7f3ea] text-zinc-950 antialiased">
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -left-32 top-0 h-96 w-96 rounded-full bg-orange-200/60 blur-3xl" />
          <div className="absolute right-0 top-32 h-96 w-96 rounded-full bg-sky-200/70 blur-3xl" />
          <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-violet-200/50 blur-3xl" />
        </div>

        <header className="sticky top-0 z-30 border-b border-zinc-950/10 bg-[#f7f3ea]/80 px-4 py-4 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-950 text-white shadow-lg shadow-zinc-950/10">
                <Film className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold tracking-tight">{APP_NAME}</h1>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">
                    Live RAG
                  </span>
                </div>
                <p className="text-xs font-medium text-zinc-500">TMDB retrieval, Hugging Face reasoning, movie answers that stay grounded.</p>
              </div>
            </div>

            <button
              onClick={handleClearChat}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-950/10 bg-white/70 px-4 py-2 text-xs font-semibold text-zinc-600 shadow-sm transition hover:bg-white hover:text-zinc-950"
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">Clear chat</span>
            </button>
          </div>
        </header>

        <main className="relative z-10 mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[340px_1fr]">
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-4">
              <section className="rounded-[2rem] border border-zinc-950/10 bg-white/75 p-6 shadow-xl shadow-zinc-950/5 backdrop-blur">
                <div className="inline-flex items-center gap-2 rounded-full bg-zinc-950 px-3 py-1 text-xs font-semibold text-white">
                  <Sparkles className="h-3.5 w-3.5" />
                  Intelligent movie RAG
                </div>
                <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-tight">Ask like a human. Search like an analyst.</h2>
                <p className="mt-3 text-sm leading-6 text-zinc-600">
                  MovieRAG AI reads your question, plans a TMDB retrieval strategy, builds a temporary vector index, and answers with movie cards.
                </p>
              </section>

              <section className="rounded-[2rem] border border-zinc-950/10 bg-zinc-950 p-6 text-white shadow-xl shadow-zinc-950/10">
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-400">Try these</h3>
                <div className="mt-4 space-y-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setInput(suggestion)}
                      disabled={isLoading}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-medium text-zinc-200 transition hover:border-white/20 hover:bg-white/10 disabled:opacity-50"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </aside>

          <section className="flex h-[calc(100vh-7.5rem)] min-h-[680px] flex-col overflow-hidden rounded-[2rem] border border-zinc-950/10 bg-white/80 shadow-2xl shadow-zinc-950/10 backdrop-blur-xl">
            <div className="border-b border-zinc-950/10 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-400">Conversation</p>
                  <h2 className="text-lg font-semibold text-zinc-950">Movie intelligence workspace</h2>
                </div>
                <div className="flex items-center gap-2 rounded-full border border-zinc-950/10 bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-zinc-600">
                  <Search className="h-3.5 w-3.5" />
                  Live TMDB data
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
              <div className="space-y-6">
                <AnimatePresence initial={false}>
                  {messages.map((msg) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25 }}
                      className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
                    >
                      <div className={cn("max-w-[92%] rounded-[1.6rem] px-5 py-4 shadow-sm", msg.role === "user" ? "bg-zinc-950 text-white" : "w-full border border-zinc-950/10 bg-white text-zinc-800")}>
                        {msg.role === "assistant" ? (
                          <div className="space-y-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-zinc-400">
                                <Bot className="h-4 w-4" />
                                MovieRAG response
                              </div>
                              <CopyButton text={msg.content} movies={msg.metadata} />
                            </div>

                            {msg.inferredParams && (
                              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-950/10 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                                <span className="font-bold text-zinc-950">Retrieval plan</span>
                                <span>{msg.inferredParams.search_type?.replace(/_/g, " ")}</span>
                                {msg.inferredParams.person_name && <span>Person: {msg.inferredParams.person_name}</span>}
                                {msg.inferredParams.person_role && <span>Role: {msg.inferredParams.person_role}</span>}
                                {msg.inferredParams.genres?.length > 0 && <span>Genres: {msg.inferredParams.genres.join(", ")}</span>}
                                {msg.inferredParams.year_from && <span>Years: {msg.inferredParams.year_from}-{msg.inferredParams.year_to || msg.inferredParams.year_from}</span>}
                              </div>
                            )}

                            <div className="prose prose-zinc max-w-none text-sm leading-7 prose-p:my-3 prose-li:my-1">
                              <ReactMarkdown>{msg.content}</ReactMarkdown>
                            </div>

                            {msg.metadata && msg.metadata.length > 0 && (
                              <div className="border-t border-zinc-950/10 pt-5">
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                  <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
                                    <MessageSquareText className="h-4 w-4" />
                                    Movie results ({msg.metadata.length})
                                  </h4>
                                  <div className="flex items-center gap-1 rounded-full border border-zinc-950/10 bg-zinc-50 p-1 text-xs font-semibold">
                                    <span className="px-2 text-zinc-500"><ArrowUpDown className="inline h-3.5 w-3.5" /> Sort</span>
                                    {(["rating", "date", "popularity"] as const).map((field) => (
                                      <button
                                        key={field}
                                        onClick={() => setSortField(field)}
                                        className={cn("rounded-full px-3 py-1 capitalize transition", sortField === field ? "bg-zinc-950 text-white" : "text-zinc-500 hover:text-zinc-950")}
                                      >
                                        {field}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                                  {sortMovies(msg.metadata).map((movie, index) => (
                                    <motion.div
                                      key={`${movie.tmdbId}-${index}`}
                                      initial={{ opacity: 0, y: 12 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      transition={{ duration: 0.25, delay: Math.min(index * 0.025, 0.35) }}
                                      onClick={() => setSelectedMovie(movie)}
                                    >
                                      <Tooltip.Root>
                                        <Tooltip.Trigger asChild>
                                          <button className="group w-full overflow-hidden rounded-2xl border border-zinc-950/10 bg-white text-left shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
                                            <div className="relative aspect-[2/3] bg-zinc-100">
                                              <img
                                                src={movie.poster_path ? `https://image.tmdb.org/t/p/w300${movie.poster_path}` : `https://placehold.co/300x450/f4f4f5/18181b?text=${encodeURIComponent(movie.title)}`}
                                                alt={movie.title}
                                                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                                                loading="lazy"
                                              />
                                              {movie.vote_average > 0 && (
                                                <div className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-[11px] font-bold text-zinc-950 shadow-sm backdrop-blur">
                                                  <Star className="h-3 w-3 fill-amber-400 text-amber-500" />
                                                  {movie.vote_average.toFixed(1)}
                                                </div>
                                              )}
                                            </div>
                                            <div className="p-3">
                                              <h5 className="line-clamp-2 text-sm font-semibold leading-tight text-zinc-950">{movie.title}</h5>
                                              <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
                                                <span>{movie.release_date ? movie.release_date.substring(0, 4) : "N/A"}</span>
                                                <TrendingUp className="h-3.5 w-3.5" />
                                              </div>
                                            </div>
                                          </button>
                                        </Tooltip.Trigger>
                                        <Tooltip.Portal>
                                          <Tooltip.Content className="z-50 max-w-xs rounded-2xl border border-zinc-200 bg-white p-4 text-xs leading-5 text-zinc-700 shadow-2xl" sideOffset={8}>
                                            <div className="mb-1 text-sm font-bold text-zinc-950">{movie.title}</div>
                                            <p className="line-clamp-3">{movie.overview || "No overview available."}</p>
                                            <Tooltip.Arrow className="fill-white" />
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
                          <p className="whitespace-pre-wrap text-sm font-medium leading-6">{msg.content}</p>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {isLoading && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start">
                    <div className="inline-flex items-center gap-3 rounded-2xl border border-zinc-950/10 bg-white px-5 py-4 text-sm font-medium text-zinc-600 shadow-sm">
                      <Loader2 className="h-5 w-5 animate-spin text-zinc-950" />
                      Planning TMDB retrieval and building RAG context...
                    </div>
                  </motion.div>
                )}

                {error && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-center">
                    <div className="inline-flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                      <RefreshCw className="h-4 w-4" />
                      {error}
                    </div>
                  </motion.div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            <footer className="border-t border-zinc-950/10 bg-white/85 p-4 backdrop-blur">
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(suggestion)}
                    disabled={isLoading}
                    className="shrink-0 rounded-full border border-zinc-950/10 bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-zinc-600 disabled:opacity-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
              <form onSubmit={handleSubmit} className="flex items-center gap-3 rounded-[1.5rem] border border-zinc-950/10 bg-zinc-50 p-2 shadow-inner">
                <input
                  type="text"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask MovieRAG AI about directors, plots, genres, revenue, decades, ratings..."
                  disabled={isLoading}
                  className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm font-medium text-zinc-950 outline-none placeholder:text-zinc-400"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-950 text-white transition hover:bg-zinc-800 disabled:bg-zinc-300"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
              <p className="mt-3 text-center text-[11px] font-medium text-zinc-400">
                Powered by TMDB retrieval, temporary vector indexing, and Hugging Face inference.
              </p>
            </footer>
          </section>
        </main>

        {selectedMovie && <MovieModal movie={selectedMovie} onClose={() => setSelectedMovie(null)} />}
      </div>
    </Tooltip.Provider>
  );
}
