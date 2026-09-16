import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/** Client with retries disabled so network-less tests fail fast instead of hammering. */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

export interface RenderOptions {
  /** Initial URL, e.g. '/jobs/job123'. Defaults to '/'. */
  route?: string;
  /** Route path the page is rendered at, e.g. '/jobs/:stable_id', so useParams/useNavigate work. */
  path?: string;
  /** Extra react-router children (Routes or Route) appended after the page Route, e.g. navigation targets. */
  extra?: ReactNode;
  /** Flag the rerender wrapper with a custom depth bookkeeping flag (unused, kept for clarity). */
  key?: string;
}

/** Wrapper carrying Router + QueryClient providers so both the page and any rerender stay inside context. */
function createWrapper(options: RenderOptions, queryClient: QueryClient) {
  const route = options.route ?? '/';
  const path = options.path ?? options.route ?? '*';
  const RouterContext = createContext(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void RouterContext;

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={path} element={children} />
            {options.extra}
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

/** Render a page inside QueryClientProvider + MemoryRouter + Routes. */
export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}) {
  const queryClient = createTestQueryClient();
  const Wrapper = createWrapper(options, queryClient);

  const result = render(<Wrapper>{ui}</Wrapper>);
  return {
    ...result,
    rerender: (next: ReactElement) => result.rerender(<Wrapper>{next}</Wrapper>),
  };
}