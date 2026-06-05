import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Top-level error boundary so a render/runtime error in one part of the tree
 * shows a recoverable fallback instead of a blank white screen.
 *
 * NOTE: `props`/`state` are declared explicitly because this project does not
 * currently install @types/react, so the React.Component base resolves to
 * `any` and would not otherwise expose them. Adding @types/react (tracked as a
 * type-safety follow-up) would let these declarations be removed.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  declare props: ErrorBoundaryProps;
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('Uncaught error in React tree:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-[#F4F4F4]">
          <div className="bg-white border-4 border-black rounded-xl p-8 max-w-md shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <h1 className="text-2xl font-black uppercase tracking-tighter mb-2">Something broke</h1>
            <p className="font-bold text-gray-600 mb-6">
              An unexpected error occurred. Reloading usually fixes it.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-lego-red text-white font-black uppercase px-6 py-3 border-4 border-black rounded-lg shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 transition-transform"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
