import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { getApiErrorMessage } from '../utils/errors';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Login failed. Please check your credentials.'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 sm:px-6 lg:px-8 py-12">
      <div className="w-full max-w-md">
        <div className="glass-card rounded-3xl p-8 sm:p-10">
          <div className="space-y-2 mb-8">
            <Link to="/" className="flex items-center gap-2.5 justify-center" aria-label="CareerPilot Home">
              <svg className="w-9 h-9 text-brand-400" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="text-2xl font-bold text-slate-50">CareerPilot</span>
            </Link>
            <h2 className="text-center text-2xl font-bold text-slate-50">Sign in to your account</h2>
            <p className="text-center text-sm text-slate-400">
              Or{' '}
              <Link to="/register" className="font-medium text-brand-300 hover:text-brand-200 transition-colors">
                create a new account
              </Link>
            </p>
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div
                className="rounded-xl border border-red-500/[0.3] bg-red-500/[0.08] px-4 py-3 text-sm text-red-300"
                role="alert"
              >
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label htmlFor="email" className="sr-only">
                  Email address
                </label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  disabled={isLoading}
                />
              </div>

              <div>
                <label htmlFor="password" className="sr-only">
                  Password
                </label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  disabled={isLoading}
                />
              </div>
            </div>

            <Button type="submit" disabled={isLoading} className="w-full py-3">
              {isLoading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-500 mt-5">
          Demo mode is available from the header navigation.
        </p>
      </div>
    </div>
  );
}