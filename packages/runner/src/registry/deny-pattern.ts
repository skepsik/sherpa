export class DenyPatternError extends Error {
  constructor(detail: string) {
    super(`deny.pattern: ${detail}`);
    this.name = 'DenyPatternError';
  }
}

/** Разбор опционального префикса эффекта; без префикса = write. */
export function parseDenyPatternEffect(pattern: string): {
  effect: 'read' | 'write';
  gitignore: string;
} {
  if (pattern.startsWith('read:')) {
    return { effect: 'read', gitignore: pattern.slice('read:'.length) };
  }
  if (pattern.startsWith('write:')) {
    return { effect: 'write', gitignore: pattern.slice('write:'.length) };
  }

  // Попытка префикса вида word: — только read/write допустимы
  const attempt = /^([A-Za-z]+):/.exec(pattern);
  if (attempt) {
    throw new DenyPatternError(
      `неизвестный префикс эффекта «${attempt[1]}:»; допустимы read: / write: / без префикса`,
    );
  }

  return { effect: 'write', gitignore: pattern };
}

/**
 * Валидация `deny.pattern` / `deny_global.pattern` (диалект раннера).
 * Fail fast; резолв мусор не «додумывает».
 */
export function validateDenyPattern(pattern: string) {
  const trimmed = pattern.trim();
  if (!trimmed) {
    throw new DenyPatternError('пустой pattern');
  }

  const { gitignore } = parseDenyPatternEffect(trimmed);
  if (!gitignore) {
    throw new DenyPatternError('gitignore-часть пуста после префикса');
  }
  if (gitignore === '!') {
    throw new DenyPatternError('голый ! недопустим');
  }
}
