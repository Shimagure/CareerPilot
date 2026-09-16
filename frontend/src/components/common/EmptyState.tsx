import { type HTMLAttributes, forwardRef } from 'react';
import { Button } from './Button';

interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary' | 'ghost';
  };
  className?: string;
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className = '', icon, title, description, action, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`flex flex-col items-center justify-center text-center py-12 px-4 ${className}`}
        {...props}
      >
        {icon && (
          <div className="w-16 h-16 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-slate-400 mb-4">
            {icon}
          </div>
        )}
        <h3 className="text-lg font-semibold text-slate-100 mb-2">{title}</h3>
        {description && (
          <p className="text-slate-400 max-w-sm mb-6">{description}</p>
        )}
        {action && (
          <Button variant={action.variant || 'primary'} onClick={action.onClick}>
            {action.label}
          </Button>
        )}
        {children}
      </div>
    );
  }
);

EmptyState.displayName = 'EmptyState';

/** Pre-built empty states for common scenarios */
export function NoJobsFound({ onRetry }: { onRetry?: () => void }) {
  return (
    <EmptyState
      title="No jobs found"
      description="Try adjusting your filters or run a new search to discover more opportunities."
      action={onRetry ? { label: 'Retry Search', onClick: onRetry } : undefined}
    >
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    </EmptyState>
  );
}

export function NoApplications({ onAdd }: { onAdd?: () => void }) {
  return (
    <EmptyState
      title="No applications yet"
      description="Start tracking your job applications to see them here."
      action={onAdd ? { label: 'Add Application', onClick: onAdd } : undefined}
    >
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    </EmptyState>
  );
}

export function NoDataAvailable({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <EmptyState
      title="No data available"
      description="There's nothing to display at the moment."
      action={onRefresh ? { label: 'Refresh', onClick: onRefresh } : undefined}
    >
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    </EmptyState>
  );
}