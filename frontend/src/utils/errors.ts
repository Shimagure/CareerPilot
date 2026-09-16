import type { AxiosError } from 'axios';

/** Extract a useful message from an API error, falling back gracefully. */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const data = (err as AxiosError<{ detail?: unknown }>).response?.data;
    if (data && typeof data.detail === 'string' && data.detail.length > 0) {
      return data.detail;
    }
  }
  if (err instanceof Error && err.message) {
    // axios flattens HTTP failures into "Request failed with status code N"
    if (err.message.startsWith('Request failed with status code')) {
      return fallback;
    }
    return err.message;
  }
  return fallback;
}