import { Injectable, Logger } from '@nestjs/common';
import type { CacheEntry } from '../interfaces/cache-entry.interface';
import type { ICacheStore } from '../interfaces/cache-store.interface';

interface LruNode<T> {
  key: string;
  entry: CacheEntry<T>;
  prev: LruNode<T> | null;
  next: LruNode<T> | null;
}

@Injectable()
export class MemoryCacheStore implements ICacheStore {
  private readonly logger = new Logger(MemoryCacheStore.name);
  private readonly maxItems: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly map = new Map<string, LruNode<any>>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private head: LruNode<any> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private tail: LruNode<any> | null = null;

  hits = 0;
  misses = 0;
  evictions = 0;

  constructor(maxItems = 10_000) {
    this.maxItems = maxItems;
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const node = this.map.get(key) as LruNode<T> | undefined;
    if (!node) { this.misses++; return null; }
    if (node.entry.expiresAt <= Date.now()) {
      this.evict(node);
      this.misses++;
      return null;
    }
    this.moveToHead(node);
    this.hits++;
    return node.entry;
  }

  async set<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    const existing = this.map.get(key);
    if (existing) {
      existing.entry = entry as CacheEntry<unknown>;
      this.moveToHead(existing);
      return;
    }
    const node: LruNode<T> = { key, entry, prev: null, next: null };
    this.map.set(key, node as LruNode<unknown>);
    this.addToHead(node);
    if (this.map.size > this.maxItems) this.evictTail();
  }

  async delete(key: string): Promise<void> {
    const node = this.map.get(key);
    if (node) this.evict(node);
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    let count = 0;
    for (const [key, node] of this.map) {
      if (key.startsWith(prefix)) { this.evict(node); count++; }
    }
    return count;
  }

  async has(key: string): Promise<boolean> {
    const node = this.map.get(key);
    if (!node) return false;
    if (node.entry.expiresAt <= Date.now()) { this.evict(node); return false; }
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private evict(node: LruNode<any>): void {
    this.map.delete(node.key);
    this.removeNode(node);
    this.evictions++;
  }

  private evictTail(): void {
    if (this.tail) this.evict(this.tail);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private addToHead(node: LruNode<any>): void {
    node.next = this.head;
    node.prev = null;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private moveToHead(node: LruNode<any>): void {
    this.removeNode(node);
    this.addToHead(node);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private removeNode(node: LruNode<any>): void {
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (this.head === node) this.head = node.next;
    if (this.tail === node) this.tail = node.prev;
    node.prev = null;
    node.next = null;
  }
}
