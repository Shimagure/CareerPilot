import { type HTMLAttributes, forwardRef } from 'react';

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
  animation?: 'pulse' | 'wave' | 'none';
}

export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className = '', variant = 'text', width, height, animation = 'pulse', style, ...props }, ref) => {
    const baseStyles = 'bg-white/[0.07] rounded';
    const animations = {
      pulse: 'animate-pulse',
      wave: 'animate-[wave_1.5s_ease-in-out_infinite]',
      none: '',
    };

    const variants = {
      text: 'h-4',
      circular: 'rounded-full',
      rectangular: 'rounded-lg',
    };

    const widthStyle = width ? { width: typeof width === 'number' ? `${width}px` : width } : {};
    const heightStyle = height ? { height: typeof height === 'number' ? `${height}px` : height } : {};

    return (
      <div
        ref={ref}
        className={`${baseStyles} ${variants[variant]} ${animations[animation]} ${className}`}
        style={{ ...widthStyle, ...heightStyle, ...style }}
        {...props}
        aria-hidden="true"
      />
    );
  }
);

Skeleton.displayName = 'Skeleton';

export { Skeleton as LoadingSkeleton };

/** Pre-built skeleton components for common patterns */
export function CardSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <Skeleton variant="rectangular" height="200" width="100%" />
      <div className="space-y-3 px-4 pb-4">
        <Skeleton variant="text" width="60%" height="24" />
        <Skeleton variant="text" width="100%" height="16" />
        <Skeleton variant="text" width="80%" height="16" />
        <div className="flex gap-2 mt-4">
          <Skeleton variant="circular" width="80" height="24" />
          <Skeleton variant="circular" width="80" height="24" />
        </div>
      </div>
    </div>
  );
}

export function TableRowSkeleton({ columns = 6 }: { columns?: number }) {
  return (
    <tr>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="py-3">
          <Skeleton variant="text" width={i === 0 ? '80%' : '60%'} height="16" />
        </td>
      ))}
    </tr>
  );
}

export function ListSkeleton({ items = 5 }: { items?: number }) {
  return (
    <div className="space-y-4 animate-pulse">
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4">
          <Skeleton variant="circular" width="48" height="48" />
          <div className="flex-1 space-y-2">
            <Skeleton variant="text" width="40%" height="20" />
            <Skeleton variant="text" width="60%" height="14" />
          </div>
          <Skeleton variant="circular" width="80" height="24" />
        </div>
      ))}
    </div>
  );
}

export function DashboardStatsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} variant="rectangular" height="100" width="100%" />
      ))}
    </div>
  );
}