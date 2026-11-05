import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AgentRow } from '@/types';

export function hashOwnerToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A fresh secret for the browser that created an agent; only the hash is stored. */
export function mintOwnerToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashOwnerToken(token) };
}

/** True when the `Authorization: Bearer <token>` header matches the agent's stored hash. */
export function isOwner(
  agent: Pick<AgentRow, 'ownerTokenHash' | 'pinned'>,
  authorization: string | null,
): boolean {
  if (agent.pinned || !agent.ownerTokenHash || !authorization) return false;
  const match = /^Bearer (\S+)$/.exec(authorization);
  if (!match?.[1]) return false;
  const given = Buffer.from(hashOwnerToken(match[1]), 'hex');
  const stored = Buffer.from(agent.ownerTokenHash, 'hex');
  return given.length === stored.length && timingSafeEqual(given, stored);
}
