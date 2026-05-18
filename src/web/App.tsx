import { useState } from 'react';
import { useMe, useSetupStatus } from './api/queries/auth.ts';
import { AppShell, type Route } from './components/layout/AppShell.tsx';
import { ControllersPage } from './routes/ControllersPage.tsx';
import { DashboardPage } from './routes/DashboardPage.tsx';
import { LoginPage } from './routes/LoginPage.tsx';
import { SettingsPage } from './routes/SettingsPage.tsx';
import { SetupPage } from './routes/SetupPage.tsx';

export function App() {
  const setupStatus = useSetupStatus();
  const me = useMe();
  const [route, setRoute] = useState<Route>('dashboard');

  if (setupStatus.isLoading) {
    return <CenteredStatus>Carregando…</CenteredStatus>;
  }

  if (setupStatus.data && !setupStatus.data.complete) {
    return <SetupPage />;
  }

  if (me.isLoading) {
    return <CenteredStatus>Verificando sessão…</CenteredStatus>;
  }

  if (!me.data) {
    return <LoginPage />;
  }

  let content: React.ReactNode;
  if (route === 'controllers') content = <ControllersPage />;
  else if (route === 'settings') content = <SettingsPage />;
  else content = <DashboardPage />;

  return (
    <AppShell current={route} onNavigate={setRoute}>
      {content}
    </AppShell>
  );
}

function CenteredStatus({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
      {children}
    </div>
  );
}
