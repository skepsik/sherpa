import type { Place } from './types';

/** Мягкий разбор Place с провода: непустая строка без whitespace. */
export function findPlace(value: unknown): null | Place {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (/\s/.test(value)) return null;
  return value;
}
