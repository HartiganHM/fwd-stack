import type { Stats } from 'node:fs';
import { statSync } from 'node:fs';

export const sizeOf = (path: string): number => {
  const stats: Stats = statSync(path);
  return stats.size;
};
