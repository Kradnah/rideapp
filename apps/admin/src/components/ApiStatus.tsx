import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function ApiStatus() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: () => api.health.ready(),
    refetchInterval: 15_000,
    retry: false,
  });

  const state = isPending ? 'pending' : isError || data?.status !== 'ok' ? 'down' : 'up';
  const label = { pending: 'Comprobando API…', up: 'API operativa', down: 'API sin respuesta' }[
    state
  ];

  return (
    <span className={`status status--${state}`} role="status">
      <span className="status__dot" aria-hidden="true" />
      {label}
    </span>
  );
}
