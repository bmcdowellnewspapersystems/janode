/**
 * This module contains the WebSocket transport implementation.
 * @module transport-ws
 * @private
 */

/* Isomorphic implementation of WebSocket */
/* It uses ws on Node and global.WebSocket in browsers */
import WebSocket from 'isomorphic-ws';

import Logger from './utils/logger.ts';
const LOG_NS = '[transport-ws.ts]';
import { delayOp } from './utils/utils.ts';

import Connection from './connection.ts';
import type { GenericTransport } from './connection.ts'
import type { TransactionOwner } from './tmanager.ts';

/* Janus API ws subprotocol */
const API_WS = 'janus-protocol';
/* Janus Admin API ws subprotocol */
const ADMIN_WS = 'janus-admin-protocol';

/* Default ws ping interval */
const PING_TIME_SECS = 10;
/* Default pong wait timeout */
const PING_TIME_WAIT_SECS = 5;

/**
 * Class representing a connection through WebSocket transport.<br>
 *
 * In case of failure a connection will be retried according to the configuration (time interval and
 * times to attempt). At every attempt, if multiple addresses are available for Janus, the next address
 * will be tried. An error will be raised only if the maxmimum number of attempts have been reached.<br>
 *
 * Internally uses WebSockets API to establish a connection with Janus and uses ws ping/pong as keepalives.<br>
 *
 * @private
 */
class TransportWs implements GenericTransport, TransactionOwner {
  private _connection: Connection;
  private _ws: WebSocket | null;
  private _attempts: number;
  private _opening: boolean;
  private _opened: boolean;
  private _closing: boolean;
  private _closed: boolean;
  private _ping_task: NodeJS.Timeout | null;
  id: number;
  name: string;
  /**
   * Create a connection through WebSocket.
   *
   * @param connection - The parent Janode connection
   */
  constructor(connection: Connection) {
    /**
     * The parent  Janode connection.
     */
    this._connection = connection;

    /**
     * The internal WebSocket connection.
     */
    this._ws = null;

    /**
     * Internal counter for connection attempts.
     */
    this._attempts = 0;

    /**
     * A boolean flag indicating that the connection is being opened.
     */
    this._opening = false;

    /**
     * A boolean flag indicating that the connection has been opened.
     */
    this._opened = false;

    /**
     * A boolean flag indicating that the connection is being closed.
     */
    this._closing = false;

    /**
     * A boolean flag indicating that the connection has been closed.
     */
    this._closed = false; // true if websocket has been closed after being opened

    /**
     * The task of the peridic ws ping.
     */
    this._ping_task = null;

    /**
     * A numerical identifier assigned for logging purposes.
     */
    this.id = connection.id;

    /**
     * A more descriptive, not unique string (used for logging).
     */
    this.name = `[${this.id}]`;
  }

  /**
   * Initialize the internal WebSocket.
   * Wraps with a promise the standard WebSocket API opening.
   */
  async _initWebSocket(): Promise<Connection> {
    Logger.info(`${LOG_NS} ${this.name} trying connection with ${this._connection._address_iterator.currElem().url}`);

    return new Promise<Connection>((resolve, reject) => {
      const wsOptions = this._connection._config.wsOptions() || {};
      if (!wsOptions.handshakeTimeout) wsOptions.handshakeTimeout = 5000;

      const ws = new WebSocket(
        this._connection._address_iterator.currElem().url,
        [this._connection._config.isAdmin() ? ADMIN_WS : API_WS],
        wsOptions);

      /* Register an "open" listener */
      ws.addEventListener('open', () => {
        Logger.info(`${LOG_NS} ${this.name} websocket connected`);
        /* Set the ping/pong task */
        this._setPingTask(PING_TIME_SECS * 1000);
        /* Resolve the promise and return this connection */
        // Ben TODO: Fix this
        //@ts-expect-error
        resolve(this);
      }, { once: true });

      /* Register a "close" listener */
      ws.addEventListener('close', ({ code, reason, wasClean }: any) => {
        Logger.info(`${LOG_NS} ${this.name} websocket closed code=${code} reason=${reason} clean=${wasClean}`);
        /* Start cleanup */
        /* Cancel the KA task */
        this._unsetPingTask();
        const wasClosing = this._closing;
        this._closing = false;
        this._closed = true;
        this._connection._signalClose(wasClosing);
        /* removeAllListeners is only supported on the node ws module */
        if (typeof this._ws?.removeAllListeners === 'function') this._ws?.removeAllListeners();
      }, { once: true });

      /* Register an "error" listener */
      /*
       * The "error" event is fired when a ws connection has been closed due
       * to an error (some data couldn't be sent for example)
       */
      ws.addEventListener('error', (error) => {
        Logger.error(`${LOG_NS} ${this.name} websocket error (${error.message})`);
        reject(error);
      }, { once: true });

      /* Register a "message" listener */
      ws.addEventListener('message', ({ data }: any) => {
        Logger.debug(`${LOG_NS} ${this.name} <ws RCV OK> ${data}`);
        this._connection._handleMessage(JSON.parse(data));
      });

      this._ws = ws;
    });
  }

  /**
   * Internal helper to open a websocket connection.
   * In case of error retry the connection with another address from the available pool.
   * If maximum number of attempts is reached, throws an error.
   *
   * @returns The websocket connection
   */
  async _attemptOpen(): Promise<Connection> {
    /* Reset status at every attempt, opening should be true at this step */
    this._opened = false;
    this._closing = false;
    this._closed = false;

    try {
      const conn = await this._initWebSocket();
      this._opening = false;
      this._opened = true;
      return conn;
    }
    catch (error) {
      /* In case of error notifies the user, but try with another address */
      this._attempts++;
      /* Get the max number of attempts from the configuration */
      if (this._attempts >= this._connection._config.getMaxRetries() + 1) {
        this._opening = false;
        const err = new Error('attempt limit exceeded');
        Logger.error(`${LOG_NS} ${this.name} connection failed, ${err.message}`);
        throw error;
      }
      Logger.error(`${LOG_NS} ${this.name} connection failed, will try again in ${this._connection._config.getRetryTimeSeconds()} seconds...`);
      /* Wait an amount of seconds specified in the configuration */
      await delayOp(this._connection._config.getRetryTimeSeconds() * 1000);
      /* Make shift the circular iterator */
      this._connection._address_iterator.nextElem();
      return this._attemptOpen();
    }
  }

  /**
   * Open a transport connection. This is called from parent connection.
   *
   * @returns A promise resolving with the Janode connection
   */
  async open(): Promise<Connection> {
    /* Check the flags before attempting a connection */
    let error;
    if (this._opening) error = new Error('unable to open, websocket is already being opened');
    else if (this._opened) error = new Error('unable to open, websocket has already been opened');
    else if (this._closed) error = new Error('unable to open, websocket has already been closed');

    if (error) {
      Logger.error(`${LOG_NS} ${this.name} ${error.message}`);
      throw error;
    }

    /* Set the starting status */
    this._opening = true;
    this._attempts = 0;

    /* Use internal helper */
    return this._attemptOpen();
  }

  /**
   * Send a ws ping frame.
   * This API is only available when the library is not used in a browser.
   */
  async _ping(): Promise<void> {
    /* ws.ping is only supported on the node "ws" module */
    if (typeof this._ws?.ping !== 'function') {
      Logger.warn('ws ping not supported');
      return;
    }
    let timeout: NodeJS.Timeout;

    /* Set a promise that will reject in PING_TIME_WAIT_SECS seconds */
    const timeout_ping = new Promise<void>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('timeout')), PING_TIME_WAIT_SECS * 1000);
    });

    /* Set a promise that will resolve once "pong" has been received */
    const ping_op = new Promise<void>((resolve, reject) => {
      /* Send current timestamp in the ping */
      const ping_data = '' + Date.now();

      this._ws?.ping(ping_data, undefined, error => {
        if (error) {
          Logger.error(`${LOG_NS} ${this.name} websocket PING send error (${error.message})`);
          clearTimeout(timeout);
          return reject(error);
        }
        Logger.verbose(`${LOG_NS} ${this.name} websocket PING sent (${ping_data})`);
      });

      /* Resolve on pong */
      this._ws?.once('pong', (data: { toString: () => any; }) => {
        Logger.verbose(`${LOG_NS} ${this.name} websocket PONG received (${data.toString()})`);
        clearTimeout(timeout);
        return resolve();
      });

    });

    /* Race between timeout and pong */
    return Promise.race([ping_op, timeout_ping]);
  }

  /**
   * Set a ws ping-pong task.
   *
   * @param delay - The ping interval in milliseconds
   */
  _setPingTask(delay: number): void {
    /* ws "ping" is only supported on the node ws module */
    if (typeof this._ws?.ping !== 'function') {
      Logger.warn('ws ping not supported');
      return;
    }
    if (this._ping_task) return;

    /* Set a periodic task to send a ping */
    /* In case of error, terminate the ws */
    this._ping_task = setInterval(async () => {
      try {
        await this._ping();
      } catch (error) {
        Logger.error(`${LOG_NS} ${this.name} websocket PING error (${(error as Error).message})`);
        /* ws "terminate" is only supported on the node ws module */
        this._ws?.terminate();
      }
    }, delay);

    Logger.info(`${LOG_NS} ${this.name} websocket ping task scheduled every ${PING_TIME_SECS} seconds`);
  }

  /**
   * Remove the ws ping task.
   */
  _unsetPingTask(): void {
    if (!this._ping_task) return;
    clearInterval(this._ping_task);
    this._ping_task = null;
    Logger.info(`${LOG_NS} ${this.name} websocket ping task disabled`);
  }

  /**
   * Get the remote Janus hostname.
   * It is called from the parent connection.
   *
   * @returns The hostname of the Janus server
   */
  getRemoteHostname(): string | null {
    if (this._ws && this._ws.url) {
      return (new URL(this._ws.url)).hostname;
    }
    return null;
  }

  /**
   * Gracefully close the connection.
   * Wraps with a promise the standard WebSocket API "close".
   * It is called from the parent connection.
   */
  async close(): Promise<void> {
    /* Check the status flags before */
    let error;
    if (!this._opened) error = new Error('unable to close, websocket has never been opened');
    else if (this._closing) error = new Error('unable to close, websocket is already being closed');
    else if (this._closed) error = new Error('unable to close, websocket has already been closed');

    if (error) {
      Logger.error(`${LOG_NS} ${this.name} ${error.message}`);
      throw error;
    }

    this._closing = true;

    return new Promise<void>((resolve, reject) => {
      Logger.info(`${LOG_NS} ${this.name} closing websocket`);
      try {
        this._ws?.close();
        /* Add a listener to resolve the promise */
        //@ts-expect-error
        // Ben TODO: Fix this
        this._ws?.addEventListener('close', resolve, { once: true });
      } catch (error) {
        Logger.error(`${LOG_NS} ${this.name} error while closing websocket (${(error as Error).message})`);
        this._closing = false;
        reject(error);
        return;
      }
    });
  }

  /**
   * Send a request from this connection.
   * Wraps with a promise the standard WebSocket API "send".
   * It is called from the parent connection.
   *
   * @param request - The request to be sent
   * @returns A promise resolving with a response from Janus
   */
  // Ben TODO: Originally returned Promsie<Object>, but it seems like it doesn't actually return anything?
  async send(request: any): Promise<void> {
    /* Check connection status */
    let error;
    if (!this._opened) error = new Error('unable to send request because connection has not been opened');
    else if (this._closed) error = new Error('unable to send request because connection has been closed');

    if (error) {
      Logger.error(`${LOG_NS} ${this.name} ${error.message}`);
      throw error;
    }

    /* Stringify the message */
    const string_req = JSON.stringify(request);

    return new Promise<void>((resolve, reject) => {
      this._ws?.send(string_req, { compress: false, binary: false }, (error?: Error) => {
        if (error) {
          Logger.error(`${LOG_NS} ${this.name} websocket send error (${error.message})`);
          reject(error);
          return;
        }
        Logger.debug(`${LOG_NS} ${this.name} <ws SND OK> ${string_req}`);
        resolve();
      });
    });
  }

}

export default TransportWs;
