import { useState } from 'react';
import { useLogin } from '../api/queries/auth.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Input } from '../components/ui/Input.tsx';

export function LoginPage() {
  const login = useLogin();
  const [password, setPassword] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate(password);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight">metricas-unifi</h1>
          <p className="mt-1 text-sm text-slate-500">Entrar como administrador</p>
        </div>
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <Input
              label="Senha"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
            {login.error && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {(login.error as Error).message === 'invalid_credentials'
                  ? 'Senha incorreta.'
                  : (login.error as Error).message}
              </p>
            )}
            <Button type="submit" loading={login.isPending} className="w-full">
              Entrar
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
