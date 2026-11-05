import { it, expect } from 'vitest';
import { cn } from '@/lib/utils';

it('resolves the @ alias', () => {
  expect(cn('a', 'b')).toBe('a b');
});
