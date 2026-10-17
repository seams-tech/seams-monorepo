export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const [, operation, binding, method] = url.pathname.split('/');
    if (operation === 'worker') {
      const target = request.headers.get('x-test-target-url');
      return env[binding].fetch(new Request(target, request));
    }
    const input = await request.json();
    switch (operation) {
      case 'database': {
        const database = env[binding];
        if (method === 'exec') return Response.json(await database.exec(input.sql));
        if (method === 'batch') {
          const statements = [];
          for (const statement of input.statements) {
            statements.push(database.prepare(statement.sql).bind(...statement.values));
          }
          return Response.json(await database.batch(statements));
        }
        const statement = database.prepare(input.sql).bind(...input.values);
        return Response.json(await statement[method](...input.args));
      }
      case 'bucket':
        return Response.json(await env[binding].list());
      case 'namespace': {
        const namespace = env[binding];
        if (method === 'name') return Response.json(namespace.idFromName(input.name).toString());
        if (method === 'validate') {
          const ids = [];
          for (const id of input.ids) {
            try {
              ids.push(namespace.idFromString(id).toString());
            } catch {
              // A resident from another script does not belong to this namespace.
            }
          }
          return Response.json(ids);
        }
        const object = namespace.get(namespace.idFromString(input.id));
        return object.fetch(
          new Request(input.url, {
            method: input.method,
            headers: input.headers,
            body: input.body,
          }),
        );
      }
      default:
        return new Response('Unknown test operation', { status: 404 });
    }
  },
};
