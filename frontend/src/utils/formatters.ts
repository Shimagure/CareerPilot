import { format, formatDistanceToNow, parseISO } from 'date-fns';

/** Format a date string for display */
export function formatDate(dateString: string | null | undefined, pattern: string = 'PPp'): string {
  if (!dateString) return '—';
  try {
    return format(parseISO(dateString), pattern);
  } catch {
    return 'Invalid date';
  }
}

/** Format a date as relative time (e.g., "2 hours ago") */
export function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  try {
    return formatDistanceToNow(parseISO(dateString), { addSuffix: true });
  } catch {
    return 'Invalid date';
  }
}

/** Format salary for display */
export function formatSalary(salary: string | null | undefined): string {
  if (!salary) return 'Not specified';
  return salary;
}

/** Truncate text with ellipsis */
export function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return text.slice(0, length - 3) + '...';
}

/** Generate initials from a name */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/** Format number with commas */
export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return '—';
  return num.toLocaleString();
}

/** Format a file size in bytes for display */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

/** Get color class for fit level */
export function getFitColorClass(fit: string): string {
  switch (fit) {
    case 'high':
      return 'text-green-600 dark:text-green-400';
    case 'medium':
      return 'text-amber-600 dark:text-amber-400';
    case 'low':
      return 'text-red-600 dark:text-red-400';
    default:
      return 'text-gray-500 dark:text-gray-400';
  }
}

/** Get color class for processing state */
export function getStateColorClass(state: string): string {
  switch (state) {
    case 'ACTIVE_VERIFIED':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'ACTIVE_UNVERIFIED':
      return 'text-amber-600 dark:text-amber-400';
    case 'STALE':
      return 'text-gray-500 dark:text-gray-400';
    case 'CHANGED':
      return 'text-blue-600 dark:text-blue-400';
    case 'CLOSED_OR_EXPIRED':
      return 'text-red-600 dark:text-red-400';
    case 'NEW':
    case 'NEEDS_VERIFICATION':
      return 'text-brand-600 dark:text-brand-400';
    default:
      return 'text-gray-500 dark:text-gray-400';
  }
}