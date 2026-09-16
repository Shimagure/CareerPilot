import { type HTMLAttributes, forwardRef } from 'react';
import { Button } from './Button';

interface ErrorStateProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  message: string;
  details?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export const ErrorState = forwardRef<HTMLDivElement, ErrorStateProps>(
  ({
    className = '',
    title = 'Something went wrong',
    message,
    details,
    onRetry,
    retryLabel = 'Try again',
    children,
    ...props
  }, ref) => {
    return (
      <div
        ref={ref}
        className={`flex flex-col items-center justify-center text-center py-12 px-4 ${className}`}
        {...props}
        role="alert"
      >
        <div className="w-16 h-16 rounded-full bg-red-500/[0.12] border border-red-500/[0.25] flex items-center justify-center text-red-400 mb-4">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-slate-100 mb-2">{title}</h3>
        <p className="text-slate-400 max-w-sm mb-2">{message}</p>
        {details && (
          <details className="text-sm text-slate-500 mb-4 max-w-sm text-left">
            <summary className="cursor-pointer hover:text-slate-300">Details</summary>
            <pre className="mt-2 p-3 bg-white/[0.05] rounded overflow-x-auto whitespace-pre-wrap text-slate-400">{details}</pre>
          </details>
        )}
        {onRetry && (
          <Button variant="primary" onClick={onRetry}>
            {retryLabel}
          </Button>
        )}
        {children}
      </div>
    );
  }
);

ErrorState.displayName = 'ErrorState';

/** Network error state */
export function NetworkError({ onRetry }: { onRetry?: () => void }) {
  return (
    <ErrorState
      title="Connection failed"
      message="Unable to connect to the server. Please check your connection and try again."
      onRetry={onRetry}
    />
  );
}

/** Not found error state */
export function NotFoundError({ resource = 'Resource', onBack }: { resource?: string; onBack?: () => void }) {
  return (
    <ErrorState
      title={`${resource} not found`}
      message={`The ${resource.toLowerCase()} you're looking for doesn't exist or has been removed.`}
      onRetry={onBack}
      retryLabel="Go back"
    />
  );
}

/** Generic API error state */
export function ApiError({ error, onRetry }: { error: Error | unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred';
  return (
    <ErrorState
      title="Request failed"
      message={message}
      details={error instanceof Error ? error.stack : String(error)}
      onRetry={onRetry}
    />
  );
}