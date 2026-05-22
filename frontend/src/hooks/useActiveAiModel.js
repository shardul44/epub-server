import { useQuery } from '@tanstack/react-query';
import { aiConfigService } from '../services/aiConfigService';

/** Platform-configured Gemini model (read-only; no API key). */
export function useActiveAiModel() {
  const { data } = useQuery({
    queryKey: ['ai-config', 'active-model'],
    queryFn: () => aiConfigService.getActiveModel(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return data?.modelName ?? null;
}
