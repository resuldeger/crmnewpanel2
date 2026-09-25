"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

/** Keeps a render crash from leaving the visitor on a blank black page. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Booking engine crashed:", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#050505] px-6 text-center">
        <p className="serif-font text-4xl font-bold text-[#FFBE4E]">Something went wrong</p>
        <p className="max-w-md text-sm text-zinc-500">
          The booking form could not be displayed. Reloading usually fixes it.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-full bg-[#FFBE4E] px-8 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-black transition-transform hover:scale-[1.03]"
        >
          Reload
        </button>
        {process.env.NODE_ENV !== "production" && (
          <pre className="max-w-lg overflow-auto rounded-xl bg-black/60 p-4 text-left text-[10px] text-red-400">
            {error.message}
          </pre>
        )}
      </div>
    );
  }
}
