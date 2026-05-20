import { useControllers } from '../api/queries/controllers.ts';
import { useSites } from '../api/queries/sites.ts';

export interface FilterValue {
  controllerId?: string;
  siteId?: string;
}

export function FilterBar({
  value,
  onChange,
  rightSlot,
}: {
  value: FilterValue;
  onChange: (next: FilterValue) => void;
  rightSlot?: React.ReactNode;
}) {
  const controllers = useControllers();
  const sites = useSites(value.controllerId ? { controllerId: value.controllerId } : undefined);
  const baseSelect =
    'rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900';
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select
        className={baseSelect}
        value={value.controllerId ?? ''}
        onChange={(e) => onChange({ controllerId: e.target.value || undefined, siteId: undefined })}
      >
        <option value="">Todos os controllers</option>
        {(controllers.data ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select
        className={baseSelect}
        value={value.siteId ?? ''}
        onChange={(e) => onChange({ ...value, siteId: e.target.value || undefined })}
        disabled={!value.controllerId}
      >
        <option value="">Todos os sites</option>
        {(sites.data ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.displayName}
          </option>
        ))}
      </select>
      {rightSlot}
    </div>
  );
}
