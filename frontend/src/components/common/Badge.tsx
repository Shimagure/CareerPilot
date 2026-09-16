import { type HTMLAttributes, forwardRef } from 'react';
import type { WorkArrangement, ProcessingState, FitLevel } from '../../api/types';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  dot?: boolean;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className = '', variant = 'default', size = 'md', dot = false, children, ...props }, ref) => {
    const variants: Record<BadgeVariant, string> = {
      default: 'text-slate-300 bg-white/[0.06] border border-white/[0.1]',
      success: 'text-emerald-300 bg-emerald-500/[0.14] border border-emerald-500/[0.3]',
      warning: 'text-amber-300 bg-amber-500/[0.14] border border-amber-500/[0.3]',
      danger: 'text-red-300 bg-red-500/[0.14] border border-red-500/[0.3]',
      info: 'text-cyan-300 bg-cyan-500/[0.14] border border-cyan-500/[0.3]',
      neutral: 'text-brand-300 bg-brand-500/[0.14] border border-brand-500/[0.3]',
    };

    const sizes = {
      sm: 'px-2 py-0.5 text-xs',
      md: 'px-2.5 py-0.5 text-xs',
    };

    return (
      <span
        ref={ref}
        className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      >
        {dot && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />}
        {children}
      </span>
    );
  }
);

Badge.displayName = 'Badge';

/** Arrangement badge with semantic color mapping */
export function ArrangementBadge({ arrangement, className = '' }: { arrangement: WorkArrangement; className?: string }) {
  const configs: Record<WorkArrangement, { label: string; variant: BadgeProps['variant']; dot: boolean }> = {
    remote: { label: 'Remote', variant: 'success', dot: true },
    hybrid: { label: 'Hybrid', variant: 'info', dot: true },
    onsite: { label: 'On-site', variant: 'warning', dot: true },
    unspecified: { label: 'Unspecified', variant: 'neutral', dot: false },
  };

  const config = configs[arrangement] || configs.unspecified;

  return (
    <Badge variant={config.variant} dot={config.dot} className={className}>
      {config.label}
    </Badge>
  );
}

/** Processing state badge with semantic color mapping */
export function StateBadge({ state, className = '' }: { state: ProcessingState; className?: string }) {
  const configs: Record<ProcessingState, { label: string; variant: BadgeProps['variant'] }> = {
    NEW: { label: 'New', variant: 'info' },
    NEEDS_VERIFICATION: { label: 'Needs Verification', variant: 'info' },
    ACTIVE_VERIFIED: { label: 'Active Verified', variant: 'success' },
    ACTIVE_UNVERIFIED: { label: 'Active Unverified', variant: 'warning' },
    STALE: { label: 'Stale', variant: 'neutral' },
    CHANGED: { label: 'Changed', variant: 'info' },
    CLOSED_OR_EXPIRED: { label: 'Closed/Expired', variant: 'danger' },
    POSTING_CHANGED: { label: 'Posting Changed', variant: 'info' },
    DUPLICATE_OR_INVALID: { label: 'Duplicate/Invalid', variant: 'neutral' },
    DEPRIORITIZE: { label: 'Deprioritized', variant: 'neutral' },
    UNKNOWN: { label: 'Unknown', variant: 'default' },
  };

  const config = configs[state] || configs.UNKNOWN;

  return <Badge variant={config.variant} className={className}>{config.label}</Badge>;
}

/** Fit level badge with semantic color mapping */
export function FitBadge({ fit, className = '' }: { fit: FitLevel; className?: string }) {
  const configs: Record<FitLevel, { label: string; variant: BadgeProps['variant'] }> = {
    high: { label: 'High Fit', variant: 'success' },
    medium: { label: 'Medium Fit', variant: 'warning' },
    low: { label: 'Low Fit', variant: 'danger' },
    unknown: { label: 'Unknown Fit', variant: 'neutral' },
  };

  const config = configs[fit] || configs.unknown;

  return <Badge variant={config.variant} className={className}>{config.label}</Badge>;
}