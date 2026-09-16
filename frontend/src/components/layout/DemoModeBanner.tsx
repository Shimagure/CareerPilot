import { useDemoMode } from '../../context/DemoModeContext';
import { Button } from '../common/Button';

export function DemoModeBanner() {
  const { isDemoMode, demoStatus, loading, error, toggleDemoMode, bootstrapDemo, resetDemo, refreshDemoStatus } = useDemoMode();

  if (!isDemoMode && !loading && !error) {
    return null;
  }

  return (
    <div className={`fixed top-16 right-4 z-50 w-80 transition-all duration-300 ${isDemoMode ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'}`}>
      <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg shadow-lg p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span className="font-semibold text-amber-800 dark:text-amber-200">Demo Mode Active</span>
            </div>
            <p className="text-sm text-amber-700 dark:text-amber-300 mb-3">
              Showing portfolio demo data. All job listings, pipeline status, and retention stats are simulated.
            </p>

            {demoStatus && (
              <div className="grid grid-cols-2 gap-2 text-xs mb-3 p-2 bg-white/50 dark:bg-gray-800/50 rounded">
                <div>
                  <span className="text-amber-600 dark:text-amber-400">Active Jobs:</span>
                  <span className="ml-1 font-mono">{demoStatus.active_jobs_count ?? 0}</span>
                </div>
                <div>
                  <span className="text-amber-600 dark:text-amber-400">Pipeline:</span>
                  <span className="ml-1 font-mono capitalize">{demoStatus.pipeline_stage ?? 'unknown'}</span>
                </div>
                <div>
                  <span className="text-amber-600 dark:text-amber-400">Stale:</span>
                  <span className="ml-1 font-mono">{demoStatus.stale_jobs_count ?? 0}</span>
                </div>
                <div>
                  <span className="text-amber-600 dark:text-amber-400">Blocked:</span>
                  <span className="ml-1 font-mono">{demoStatus.blocked_jobs_count ?? 0}</span>
                </div>
              </div>
            )}

            {error && (
              <p className="text-xs text-red-600 dark:text-red-400 mb-2">Error: {error}</p>
            )}
          </div>

          <button
            onClick={() => toggleDemoMode(false)}
            className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 transition-colors p-1"
            aria-label="Close demo mode"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {isDemoMode && !loading && (
          <div className="flex gap-2 pt-3 border-t border-amber-200 dark:border-amber-800">
            <Button
              variant="ghost"
              size="sm"
              onClick={bootstrapDemo}
              disabled={loading}
              className="flex-1"
            >
              Re-bootstrap
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={resetDemo}
              disabled={loading}
              className="flex-1"
            >
              Exit Demo Mode
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-2">
            <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" aria-label="Loading" />
          </div>
        )}
      </div>
    </div>
  );
}