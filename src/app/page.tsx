"use client";

import { useState, useRef, useCallback } from "react";

interface ProgressItem {
  id: number;
  type: "thinking" | "tool" | "status" | "task" | "error";
  text: string;
  toolStatus?: string;
}

type Phase = "idle" | "researching" | "done" | "error";

function MarkdownReport({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (const line of lines) {
    if (line.startsWith("### ")) {
      elements.push(
        <h3
          key={key++}
          className="text-lg font-semibold mt-6 mb-2 text-zinc-800 dark:text-zinc-100"
        >
          {line.slice(4)}
        </h3>,
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <h2
          key={key++}
          className="text-xl font-bold mt-8 mb-3 text-zinc-900 dark:text-zinc-50 border-b border-zinc-200 dark:border-zinc-700 pb-1"
        >
          {line.slice(3)}
        </h2>,
      );
    } else if (line.startsWith("# ")) {
      elements.push(
        <h1
          key={key++}
          className="text-2xl font-bold mt-8 mb-4 text-zinc-900 dark:text-zinc-50"
        >
          {line.slice(2)}
        </h1>,
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <li
          key={key++}
          className="ml-5 list-disc text-zinc-700 dark:text-zinc-300 leading-7"
        >
          {line.slice(2)}
        </li>,
      );
    } else if (line.match(/^\d+\. /)) {
      const content = line.replace(/^\d+\. /, "");
      elements.push(
        <li
          key={key++}
          className="ml-5 list-decimal text-zinc-700 dark:text-zinc-300 leading-7"
        >
          {content}
        </li>,
      );
    } else if (line === "") {
      elements.push(<div key={key++} className="h-3" />);
    } else {
      elements.push(
        <p key={key++} className="text-zinc-700 dark:text-zinc-300 leading-7">
          {line}
        </p>,
      );
    }
  }

  return <div className="space-y-0.5">{elements}</div>;
}

function ToolIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  if (n.includes("web") || n.includes("search") || n.includes("browse")) return "🔍";
  if (n.includes("read") || n.includes("file")) return "📄";
  if (n.includes("shell") || n.includes("run") || n.includes("exec")) return "⚡";
  if (n.includes("write") || n.includes("edit")) return "✏️";
  return "🔧";
}

export default function ResearchPage() {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [report, setReport] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  const progressEndRef = useRef<HTMLDivElement>(null);

  const addProgress = useCallback((item: Omit<ProgressItem, "id">) => {
    setProgress((prev) => {
      const next = [...prev, { ...item, id: idRef.current++ }];
      // Limit to last 100 items to prevent memory issues with long research sessions
      return next.slice(-100);
    });
    setTimeout(
      () => progressEndRef.current?.scrollIntoView({ behavior: "smooth" }),
      50,
    );
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const q = query.trim();
      if (!q || phase === "researching") return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setPhase("researching");
      setProgress([]);
      setReport("");
      setErrorMsg("");

      try {
        const res = await fetch("/api/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error((err as { error?: string }).error ?? "Research failed");
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("Response body is not readable");
        const decoder = new TextDecoder();
        let buffer = "";
        let reportAccum = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const line = part.startsWith("data: ") ? part.slice(6) : part;
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line) as Record<string, unknown>;
              const type = event.type as string;

              if (type === "thinking") {
                addProgress({
                  type: "thinking",
                  // Limit thinking display to 200 chars to keep the UI concise
                  text: String(event.text ?? "").slice(0, 200),
                });
              } else if (type === "tool") {
                addProgress({
                  type: "tool",
                  text: String(event.name ?? "tool"),
                  toolStatus: String(event.status ?? ""),
                });
              } else if (type === "status") {
                addProgress({ type: "status", text: String(event.message ?? "") });
              } else if (type === "task") {
                const text = String(event.text ?? event.status ?? "").trim();
                if (text) addProgress({ type: "task", text });
              } else if (type === "text") {
                reportAccum += String(event.delta ?? "");
                setReport(reportAccum);
              } else if (type === "done") {
                const finalResult = String(event.result ?? "").trim();
                if (finalResult && !reportAccum.trim()) {
                  setReport(finalResult);
                }
                setPhase("done");
              } else if (type === "error") {
                throw new Error(String(event.message ?? "Unknown error"));
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) continue;
              throw parseErr;
            }
          }
        }

        setPhase((p) => (p === "researching" ? "done" : p));
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    },
    [query, phase, addProgress],
  );

  const handleCancel = () => {
    abortRef.current?.abort();
    setPhase("idle");
  };

  const handleReset = () => {
    abortRef.current?.abort();
    setPhase("idle");
    setProgress([]);
    setReport("");
    setErrorMsg("");
    setQuery("");
  };

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950 font-sans">
      <div className="max-w-3xl mx-auto px-4 py-12 sm:px-6">
        {/* Header */}
        <div className="mb-10 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-zinc-900 dark:bg-zinc-100 mb-4">
            <span className="text-2xl">🔬</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Deep Research
          </h1>
          <p className="mt-2 text-zinc-500 dark:text-zinc-400 text-base">
            Powered by Cursor AI agents — researches your topic thoroughly and
            writes a comprehensive report.
          </p>
        </div>

        {/* Search form */}
        <form onSubmit={handleSubmit} className="flex gap-3 mb-8">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter a research topic or question…"
            disabled={phase === "researching"}
            className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 disabled:opacity-50 text-base"
          />
          {phase === "researching" ? (
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-xl bg-red-600 hover:bg-red-700 px-5 py-3 text-white font-medium transition-colors"
            >
              Cancel
            </button>
          ) : (
            <button
              type="submit"
              disabled={!query.trim()}
              className="rounded-xl bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 px-5 py-3 text-white dark:text-zinc-900 font-medium transition-colors disabled:opacity-40"
            >
              Research
            </button>
          )}
        </form>

        {/* Progress feed */}
        {progress.length > 0 && (
          <div className="mb-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Research Progress
              </span>
              {phase === "researching" && (
                <span className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live
                </span>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto px-4 py-3 space-y-2">
              {progress.map((item) => (
                <div key={item.id} className="flex items-start gap-2 text-sm">
                  {item.type === "thinking" && (
                    <>
                      <span className="mt-0.5 shrink-0 text-violet-500">💭</span>
                      <span className="text-zinc-600 dark:text-zinc-400 italic line-clamp-2">
                        {item.text}
                      </span>
                    </>
                  )}
                  {item.type === "tool" && (
                    <>
                      <span className="mt-0.5 shrink-0">
                        <ToolIcon name={item.text} />
                      </span>
                      <span className="text-zinc-700 dark:text-zinc-300">
                        <span className="font-medium">{item.text}</span>
                        {item.toolStatus && (
                          <span className="ml-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                            {item.toolStatus}
                          </span>
                        )}
                      </span>
                    </>
                  )}
                  {item.type === "task" && (
                    <>
                      <span className="mt-0.5 shrink-0">📋</span>
                      <span className="text-zinc-700 dark:text-zinc-300">{item.text}</span>
                    </>
                  )}
                  {item.type === "status" && (
                    <>
                      <span className="mt-0.5 shrink-0">ℹ️</span>
                      <span className="text-zinc-500 dark:text-zinc-400 text-xs">
                        {item.text}
                      </span>
                    </>
                  )}
                  {item.type === "error" && (
                    <>
                      <span className="mt-0.5 shrink-0">❌</span>
                      <span className="text-red-600 dark:text-red-400">{item.text}</span>
                    </>
                  )}
                </div>
              ))}
              <div ref={progressEndRef} />
            </div>
          </div>
        )}

        {/* Streaming / final report */}
        {report && (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Research Report
              </span>
              {phase === "done" && (
                <button
                  onClick={handleReset}
                  className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                >
                  New research
                </button>
              )}
            </div>
            <div className="px-5 py-5">
              <MarkdownReport text={report} />
              {phase === "researching" && (
                <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-0.5 align-text-bottom" />
              )}
            </div>
          </div>
        )}

        {/* Error state */}
        {phase === "error" && (
          <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 px-5 py-4">
            <p className="text-red-700 dark:text-red-400 font-medium text-sm">
              Research failed: {errorMsg}
            </p>
            <p className="text-red-500 dark:text-red-500 text-xs mt-1">
              Make sure <code className="font-mono">CURSOR_API_KEY</code> is set
              and valid.
            </p>
            <button
              onClick={handleReset}
              className="mt-3 text-xs text-red-600 dark:text-red-400 underline"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
