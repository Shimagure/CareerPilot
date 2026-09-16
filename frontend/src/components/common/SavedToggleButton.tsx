import { Button } from './Button';
import { useSavedToggle } from '../../hooks/useSavedJobs';

function BookmarkIcon({ className = '', filled = false }: { className?: string; filled?: boolean }) {
  if (filled) {
    return (
      <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path fillRule="evenodd" clipRule="evenodd" d="M6.32 2.577a49.255 49.255 0 0111.36 0c1.497.174 2.57 1.46 2.57 2.93V21a.75.75 0 01-1.085.67L12 18.089l-7.165 3.583A.75.75 0 013.75 21V5.507c0-1.47 1.073-2.756 2.57-2.93z" />
      </svg>
    );
  }
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
    </svg>
  );
}

interface SavedToggleButtonProps {
  stableId: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Save/unsave toggle for one job, reused across Ranked Jobs, Job Detail, and
 * the Saved Jobs page. Derived from the shared saved-jobs query so state stays
 * consistent everywhere; disabled while a mutation is in flight to prevent
 * duplicate submissions.
 */
export function SavedToggleButton({ stableId, size = 'md', className = '' }: SavedToggleButtonProps) {
  const { isSaved, isPending, toggle } = useSavedToggle(stableId);

  const label = isPending ? (isSaved ? 'Removing…' : 'Saving…') : isSaved ? 'Saved' : 'Save job';

  return (
    <Button
      type="button"
      variant={isSaved ? 'secondary' : 'outline'}
      size={size}
      onClick={toggle}
      loading={isPending}
      aria-pressed={isSaved}
      title={isSaved ? 'Remove from saved jobs' : 'Save this job'}
      className={className}
    >
      <BookmarkIcon
        className={`w-4 h-4 mr-1.5 ${isSaved ? 'text-brand-600 dark:text-brand-400' : ''}`}
        filled={isSaved}
      />
      {label}
    </Button>
  );
}