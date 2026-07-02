/**
 * This module contains the transaction manager used by janode.
 * It is possible to debug the size of the transaction table (to detect leaks) by using the CLI argument `--debug-tx`.
 * @module tmanager
 * @private
 */

// Ben TODO: It seems like some owners have a numeric string, and others just have a number.
// Might just be an issue with the library?
export type TransactionOwner = { id: string | number }
export type Response = any


/**
 * An object describing a pending transaction stored in the manager.
 *
 * @property id - The transaction identifier
 * @property owner - A reference to the object that created the transaction
 * @property request - The janus request for the pending transaction
 * @property done - The success callback
 * @property error - The error callback
 */
export type PendingTransaction = {
  id: string,
  owner: TransactionOwner,
  request: string,
  done: (value: Response) => void,
  error: (reason?: any) => void
  timeout?: NodeJS.Timeout
}

import type { JanodeResponse } from './handle.ts'
import Logger from './utils/logger.ts';
const LOG_NS = '[tmanager.ts]';
import { getNumericID, getCliArgument } from './utils/utils.ts';

const debug = getCliArgument<boolean>('debug-tx', 'boolean', false);

/**
 * Class representing a Janode Transaction Manager (TM).
 * A transaction manager stores the pending transactions and has methods to create and close transactions.
 * Every transaction objects has an identifier, a reference to the owner and a kind of janus request.
 *
 * @private
 */
class TransactionManager {
  transactions: Map<string, PendingTransaction>;
  id: string;
  private _dbgtask: NodeJS.Timeout | undefined;
  /**
   * Create a Transacton Manager (TM)
   *
   * @param [id] - The identifier given to the manager (got from a counter if missing)
   */
  constructor(id: string = getNumericID()) {
    this.transactions = new Map();
    this.id = id;
    Logger.info(`${LOG_NS} [${this.id}] creating new transaction manager (debug=${debug})`);
    this._dbgtask = undefined;
    /* If tx debugging is enabled, periodically print the size of the tx table */
  }

  /**
   * Clear the internal transaction table and the debugging printing task.
   */
  clear(): void {
    Logger.info(`${LOG_NS} [${this.id}] clearing transaction manager`);
    clearInterval(this._dbgtask);
    this.transactions.clear();
  }

  /**
   * Check if the TM has a specific transaction.
   *
   * @param id - The transaction id
   * @returns True if the manager contains the transaction
   */
  has(id: string): boolean {
    if (!id) return false;
    return this.transactions.has(id);
  }

  /**
   * Get a specific transaction from the TM.
   *
   * @param id - The transaction id
   * @returns The wanted transaction, or nothing if missing
   */
  get(id: string): PendingTransaction | undefined {
    if (!id) return undefined;
    if (!this.has(id)) return undefined;
    return this.transactions.get(id);
  }

  /**
   * Get the current size of the transaction table.
   *
   * The size of the table
   */
  size(): number {
    return this.transactions.size;
  }

  /**
   * Add a pending transaction to the TM.
   *
   * @param id - The transaction id
   * @param transaction
   */
  set(id: string, transaction: PendingTransaction): void {
    if (!id) return;
    if (!transaction) return;
    this.transactions.set(id, transaction);
    if (debug && !this._dbgtask) {
      this._dbgtask = setInterval(() => {
        Logger.info(`${LOG_NS} [${this.id}] TM DEBUG size=${this.size()}`);
      }, 5000);
    }
  }

  /**
   * Delete a specific transaction from the TM.
   *
   * @param id - The transaction id to delete
   */
  delete(id: string): void {
    if (!id) return;
    if (!this.has(id)) return;
    this.transactions.delete(id);
  }

  /**
   * Get the owner of a specific transaction id.
   *
   * @param id - The transaction id
   * @returns A reference to the owner object, or nothing if transaction is missing
   */
  getTransactionOwner(id: string): TransactionOwner | null {
    if (!id) return null;
    if (!this.has(id)) return null;
    return this.get(id)!.owner;
  }

  /**
   * Create a new transaction if id does not exist in the table and add it to the TM.
   *
   * @param id - The transaction identifier
   * @param owner - A reference to the object that created the transaction
   * @param request - The janus request for the pending transaction
   * @param done - The success callback
   * @param error - The error callback
   * @param [timeout_ms=0] - The timeout of the transaction
   * @returns The newly created transaction, or nothing if the id already exists
   */
  createTransaction(id: string, owner: TransactionOwner, request: string, done: (value: Response) => void, error: (reason?: any) => void, timeout_ms: number = 0): PendingTransaction | void {
    if (this.has(id)) return;
    const tx: PendingTransaction = {
      id,
      owner,
      request,
      done,
      error,
    };
    if (timeout_ms > 0) {
      const timeout = setTimeout(() => {
        this.delete(id);
        error(new Error('Transaction timed out!'));
        Logger.error(`${LOG_NS} [${owner.id}] closed with timeout transaction ${id}, request "${request}"`);
      }, timeout_ms);
      tx.timeout = timeout;
    }

    this.set(id, tx);
    Logger.verbose(`${LOG_NS} [${tx.owner.id}] created new transaction ${id}, request "${tx.request}"`);
    return tx;
  }

  /**
   * Close a transaction with an error if the id is found and the owner matches.
   * The closed transaction will be removed from the internal table and the error cb will be invoked with the error string.
   *
   * @param id - The transaction identifier
   * @param owner - A reference to the transaction owner
   * @param error - The error object
   * @returns The closed transaction, or nothing if the id does not exist or the owner does not match
   */
  closeTransactionWithError(id: string, owner: TransactionOwner, error: Error): PendingTransaction | void {
    const tx = this.get(id);
    if (!tx) return;
    if (tx.owner !== owner) return;
    clearTimeout(tx.timeout);
    this.delete(id);
    tx.error(error);
    Logger.verbose(`${LOG_NS} [${tx.owner.id}] closed with error transaction ${id}, request "${tx.request}"`);
    return tx;
  }

  /**
   * Close all the stored transactions with an error.
   * If an owner is specified only the owner's transaction will be closed.
   * The closed transactions will be removed from the internal table.
   *
   * @param [owner] - A reference to the transaction owner
   * @param error - The error object
   */
  closeAllTransactionsWithError(owner: TransactionOwner | undefined, error: Error) {
    for (const [_, pendingTx] of this.transactions) {
      if (!owner || pendingTx.owner === owner)
        this.closeTransactionWithError(pendingTx.id, pendingTx.owner, error);
    }
  }

  /**
   * Close a transaction with success if the id is found and the owner matches.
   * The closed transaction will be removed from the internal table and the success cb will be invoked with the specified data.
   *
   * @param id - The transaction identifier
   * @param owner - A reference to the transaction owner
   * @param data - The success callback data
   * @returns The closed transaction, or nothing if the id does not exist or the owner does not match
   */
  closeTransactionWithSuccess(id: string, owner: TransactionOwner, data: JanodeResponse): PendingTransaction | void {
    const tx = this.get(id);
    if (!tx) return;
    if (tx.owner !== owner) return;
    clearTimeout(tx.timeout);
    this.delete(id);
    tx.done(data);
    Logger.verbose(`${LOG_NS} [${tx.owner.id}] closed with success transaction ${id}, request "${tx.request}"`);
    return tx;
  }
}

export default TransactionManager;
