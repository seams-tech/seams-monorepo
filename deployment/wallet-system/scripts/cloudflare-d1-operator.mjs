export class CloudflareD1Operator {
  #accountId;
  #apiToken;
  #fetcher;
  #created = new Set();

  constructor({ accountId, apiToken, fetcher }) {
    if (!/^[0-9a-f]{32}$/u.test(accountId) || typeof apiToken !== 'string' || !apiToken) {
      throw new Error('Cloudflare operator credentials are required');
    }
    this.#accountId = accountId;
    this.#apiToken = apiToken;
    this.#fetcher = fetcher;
  }

  async #request(suffix, method, body) {
    const response = await this.#fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${this.#accountId}/d1/database${suffix}`,
      {
        method,
        headers: { authorization: `Bearer ${this.#apiToken}`, 'content-type': 'application/json' },
        body: body === null ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      },
    );
    const envelope = await response.json();
    if (!response.ok || envelope?.success !== true) {
      throw new Error(`Cloudflare D1 request failed with HTTP ${response.status}`);
    }
    return envelope.result;
  }

  async query(databaseId, sql, params) {
    const result = await this.#request(`/${databaseId}/query`, 'POST', { sql, params });
    if (
      !Array.isArray(result) ||
      result.length !== 1 ||
      result[0]?.success !== true ||
      !Array.isArray(result[0].results)
    ) {
      throw new Error('Cloudflare D1 returned an invalid query result');
    }
    return { rows: result[0].results, metadata: result[0].meta };
  }

  async allocateEmptyDatabase(name, locationHint) {
    if (!/^seams-(?:signer|private)-getsignal-[a-z-]+$/u.test(name)) {
      throw new Error('Resource allocation requires a GetSignal-owned database name');
    }
    const existing = await this.#request(
      `?name=${encodeURIComponent(name)}&per_page=100`,
      'GET',
      null,
    );
    if (!Array.isArray(existing)) throw new Error('Cloudflare D1 inventory is invalid');
    const matches = [];
    for (const item of existing) {
      if (item?.name === name) matches.push(item);
    }
    if (matches.length > 1) throw new Error(`Database name is ambiguous: ${name}`);
    let kind;
    let database;
    if (matches.length === 1) {
      kind = 'reused_empty';
      database = parseDatabase(matches[0], name);
    } else {
      kind = 'created';
      database = parseDatabase(
        await this.#request('', 'POST', {
          name,
          primary_location_hint: locationHint,
          read_replication: { mode: 'disabled' },
        }),
        name,
      );
      this.#created.add(database.id);
      console.log(JSON.stringify({ event: 'getsignal_database_created', database }));
    }
    const location = await this.verifyEmptyPrimary(database);
    return { kind, database: { id: database.id, name, location } };
  }

  async verifyEmptyPrimary(database) {
    const result = await this.query(
      database.id,
      "SELECT COUNT(*) AS application_tables FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'",
      [],
    );
    if (result.rows.length !== 1 || result.rows[0]?.application_tables !== 0) {
      throw new Error(`Existing application data requires operator review: ${database.name}`);
    }
    const metadata = result.metadata;
    if (
      metadata?.served_by_primary !== true ||
      typeof metadata.served_by_region !== 'string' ||
      typeof metadata.served_by_colo !== 'string' ||
      !/^[A-Z]{3}$/u.test(metadata.served_by_colo)
    ) {
      throw new Error(`Database primary placement is unverified: ${database.name}`);
    }
    return { region: metadata.served_by_region, colo: metadata.served_by_colo };
  }

  async removeEmptyCreatedDatabase(database) {
    if (!this.#created.has(database.id)) {
      throw new Error('Cleanup is limited to empty databases created by this operator run');
    }
    await this.verifyEmptyPrimary(database);
    await this.#request(`/${database.id}`, 'DELETE', null);
    this.#created.delete(database.id);
  }
}

function parseDatabase(value, name) {
  if (
    value?.name !== name ||
    typeof value.uuid !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value.uuid)
  ) {
    throw new Error(`Cloudflare returned an invalid database identity: ${name}`);
  }
  return { id: value.uuid, name };
}
