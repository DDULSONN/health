export { default, useSearchParams, usePathname } from './recommendation-refresh-adapters';
import { createClient as baseClient } from './recommendation-refresh-adapters';
export const useParams = () => ({ id: 'fixture-paid' });
const router = { push: (url: string) => location.assign(url), replace: (url: string) => location.replace(url) };
export const useRouter = () => router;
const user = { id: 'fixture-member' };
const client = { auth: {
  ...baseClient().auth,
  getUser: async () => ({ data: { user } }),
  getSession: async () => ({ data: { session: { user, access_token: 'synthetic-local-token' } } }),
} };
export const createClient = () => client;
