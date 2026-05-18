import { useLogout } from '../../api/queries/auth.ts';
import { Button } from '../ui/Button.tsx';

export type Route = 'dashboard' | 'controllers' | 'reports' | 'settings';

export interface AppShellProps {
  current: Route;
  onNavigate: (route: Route) => void;
  children: React.ReactNode;
}

const TABS: Array<{ key: Route; label: string }> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'controllers', label: 'Controllers' },
  { key: 'reports', label: 'Relatórios' },
  { key: 'settings', label: 'Configurações' },
];

export function AppShell({ current, onNavigate, children }: AppShellProps) {
  const logout = useLogout();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6">
            <h1 className="text-base font-bold tracking-tight">metricas-unifi</h1>
            <nav className="flex items-center gap-1">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => onNavigate(tab.key)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    current === tab.key
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
          <Button variant="ghost" onClick={() => logout.mutate()} loading={logout.isPending}>
            Sair
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
