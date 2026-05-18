import { useState } from 'react';
import { useSetup } from '../api/queries/auth.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Input } from '../components/ui/Input.tsx';

export function SetupPage() {
  const setup = useSetup();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (password.length < 8) {
      setLocalError('A senha precisa ter ao menos 8 caracteres.');
      return;
    }
    if (password !== confirm) {
      setLocalError('As senhas não coincidem.');
      return;
    }
    setup.mutate(password);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Bem-vindo</h1>
          <p className="mt-1 text-sm text-slate-500">
            Defina uma senha de administrador para começar.
          </p>
        </div>
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <Input
              label="Senha"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
              hint="Mínimo 8 caracteres. Use algo forte — esse é o único acesso."
              required
            />
            <Input
              label="Confirme a senha"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
              error={localError ?? undefined}
            />
            {setup.error && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {(setup.error as Error).message}
              </p>
            )}
            <Button type="submit" loading={setup.isPending} className="w-full">
              Concluir setup
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
