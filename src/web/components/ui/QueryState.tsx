import type { ReactNode } from 'react';

interface QueryStateProps {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  isEmpty?: boolean;
  loadingText?: string;
  emptyText?: string;
  children: ReactNode;
}

/**
 * Renderiza um dos quatro estados de uma query (loading, error, empty,
 * success) com mensagens consistentes em toda a UI. Use em volta de listas,
 * tabelas e gráficos para garantir que o usuário sempre veja feedback —
 * nunca "Carregando…" preso enquanto a API está caída.
 */
export function QueryState({
  isLoading,
  isError,
  error,
  isEmpty,
  loadingText = 'Carregando…',
  emptyText = 'Sem dados.',
  children,
}: QueryStateProps) {
  if (isLoading) {
    return <p className="text-sm text-slate-500">{loadingText}</p>;
  }
  if (isError) {
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    return (
      <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        <p className="font-medium">Falha ao carregar.</p>
        <p className="mt-1 text-xs opacity-80">{msg}</p>
      </div>
    );
  }
  if (isEmpty) {
    return <p className="text-sm text-slate-500">{emptyText}</p>;
  }
  return <>{children}</>;
}
