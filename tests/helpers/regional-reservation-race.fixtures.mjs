import { setTimeout } from 'node:timers/promises';

export class PausedReservationDatabase {
  entered = Promise.withResolvers();
  released = Promise.withResolvers();
  insertedRows = 0;

  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    const statement = this.database.prepare(sql);
    if (/INSERT OR IGNORE INTO linked_device_target_commit_reservations/u.test(sql)) {
      return new PausedReservationStatement(this, statement);
    }
    return statement;
  }

  batch(statements) {
    return this.database.batch(statements);
  }

  async start(provider, input) {
    this.result = provider.registerTargetCredentialV1(input);
    const controller = new AbortController();
    try {
      await Promise.race([
        this.entered.promise,
        this.result.then(failEarlyRegistration),
        setTimeout(15_000, null, { signal: controller.signal }).then(failReservationTimeout),
      ]);
    } finally {
      controller.abort();
    }
  }

  async finish() {
    this.released.resolve();
    return this.result;
  }
}

class PausedReservationStatement {
  constructor(race, statement) {
    this.race = race;
    this.statement = statement;
  }

  bind(...values) {
    return new PausedReservationStatement(this.race, this.statement.bind(...values));
  }

  async run() {
    this.race.entered.resolve();
    await this.race.released.promise;
    const result = await this.statement.run();
    this.race.insertedRows += result.meta.changes;
    return result;
  }
}

function failReservationTimeout() {
  throw new Error('Credential registration must reach the reservation write barrier');
}

function failEarlyRegistration(result) {
  throw new Error(`Registration ended before reservation barrier: ${JSON.stringify(result)}`);
}
