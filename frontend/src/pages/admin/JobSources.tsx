import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../../api/client';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Badge } from '../../components/common/Badge';
import { Card } from '../../components/common/Card';
import {
  Plus,
  Search,
  RefreshCw,
  Eye,
  Edit,
  Trash2,
  Play,
  Pause,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  Globe,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface JobSource {
  id: string;
  name: string;
  display_name: string;
  base_url: string;
  domain: string;
  source_type: string;
  status: string;
  enabled: boolean;
  adapter_name: string | null;
  health_status: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
  analysis_data?: {
    platform_detected?: string | null;
    has_search_form?: boolean;
    has_pagination?: boolean;
    has_json_ld?: boolean;
    robots_txt_status?: string;
    feasibility?: string;
    title?: string | null;
    meta_description?: string | null;
  };
}

interface JobSourceListResponse {
  sources: JobSource[];
  total: number;
  page: number;
  page_size: number;
}

interface SourceAnalyzeRequest {
  url: string;
  source_name?: string;
}

interface SourceAnalyzeResponse {
  url: string;
  domain: string;
  title: string | null;
  meta_description: string | null;
  platform_detected: string | null;
  has_search_form: boolean;
  has_pagination: boolean;
  has_json_ld: boolean;
  robots_txt_status: string;
  feasibility: string;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  discovered: 'default',
  analyzing: 'info',
  ready_for_review: 'warning',
  approved: 'success',
  enabled: 'success',
  disabled: 'danger',
};

const STATUS_LABELS: Record<string, string> = {
  discovered: 'Discovered',
  analyzing: 'Analyzing',
  ready_for_review: 'Ready for Review',
  approved: 'Approved',
  enabled: 'Enabled',
  disabled: 'Disabled',
};

export function JobSourcesPage() {
  const [sources, setSources] = useState<JobSource[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [enabledFilter, setEnabledFilter] = useState<string>('');

  // Add source modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState('');
  const [addDisplayName, setAddDisplayName] = useState('');
  const [addBaseUrl, setAddBaseUrl] = useState('');
  const [addSourceType, setAddSourceType] = useState('job_board');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Analyze modal
  const [showAnalyzeModal, setShowAnalyzeModal] = useState(false);
  const [analyzeUrl, setAnalyzeUrl] = useState('');
  const [analyzeSourceName, setAnalyzeSourceName] = useState('');
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzeResult, setAnalyzeResult] = useState<SourceAnalyzeResponse | null>(null);

  // Detail modal
  const [selectedSource, setSelectedSource] = useState<JobSource | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Edit modal
  const [editingSource, setEditingSource] = useState<JobSource | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editSourceType, setEditSourceType] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editEnabled, setEditEnabled] = useState(false);
  const [editAdapterName, setEditAdapterName] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete confirmation
  const [deletingSource, setDeletingSource] = useState<JobSource | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Fetch sources
  const fetchSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', String(pageSize));
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('source_type', typeFilter);
      if (enabledFilter) params.set('enabled', enabledFilter);

      const response = await apiClient.instance.get(`/api/admin/sources?${params.toString()}`);
      const data: JobSourceListResponse = response.data;
      setSources(data.sources);
      setTotal(data.total);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to fetch job sources');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter, typeFilter, enabledFilter]);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    setAddLoading(true);
    try {
      await apiClient.instance.post('/api/admin/sources', {
        name: addName,
        display_name: addDisplayName,
        base_url: addBaseUrl,
        source_type: addSourceType,
      });
      setShowAddModal(false);
      setAddName('');
      setAddDisplayName('');
      setAddBaseUrl('');
      setAddSourceType('job_board');
      fetchSources();
    } catch (err: any) {
      setAddError(err.response?.data?.detail || 'Failed to create job source');
    } finally {
      setAddLoading(false);
    }
  };

  const handleAnalyzeUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setAnalyzeError(null);
    setAnalyzeResult(null);
    setAnalyzeLoading(true);
    try {
      const response = await apiClient.instance.post('/api/admin/sources/analyze', {
        url: analyzeUrl,
        source_name: analyzeSourceName || undefined,
      });
      setAnalyzeResult(response.data);
    } catch (err: any) {
      setAnalyzeError(err.response?.data?.detail || 'Failed to analyze URL');
    } finally {
      setAnalyzeLoading(false);
    }
  };

  const handleOpenAnalyzeExisting = async (source: JobSource) => {
    setAnalyzeError(null);
    setAnalyzeResult(null);
    setAnalyzeLoading(true);
    try {
      const response = await apiClient.instance.post(`/api/admin/sources/${source.id}/analyze`);
      setAnalyzeResult(response.data);
      setShowAnalyzeModal(true);
    } catch (err: any) {
      setAnalyzeError(err.response?.data?.detail || 'Failed to analyze source');
    } finally {
      setAnalyzeLoading(false);
    }
  };

  const handleUpdateSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSource) return;
    setEditError(null);
    setEditLoading(true);
    try {
      await apiClient.instance.patch(`/api/admin/sources/${editingSource.id}`, {
        display_name: editDisplayName,
        source_type: editSourceType,
        status: editStatus,
        enabled: editEnabled,
        adapter_name: editAdapterName || undefined,
      });
      setEditingSource(null);
      setShowDetailModal(false);
      fetchSources();
    } catch (err: any) {
      setEditError(err.response?.data?.detail || 'Failed to update job source');
    } finally {
      setEditLoading(false);
    }
  };

  const handleOpenEdit = (source: JobSource) => {
    setEditingSource(source);
    setEditDisplayName(source.display_name);
    setEditSourceType(source.source_type);
    setEditStatus(source.status);
    setEditEnabled(source.enabled);
    setEditAdapterName(source.adapter_name || '');
    setShowDetailModal(false);
  };

  const handleDeleteSource = async () => {
    if (!deletingSource) return;
    setDeleteLoading(true);
    try {
      await apiClient.instance.delete(`/api/admin/sources/${deletingSource.id}`);
      setDeletingSource(null);
      fetchSources();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to delete job source');
    } finally {
      setDeleteLoading(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString();
  };

  const getFeasibilityLabel = (feasibility: string) => {
    const labels: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'default' }> = {
      high_feasibility: { label: 'High Feasibility', variant: 'success' },
      api_available: { label: 'API Available', variant: 'success' },
      requires_scraping: { label: 'Requires Scraping', variant: 'warning' },
      requires_manual_review: { label: 'Manual Review', variant: 'info' },
      blocked_by_robots: { label: 'Blocked by Robots', variant: 'danger' },
      non_html_content: { label: 'Non-HTML Content', variant: 'danger' },
      redirect_loop: { label: 'Redirect Loop', variant: 'danger' },
      http_error: { label: 'HTTP Error', variant: 'danger' },
      timeout: { label: 'Timeout', variant: 'danger' },
      unknown: { label: 'Unknown', variant: 'default' },
    };
    return labels[feasibility] || { label: feasibility, variant: 'default' };
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-50">Job Sources</h1>
          <p className="text-sm text-slate-400 mt-1">Manage job portal sources and analyze new candidates</p>
        </div>
        <Button onClick={() => setShowAddModal(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Source
        </Button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex items-center justify-between">
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={fetchSources}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[200px]">
            <Input
              placeholder="Filter by status..."
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="max-w-xs"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <Input
              placeholder="Filter by type..."
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="max-w-xs"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <select
              value={enabledFilter}
              onChange={(e) => setEnabledFilter(e.target.value)}
              className="w-full max-w-xs rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            >
              <option value="">All enabled states</option>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </div>
          <Button variant="ghost" onClick={fetchSources} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </Card>

      {/* Sources Table */}
      <Card className="overflow-hidden">
        {loading && sources.length === 0 && (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
              <span className="text-slate-400">Loading job sources...</span>
            </div>
          </div>
        )}

        {!loading && sources.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Globe className="h-12 w-12 text-slate-600 mb-4" />
            <h3 className="text-lg font-medium text-slate-300">No job sources found</h3>
            <p className="text-sm text-slate-500 mt-1">Add your first job source to get started</p>
            <Button onClick={() => setShowAddModal(true)} className="mt-4 gap-2">
              <Plus className="h-4 w-4" />
              Add Source
            </Button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">URL / Domain</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Adapter</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Health</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Enabled</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Last Checked</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {sources.map((source) => (
                <tr key={source.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-100">{source.display_name}</div>
                    <div className="text-xs text-slate-500">{source.name}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-slate-300 truncate max-w-xs" title={source.base_url}>
                      {source.base_url}
                    </div>
                    <div className="text-xs text-slate-500">{source.domain}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="default">{source.source_type.replace('_', ' ').toUpperCase()}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={(STATUS_COLORS[source.status] || 'default') as 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'}>
                      {STATUS_LABELS[source.status] || source.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-slate-400 font-mono">
                      {source.adapter_name || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={source.health_status === 'healthy' ? 'success' : source.health_status === 'degraded' ? 'warning' : source.health_status === 'unhealthy' ? 'danger' : 'default'}>
                      {source.health_status?.replace('_', ' ') || 'Insufficient evidence'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={source.enabled ? 'success' : 'default'}>
                      {source.enabled ? 'Yes' : 'No'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {formatDate(source.last_checked_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenAnalyzeExisting(source)}
                        disabled={analyzeLoading}
                        className="text-slate-400 hover:text-brand-400"
                        title="Analyze"
                      >
                        <Search className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedSource(source);
                          setShowDetailModal(true);
                        }}
                        className="text-slate-400 hover:text-slate-100"
                        title="View Details"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenEdit(source)}
                        className="text-slate-400 hover:text-slate-100"
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeletingSource(source)}
                        className="text-slate-400 hover:text-red-400"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > pageSize && (
          <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between">
            <span className="text-sm text-slate-500">
              Showing {Math.min((page - 1) * pageSize + 1, total)} to {Math.min(page * pageSize, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
              >
                Prev
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={page * pageSize >= total || loading}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Add Source Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-night-900 rounded-2xl w-full max-w-md shadow-2xl border border-white/10 overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-50">Add Job Source</h2>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-100">
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleAddSource} className="p-6 space-y-4">
              {addError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {addError}
                </div>
              )}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-300">Source Name</label>
                <Input
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="e.g., indeed"
                  required
                  disabled={addLoading}
                />
                <p className="text-xs text-slate-500">Unique identifier (lowercase, no spaces)</p>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-300">Display Name</label>
                <Input
                  value={addDisplayName}
                  onChange={(e) => setAddDisplayName(e.target.value)}
                  placeholder="e.g., Indeed"
                  required
                  disabled={addLoading}
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-300">Base URL</label>
                <Input
                  type="url"
                  value={addBaseUrl}
                  onChange={(e) => setAddBaseUrl(e.target.value)}
                  placeholder="https://example.com"
                  required
                  disabled={addLoading}
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-300">Source Type</label>
                <select
                  value={addSourceType}
                  onChange={(e) => setAddSourceType(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  disabled={addLoading}
                >
                  <option value="job_board">Job Board</option>
                  <option value="direct_employer">Direct Employer (ATS)</option>
                  <option value="government_portal">Government Portal</option>
                  <option value="custom_feed">Custom Feed</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="ghost" onClick={() => setShowAddModal(false)} disabled={addLoading}>
                  Cancel
                </Button>
                <Button type="submit" disabled={addLoading}>
                  {addLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create Source'
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Analyze URL Modal */}
      {showAnalyzeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-night-900 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-2xl border border-white/10">
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-50">URL Analysis</h2>
              <button onClick={() => { setShowAnalyzeModal(false); setAnalyzeResult(null); }} className="text-slate-400 hover:text-slate-100">
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {!analyzeResult ? (
                <form onSubmit={handleAnalyzeUrl} className="space-y-4">
                  {analyzeError && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                      {analyzeError}
                    </div>
                  )}
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-300">URL to Analyze</label>
                    <Input
                      type="url"
                      value={analyzeUrl}
                      onChange={(e) => setAnalyzeUrl(e.target.value)}
                      placeholder="https://example.com/jobs"
                      required
                      disabled={analyzeLoading}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-300">Source Name (optional)</label>
                    <Input
                      value={analyzeSourceName}
                      onChange={(e) => setAnalyzeSourceName(e.target.value)}
                      placeholder="e.g., indeed"
                      disabled={analyzeLoading}
                    />
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <Button type="button" variant="ghost" onClick={() => { setShowAnalyzeModal(false); setAnalyzeUrl(''); }} disabled={analyzeLoading}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={analyzeLoading}>
                      {analyzeLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Analyzing...
                        </>
                      ) : (
                        'Analyze URL'
                      )}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-slate-50">{analyzeResult.title || 'No title'}</h3>
                      <p className="text-sm text-slate-400 truncate max-w-md">{analyzeResult.url}</p>
                    </div>
                    <Badge variant={getFeasibilityLabel(analyzeResult.feasibility).variant}>
                      {getFeasibilityLabel(analyzeResult.feasibility).label}
                    </Badge>
                  </div>
                  {analyzeResult.meta_description && (
                    <p className="text-sm text-slate-300">{analyzeResult.meta_description}</p>
                  )}
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="space-y-1">
                      <p className="text-slate-500">Platform Detected</p>
                      <p className="font-mono text-slate-100">{analyzeResult.platform_detected || 'None'}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-slate-500">Robots.txt</p>
                      <p className="font-mono text-slate-100">{analyzeResult.robots_txt_status || 'Not checked'}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-slate-500">Search Form</p>
                      <p className="font-mono text-slate-100">{analyzeResult.has_search_form ? 'Yes' : 'No'}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-slate-500">Pagination</p>
                      <p className="font-mono text-slate-100">{analyzeResult.has_pagination ? 'Yes' : 'No'}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-slate-500">JSON-LD</p>
                      <p className="font-mono text-slate-100">{analyzeResult.has_json_ld ? 'Yes' : 'No'}</p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <Button variant="ghost" onClick={() => { setShowAnalyzeModal(false); setAnalyzeResult(null); setAnalyzeUrl(''); }}>
                      Close
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetailModal && selectedSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-night-900 rounded-2xl w-full max-w-3xl max-h-[80vh] overflow-y-auto shadow-2xl border border-white/10">
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-50">Source Details</h2>
              <button onClick={() => setShowDetailModal(false)} className="text-slate-400 hover:text-slate-100">
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">ID</p>
                  <p className="font-mono text-sm text-slate-100">{selectedSource.id}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Name</p>
                  <p className="text-sm text-slate-100">{selectedSource.name}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Display Name</p>
                  <p className="text-sm text-slate-100">{selectedSource.display_name}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Domain</p>
                  <p className="text-sm text-slate-100">{selectedSource.domain}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Base URL</p>
                  <p className="text-sm text-slate-300 truncate max-w-xs" title={selectedSource.base_url}>{selectedSource.base_url}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Source Type</p>
                  <p className="text-sm text-slate-100">{selectedSource.source_type}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Status</p>
                  <Badge variant={(STATUS_COLORS[selectedSource.status] || 'default') as 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'}>
                    {STATUS_LABELS[selectedSource.status] || selectedSource.status}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Enabled</p>
                  <Badge variant={selectedSource.enabled ? 'success' : 'default'}>
                    {selectedSource.enabled ? 'Yes' : 'No'}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Adapter</p>
                  <p className="font-mono text-sm text-slate-300">{selectedSource.adapter_name || '—'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Health</p>
                  <Badge variant={selectedSource.health_status === 'healthy' ? 'success' : selectedSource.health_status === 'degraded' ? 'warning' : selectedSource.health_status === 'unhealthy' ? 'danger' : 'default'}>
                    {selectedSource.health_status?.replace('_', ' ') || 'Insufficient evidence'}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Created</p>
                  <p className="text-sm text-slate-300">{formatDate(selectedSource.created_at)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Updated</p>
                  <p className="text-sm text-slate-300">{formatDate(selectedSource.updated_at)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Last Checked</p>
                  <p className="text-sm text-slate-300">{formatDate(selectedSource.last_checked_at)}</p>
                </div>
              </div>

              {selectedSource.analysis_data && (
                <div className="border-t border-white/10 pt-4">
                  <h3 className="font-medium text-slate-50 mb-3">Analysis Results</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="space-y-1">
                      <p className="text-slate-500">Platform Detected</p>
                      <p className="font-mono text-slate-100">{selectedSource.analysis_data.platform_detected || 'None'}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-slate-500">Feasibility</p>
                      <Badge variant={getFeasibilityLabel(selectedSource.analysis_data.feasibility || 'unknown').variant}>
                        {getFeasibilityLabel(selectedSource.analysis_data.feasibility || 'unknown').label}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      <p className="text-slate-500">Search Form</p>
                      <p className="font-mono text-slate-100">{selectedSource.analysis_data.has_search_form ? 'Yes' : 'No'}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-slate-500">Pagination</p>
                      <p className="font-mono text-slate-100">{selectedSource.analysis_data.has_pagination ? 'Yes' : 'No'}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-slate-500">JSON-LD</p>
                      <p className="font-mono text-slate-100">{selectedSource.analysis_data.has_json_ld ? 'Yes' : 'No'}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-slate-500">Robots.txt</p>
                      <p className="font-mono text-slate-100">{selectedSource.analysis_data.robots_txt_status || 'Not checked'}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
                <Button variant="ghost" onClick={() => handleOpenAnalyzeExisting(selectedSource)}>
                  <Search className="h-4 w-4 mr-2" />
                  Re-Analyze
                </Button>
                <Button variant="ghost" onClick={() => handleOpenEdit(selectedSource)}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </Button>
                <Button variant="ghost" onClick={() => setShowDetailModal(false)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-night-900 rounded-2xl w-full max-w-md shadow-2xl border border-white/10 overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-50">Edit Job Source</h2>
              <button onClick={() => { setEditingSource(null); setEditError(null); }} className="text-slate-400 hover:text-slate-100">
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateSource} className="p-6 space-y-4">
              {editError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {editError}
                </div>
              )}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-300">Display Name</label>
                <Input
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  required
                  disabled={editLoading}
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-300">Source Type</label>
                <select
                  value={editSourceType}
                  onChange={(e) => setEditSourceType(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  disabled={editLoading}
                >
                  <option value="job_board">Job Board</option>
                  <option value="direct_employer">Direct Employer (ATS)</option>
                  <option value="government_portal">Government Portal</option>
                  <option value="custom_feed">Custom Feed</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-300">Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  disabled={editLoading}
                >
                  <option value="discovered">Discovered</option>
                  <option value="analyzing">Analyzing</option>
                  <option value="ready_for_review">Ready for Review</option>
                  <option value="approved">Approved</option>
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editEnabled}
                    onChange={(e) => setEditEnabled(e.target.checked)}
                    className="rounded border-white/20 bg-white/5 text-brand-500 focus:ring-brand-500"
                    disabled={editLoading}
                  />
                  <span className="text-sm text-slate-300">Enabled</span>
                </label>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-300">Adapter Name</label>
                <Input
                  value={editAdapterName}
                  onChange={(e) => setEditAdapterName(e.target.value)}
                  placeholder="e.g., indeed-search"
                  disabled={editLoading}
                />
                <p className="text-xs text-slate-500">Maps to skill name (e.g., indeed-search)</p>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="ghost" onClick={() => { setEditingSource(null); setEditError(null); }} disabled={editLoading}>
                  Cancel
                </Button>
                <Button type="submit" disabled={editLoading}>
                  {editLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-night-900 rounded-2xl w-full max-w-md shadow-2xl border border-white/10 overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10">
              <h2 className="text-lg font-semibold text-slate-50">Delete Job Source</h2>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-slate-300">
                Are you sure you want to delete <strong>{deletingSource.display_name}</strong> ({deletingSource.name})?
                This action cannot be undone.
              </p>
              <p className="text-sm text-slate-500">
                Only sources in DISCOVERED, ANALYZING, READY_FOR_REVIEW, or APPROVED states can be deleted.
                ENABLED or DISABLED sources must be disabled first.
              </p>
              <div className="flex justify-end gap-3 pt-4">
                <Button variant="ghost" onClick={() => setDeletingSource(null)} disabled={deleteLoading}>
                  Cancel
                </Button>
                <Button variant="secondary" onClick={handleDeleteSource} disabled={deleteLoading}>
                  {deleteLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    'Delete Source'
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}