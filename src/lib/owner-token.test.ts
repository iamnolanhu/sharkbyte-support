import { describe, it, expect } from 'vitest';
import { hashOwnerToken, isOwner, mintOwnerToken } from '@/lib/owner-token';

describe('owner token', () => {
  it('mints distinct tokens whose hash matches hashOwnerToken', () => {
    const a = mintOwnerToken();
    const b = mintOwnerToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOwnerToken(a.token)).toBe(a.hash);
  });

  it('isOwner accepts the minted token only', () => {
    const { token, hash } = mintOwnerToken();
    const agent = { ownerTokenHash: hash, pinned: false };
    expect(isOwner(agent, `Bearer ${token}`)).toBe(true);
    expect(isOwner(agent, `Bearer ${token}x`)).toBe(false);
    expect(isOwner(agent, 'Bearer wrong')).toBe(false);
    expect(isOwner(agent, 'Bearer ')).toBe(false);
    expect(isOwner(agent, token)).toBe(false);
    expect(isOwner(agent, null)).toBe(false);
  });

  it('pinned agents and agents without a hash have no owner', () => {
    const { token, hash } = mintOwnerToken();
    expect(isOwner({ ownerTokenHash: hash, pinned: true }, `Bearer ${token}`)).toBe(false);
    expect(isOwner({ ownerTokenHash: null, pinned: false }, `Bearer ${token}`)).toBe(false);
  });
});
