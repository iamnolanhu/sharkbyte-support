import { describe, it, expect } from 'vitest';
import {
  STORAGE_PREFIX,
  listStoredAgents,
  ownerHeaders,
  readStoredAgent,
  removeStoredAgent,
  saveStoredAgent,
} from '@/lib/stored-agents';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const base = { name: 'Sammy - acme.com', url: 'https://acme.com', createdAt: '2026-11-01T00:00:00.000Z' };

describe('stored agents', () => {
  it('saveStoredAgent keeps an existing ownerToken', () => {
    const storage = new MemoryStorage();
    saveStoredAgent(storage, { ...base, id: 'a1', ownerToken: 't' });
    saveStoredAgent(storage, { ...base, id: 'a1' });
    expect(readStoredAgent(storage, 'a1')?.ownerToken).toBe('t');
  });

  it('saveStoredAgent replaces the ownerToken when a new one arrives', () => {
    const storage = new MemoryStorage();
    saveStoredAgent(storage, { ...base, id: 'a1', ownerToken: 't' });
    saveStoredAgent(storage, { ...base, id: 'a1', ownerToken: 'u' });
    expect(readStoredAgent(storage, 'a1')?.ownerToken).toBe('u');
  });

  it('readStoredAgent reads a DO-era record without an owner token', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      `${STORAGE_PREFIX}old`,
      JSON.stringify({
        id: 'old',
        name: 'Sammy - old.com',
        kbId: 'kb',
        url: 'https://old.com',
        endpoint: 'https://x.example',
        accessKey: 'do-key',
        createdAt: base.createdAt,
      })
    );
    const agent = readStoredAgent(storage, 'old');
    expect(agent).toEqual({ id: 'old', name: 'Sammy - old.com', url: 'https://old.com', createdAt: base.createdAt });
    expect(agent?.ownerToken).toBeUndefined();
    expect(ownerHeaders(storage, 'old')).toEqual({});
  });

  it('readStoredAgent returns null on bad JSON and on missing records', () => {
    const storage = new MemoryStorage();
    storage.setItem(`${STORAGE_PREFIX}bad`, '{nope');
    expect(readStoredAgent(storage, 'bad')).toBeNull();
    expect(readStoredAgent(storage, 'missing')).toBeNull();
  });

  it('listStoredAgents sorts newest first and skips other keys', () => {
    const storage = new MemoryStorage();
    saveStoredAgent(storage, { ...base, id: 'older', createdAt: '2026-11-01T00:00:00.000Z' });
    saveStoredAgent(storage, { ...base, id: 'newer', createdAt: '2026-11-03T00:00:00.000Z' });
    storage.setItem('theme', 'dark');
    storage.setItem(`${STORAGE_PREFIX}bad`, 'not json');
    expect(listStoredAgents(storage).map((a) => a.id)).toEqual(['newer', 'older']);
  });

  it('removeStoredAgent forgets the record', () => {
    const storage = new MemoryStorage();
    saveStoredAgent(storage, { ...base, id: 'a1', ownerToken: 't' });
    removeStoredAgent(storage, 'a1');
    expect(readStoredAgent(storage, 'a1')).toBeNull();
  });

  it('ownerHeaders is empty without a token and a bearer header with one', () => {
    const storage = new MemoryStorage();
    saveStoredAgent(storage, { ...base, id: 'a1' });
    expect(ownerHeaders(storage, 'a1')).toEqual({});
    saveStoredAgent(storage, { ...base, id: 'a1', ownerToken: 'tok' });
    expect(ownerHeaders(storage, 'a1')).toEqual({ Authorization: 'Bearer tok' });
  });
});
