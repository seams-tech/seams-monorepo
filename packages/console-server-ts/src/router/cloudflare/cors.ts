import { normalizeCorsOrigin } from '../../boundary/normalization';

export function resolveConsoleCorsOrigins(
  inputs: readonly (string | undefined)[],
): readonly string[] | '*' {
  const origins: string[] = [];
  for (const input of inputs) {
    for (const part of (input ?? '').split(',')) {
      if (part.trim() === '*') return '*';
      const origin = normalizeCorsOrigin(part.trim());
      if (origin) origins.push(origin);
    }
  }
  return origins;
}

export function withConsoleCors(
  headers: Headers,
  origins: readonly (string | undefined)[],
  request: Request,
): void {
  const allowedOrigins = resolveConsoleCorsOrigins(origins);
  const requestOrigin = request.headers.get('Origin');
  const normalizedOrigin = normalizeCorsOrigin(requestOrigin ?? undefined);
  if (allowedOrigins === '*') {
    headers.set('Access-Control-Allow-Origin', '*');
  } else if (requestOrigin && normalizedOrigin && allowedOrigins.includes(normalizedOrigin)) {
    headers.set('Access-Control-Allow-Origin', requestOrigin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.append('Vary', 'Origin');
  }
  headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type,Authorization,X-Console-Org-Id,X-Console-User-Id,X-Console-Roles,X-Console-Project-Id,X-Console-Environment-Id',
  );
}
