import axios, { type AxiosInstance, type AxiosError, type InternalAxiosRequestConfig } from 'axios';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: '',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor for auth token and logging
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        // Add Authorization header from localStorage if available
        const token = localStorage.getItem('careerpilot_token');
        if (token && config.headers) {
          config.headers.Authorization = `Bearer ${token}`;
        }

        if (import.meta.env.DEV) {
          console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
        }
        return config;
      },
      (error: AxiosError) => Promise.reject(error)
    );

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (import.meta.env.DEV) {
          console.error('[API Error]', error.response?.status, error.config?.url, error.message);
        }
        // Handle 401 Unauthorized - clear token and notify auth state
        if (error.response?.status === 401) {
          localStorage.removeItem('careerpilot_token');
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('careerpilot:unauthorized'));
          }
        }
        return Promise.reject(error);
      }
    );
  }

  get instance(): AxiosInstance {
    return this.client;
  }

  // Health check (requires auth)
  async healthCheck() {
    const response = await this.client.get('/api/health');
    return response.data;
  }

  // Public health check (no auth) - uses /api/public
  async publicHealthCheck() {
    const response = await this.client.get('/api/public/status');
    return response.data;
  }

  // Public Jobs (no auth) - uses /api/public
  async getPublicJobs(params?: {
    sort?: 'rank_score' | 'evaluated_at' | 'created_at';
    order?: 'asc' | 'desc';
    limit?: number;
  }) {
    const response = await this.client.get('/api/public/jobs/active', { params });
    return response.data;
  }

  async getPublicJob(stable_id: string) {
    const response = await this.client.get(`/api/public/jobs/${stable_id}`);
    return response.data;
  }

  async getPublicApplications() {
    const response = await this.client.get('/api/public/applications');
    return response.data;
  }

  // Private Jobs (requires auth) - uses /api/jobs
  async getJobs(params?: {
    state?: string;
    arrangement?: string;
    fit?: string;
    active_only?: boolean;
    page?: number;
    page_size?: number;
  }) {
    const response = await this.client.get('/api/jobs', { params });
    return response.data;
  }

  async getJob(stable_id: string) {
    const response = await this.client.get(`/api/jobs/${stable_id}`);
    return response.data;
  }

  // Ranked jobs
  async getTop5() {
    const response = await this.client.get('/api/ranked/top5');
    return response.data;
  }

  async getTop10() {
    const response = await this.client.get('/api/ranked/top10');
    return response.data;
  }

  async getAllRanked() {
    const response = await this.client.get('/api/ranked/all');
    return response.data;
  }

  // Applications
  async getApplications() {
    const response = await this.client.get('/api/applications');
    return response.data;
  }

  async getApplication(appId: string) {
    const response = await this.client.get(`/api/applications/${appId}`);
    return response.data;
  }

  async createApplication(payload: any) {
    const response = await this.client.post('/api/applications', payload);
    return response.data;
  }

  async createApplicationWithDocuments(
    payload: any,
    options: { generateCv?: boolean; generateCoverLetter?: boolean } = {}
  ) {
    const params: Record<string, string> = {};
    if (options.generateCv !== undefined) params.generate_cv = String(options.generateCv);
    if (options.generateCoverLetter !== undefined) params.generate_cover_letter = String(options.generateCoverLetter);
    const response = await this.client.post('/api/applications/with-documents', payload, { params });
    return response.data;
  }

  async updateApplication(appId: string, payload: any) {
    const response = await this.client.patch(`/api/applications/${appId}`, payload);
    return response.data;
  }

  async deleteApplication(appId: string) {
    await this.client.delete(`/api/applications/${appId}`);
  }

  async downloadApplicationDocument(appId: string, docKind: 'cv' | 'cover_letter') {
    const response = await this.client.get(`/api/applications/${appId}/documents/${docKind}`, {
      responseType: 'blob',
    });
    return response;
  }

  // Pipeline (requires auth)
  async getPipelineStatus() {
    const response = await this.client.get('/api/pipeline/status');
    return response.data;
  }

  async getPipelineHealth() {
    const response = await this.client.get('/api/pipeline/health');
    return response.data;
  }

  // Retention (requires auth)
  async getRetentionStats() {
    const response = await this.client.get('/api/pipeline/retention');
    return response.data;
  }

  // Public Pipeline (no auth) - uses /api/public
  async getPublicPipelineStatus() {
    const response = await this.client.get('/api/public/pipeline');
    return response.data;
  }

  async getPublicRetentionStats() {
    const response = await this.client.get('/api/public/retention');
    return response.data;
  }

  async getPublicPortalHealth() {
    const response = await this.client.get('/api/public/health/portals');
    return response.data;
  }

  // Demo mode (requires auth for bootstrap/reset)
  async getDemoStatus() {
    const response = await this.client.get('/api/demo/status');
    return response.data;
  }

  async getDemoActiveJobs() {
    const response = await this.client.get('/api/demo/jobs/active');
    return response.data;
  }

  async getDemoJob(stable_id: string) {
    const response = await this.client.get(`/api/demo/jobs/${stable_id}`);
    return response.data;
  }

  async getDemoPipelineStatus() {
    const response = await this.client.get('/api/demo/pipeline');
    return response.data;
  }

  async demoBootstrap() {
    const response = await this.client.post('/api/demo/bootstrap');
    return response.data;
  }

  async demoReset() {
    const response = await this.client.post('/api/demo/reset');
    return response.data;
  }

  async getDemoRetentionStats() {
    const response = await this.client.get('/api/demo/retention');
    return response.data;
  }

  // Auth
  async login(email: string, password: string) {
    const response = await this.client.post('/api/auth/login', { email, password });
    return response.data;
  }

  async register(email: string, password: string) {
    const response = await this.client.post('/api/auth/register', { email, password });
    return response.data;
  }

  async logout() {
    const response = await this.client.post('/api/auth/logout');
    return response.data;
  }

  async getCurrentUser() {
    const response = await this.client.get('/api/auth/me');
    return response.data;
  }

  // Authenticated dashboard
  async getDashboard() {
    const response = await this.client.get('/api/dashboard');
    return response.data;
  }

  // Resume (authenticated)
  async getResumeMetadata() {
    const response = await this.client.get('/api/resume');
    return response.data;
  }

  async uploadResume(file: File) {
    const form = new FormData();
    form.append('file', file);
    // Let the browser set the multipart boundary; the instance default of
    // application/json would otherwise break file parsing on the server.
    const response = await this.client.post('/api/resume', form, {
      headers: { 'Content-Type': undefined },
    });
    return response.data;
  }

  async downloadResume() {
    const response = await this.client.get('/api/resume/download', {
      responseType: 'blob',
    });
    return response;
  }

  // Profile (Checkpoint 5)
  async getProfile() {
    const response = await this.client.get('/api/profile');
    return response.data;
  }

  async updateProfile(payload: any) {
    const response = await this.client.put('/api/profile', payload);
    return response.data;
  }

  async extractProfile() {
    const response = await this.client.post('/api/profile/extract');
    return response.data;
  }

  // Search Preferences (Checkpoint 6)
  async getPreferences() {
    const response = await this.client.get('/api/preferences');
    return response.data;
  }

  async updatePreferences(payload: any) {
    const response = await this.client.put('/api/preferences', payload);
    return response.data;
  }

  // Saved Jobs (Checkpoint 11)
  async getSavedJobs() {
    const response = await this.client.get('/api/saved-jobs');
    return response.data;
  }

  async saveJob(stable_id: string) {
    const response = await this.client.post(`/api/saved-jobs/${stable_id}`);
    return response.data;
  }

  async unsaveJob(stable_id: string) {
    const response = await this.client.delete(`/api/saved-jobs/${stable_id}`);
    return response.data;
  }

  // Search (Checkpoint 7)
  async startSearch(payload: any) {
    const response = await this.client.post('/api/search', payload);
    return response.data;
  }

  async getSearchRun(runId: string) {
    const response = await this.client.get(`/api/search/${runId}`);
    return response.data;
  }

  async listSearchRuns(params?: { limit?: number; offset?: number }) {
    const response = await this.client.get('/api/search', { params });
    return response.data;
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
export default apiClient;