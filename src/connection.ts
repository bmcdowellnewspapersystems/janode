/**
 * This module contains the Connection class definition.
 * @module connection
 * @private
 */

import { EventEmitter } from 'events';

import Logger from './utils/logger.ts';
const LOG_NS = '[connection.ts]';
import { getNumericID, checkUrl, newIterator } from './utils/utils.ts';
import { JANODE, JANUS, isResponseData, isErrorData } from './protocol.ts';
import WsTransport from './transport-ws.ts';
import UnixTransport from './transport-unix.ts';
import JanodeSession from './session.ts';
import TransactionManager from './tmanager.ts';

import Configuration from './configuration.ts';
import Session from './session.ts';

import type { PendingTransaction } from './tmanager.ts';
import type { ServerObjectConf } from './janode.ts';
import type { JanodeRequest, JanodeResponse, JanusMessage } from './handle.ts';
import type { CircularIterator } from './utils/utils.ts';

export interface GenericTransport {
  open: () => Promise<Connection>,
  close: () => Promise<unknown>,
  send: (request: unknown) => Promise<void>, // Ben TODO: the JSDocs for transport-ws and transport-unix mention that the promise is meant to return an object, but neither of them (seemingly) actually do?
  getRemoteHostname: () => string | null
}

/**
 * Class representing a Janode connection.<br>
 *
 * Specific transports are picked by checking the connection URI.<br>
 *
 * This class implements both the Janus API and Admin API.<br>
 *
 * Connection extends EventEmitter, so an instance can emit events and users can subscribe to them.<br>
 *
 * Users are not expected to create Connection instances, but insted use the Janode.connect() API.<br>
 *
 * @hideconstructor
 */
class Connection extends EventEmitter {
  _config: Configuration; // Meant to be private, but used in transport-ws.ts
  _tm: TransactionManager; // Meant to be private, but used in Session.ts
  private _sessions: Map<unknown, Session>; // Ben TODO: Fix Type
  _address_iterator: CircularIterator<ServerObjectConf> // Meant to be private but used in transport-unix.ts
  id: number;
  name: string;
  private _transport: GenericTransport;
  /**
   * Create a Janode Connection.
   *
   * @param {Configuration} server_config - The Janode configuration as created by the Configuration constructor.
   */
  constructor(server_config: Configuration) {
    super();

    /**
     * The configuration in use for this connection.
     *
     * @private
     */
    this._config = server_config;

    /**
     * The transaction manager used by this connection.
     *
     * @private
     */
    this._tm = new TransactionManager();

    /**
     * Keep track of the sessions.
     *
     * @private
     */
    this._sessions = new Map();

    /**
     * The iterator to select available Janus addresses.
     *
     * @private
     */
    this._address_iterator = newIterator(this._config.getAddress());

    /**
     * A numerical identifier assigned for logging purposes.
     *
     */
    this.id = parseInt(getNumericID());

    /**
     * A more descriptive, not unique string (used for logging).
     *
     */
    this.name = `[${this.id}]`;

    /**
     * The transport used by this connection.
     *
     * @private
     */
    this._transport = {
      open: async () => { throw new Error('transport does not implement the "open" function'); },
      close: async () => { throw new Error('transport does not implement the "close" function'); },
      send: async () => { throw new Error('transport does not implement the "send" function'); },
      getRemoteHostname: () => { throw new Error('transport does not implement the "getRemoteHostname" function'); },
    };

    try {
      let transport: GenericTransport | undefined;
      /* Check the protocol to define the kind of transport */
      if (checkUrl(server_config.getAddress()[0].url, ['ws', 'wss', 'ws+unix', 'wss+unix'])) {
        transport = new WsTransport(this);
      }
      if (checkUrl(server_config.getAddress()[0].url, ['file'])) {
        transport = new UnixTransport(this);
      }
      if (transport) this._transport = transport;
    } catch (error) {
      Logger.error(`${LOG_NS} ${this.name} error while initializing transport (${(error as Error).message})`);
    }

    /* Set a dummy error listener to avoid unmanaged errors */
    this.on('error', e => `${LOG_NS} ${this.name} catched unmanaged error ${e.message}`);
  }

  /**
   * Cleanup the connection closing all owned transactions and emitting the destroyed event
   * and removing all registered listeners.
   *
   * @private
   * @param graceful - True if this is an expected disconnection
   */
  _signalClose(graceful: boolean): void {
    /* Close all pending transactions inside this connection with an error */
    this._tm.closeAllTransactionsWithError(undefined, new Error('connection closed'));
    /* Clear tx table */
    this._tm.clear();
    /* Clear session table */
    this._sessions.clear();

    /* Did we really mean to close it? */
    if (graceful) {
      /* This is a greceful teardown */
      /**
       * The connection has been gracefully closed.
       *
       * @event Connection#event:CONNECTION_CLOSED
       * @type {Object}
       * @property {number} id - The connection identifier
       */
      this.emit(JANODE.EVENT.CONNECTION_CLOSED, { id: this.id });
    }
    else {
      /* If this event is unexpected emit an error */
      const error = new Error('unexpected disconnection');
      /**
       * The connection has been unexpectedly closed.
       *
       * @event Connection#event:CONNECTION_ERROR
       * @type {Error}
       */
      this.emit(JANODE.EVENT.CONNECTION_ERROR, error);
    }

    /* Remove all listeners to avoid leaks */
    this.removeAllListeners();
  }

  /**
   * Open a connection using the transport defined open method.
   * Users do not need to call this method, since the connection is opened by Janode.connect().
   *
   * @returns A promise resolving with the Janode connection
   */
  async open(): Promise<Connection> {
    await this._transport.open();
    return this;
  }

  /**
   * Manage a message sent to this session.  If a session is involved let it manage the message.
   * If the message involves a owned transaction and the response is a definitive one,
   * the transaction will be closed.
   *
   * @private
   */
  _handleMessage(janus_message: JanusMessage): PendingTransaction | void {
    const { session_id, transaction, janus } = janus_message;

    /* Check if a session is involved */
    if (session_id && !this._config.isAdmin()) {
      /* Look for the session in the map */
      const session = this._sessions.get(session_id);
      /* If the handle is missing notifies the user */
      if (!session) {
        Logger.warn(`${LOG_NS} ${this.name} session ${session_id} not found for incoming message ${janus}`);
        return;
      }

      try {
        /* Let the session manage the message */
        session._handleMessage(janus_message);
      } catch (error) {
        Logger.error(`${LOG_NS} ${this.name} error while handling message (${(error as Error).message})`);
      }
      return;
    }

    /* Check if a transaction is involved */
    if (transaction) {
      Logger.verbose(`${LOG_NS} ${this.name} received ${janus} for transaction ${transaction}`);

      /* Not owned by this connection? */
      if (this._tm.getTransactionOwner(transaction) !== this) {
        Logger.warn(`${LOG_NS} ${this.name} transaction ${transaction} not found for incoming messsage ${janus}`);
        return;
      }

      /*
       * Pending connection transaction management.
       * Close transaction in case of:
       * 1) Definitive response
       */
      if (isResponseData(janus_message)) {
        if (isErrorData(janus_message)) {
          const error = new Error(`${janus_message.error.code} ${janus_message.error.reason}`);
          return this._tm.closeTransactionWithError(transaction, this, error);
        }

        this._tm.closeTransactionWithSuccess(transaction, this, janus_message);
      }

      return;
    }

    /* No session, no transaction? */
    Logger.error(`${LOG_NS} ${this.name} unexpected janus message directed to the connection ${JSON.stringify(janus_message)}`);
  }

  /**
   * Decorate request with apisecret, token and transaction (if missing).
   */
  _decorateRequest(request: JanodeRequest) {
    request.transaction = request.transaction || getNumericID();
    if (this._address_iterator.currElem().apisecret) {
      if (!this._config.isAdmin())
        request.apisecret = request.apisecret || this._address_iterator.currElem().apisecret;
      else
        request.admin_secret = request.admin_secret || this._address_iterator.currElem().apisecret;
    }
    if (this._address_iterator.currElem().token)
      request.token = this._address_iterator.currElem().token;
  }

  /**
   * Gracefully close the connection using the transport defined close method.
   */
  async close(): Promise<void> {
    await this._transport.close();
    return;
  }

  /**
   * Send a request from this connection using the transport defined send method.
   *
   * @param request - The request to be sent
   * @returns A promise resolving with a response from Janus
   */
  async sendRequest(request: JanodeRequest): Promise<JanodeResponse> {
    /* Add connection properties */
    this._decorateRequest(request);

    return new Promise<JanodeResponse>((resolve, reject) => {
      /* Create a new transaction if the transaction does not exist */
      /* Use promise resolve and reject fn as callbacks for the transaction */
      this._tm.createTransaction(request.transaction, this, request.janus, resolve, reject);

      this._transport.send(request).catch(error => {
        /* In case of error quickly close the transaction */
        this._tm.closeTransactionWithError(request.transaction, this, error);
        reject(error);
        return;
      });
    });
  }

  /**
   * Get the remote Janus hostname using the transport defined method.
   *
   * @returns The hostname of the Janus server
   */
  getRemoteHostname(): string | null {
    return this._transport.getRemoteHostname();
  }

  /**
   * Create a new session in this connection.
   *
   * @param [ka_interval] - The time interval (seconds) for session keep-alive requests
   * @returns The newly created session
   *
   * @example
   *
   * const session = await connection.create();
   * Logger.info(`***** SESSION CREATED *****`);
   */
  async create(ka_interval?: number): Promise<Session> {
    Logger.info(`${LOG_NS} ${this.name} creating new session`);

    const request = {
      janus: JANUS.REQUEST.CREATE_SESSION,
    };

    try {
      const { data: { id } } = await this.sendRequest(request);
      /* Increase the maximum number of listeners for this connection */
      /* The session will register two listeners */
      this.setMaxListeners(this.getMaxListeners() + 2);

      /* Create a new Janode Session and add it to the table */
      const session_instance = new JanodeSession(this, id, ka_interval);
      this._sessions.set(session_instance.id, session_instance);

      /* On session destroy delete the entry from session map and decrease the number of listeners */
      session_instance.once(JANODE.EVENT.SESSION_DESTROYED, ({ id }) => {
        this._sessions.delete(id);
        this.setMaxListeners(this.getMaxListeners() - 2);
      });

      Logger.info(`${LOG_NS} ${this.name} session created (id=${id})`);
      return session_instance;
    }
    catch (error) {
      Logger.error(`${LOG_NS} ${this.name} session creation error (${(error as Error).message})`);
      throw error;
    }
  }

  /**
   * Janus GET INFO API.
   *
   * @returns The Get Info response
   *
   * @example
   *
   * const info = await connection.getInfo();
   * Logger.info(`${info.name} ${info.version_string}`);
   */
  async getInfo(): Promise<JanodeResponse> {
    Logger.info(`${LOG_NS} ${this.name} requesting server info`);

    const request = {
      janus: JANUS.REQUEST.SERVER_INFO,
    };

    return this.sendRequest(request);
  }

  /*************/
  /* ADMIN API */
  /*************/

  /* The following APIs are available only if a connection has been created with is_admin = true in the config */

  /**
   * (Admin API) List the sessions in a janus instance.
   *
   * @example
   *
   * const data = await connection.listSessions();
   * Logger.info(`${JSON.stringify(data)}`);
   */
  async listSessions(): Promise<JanodeResponse> {
    Logger.verbose(`${LOG_NS} ${this.name} requesting session list`);

    const request = {
      janus: JANUS.ADMIN.LIST_SESSIONS,
    };

    return this.sendRequest(request);
  }

  /**
   * (Admin API) List the handles in a session.
   *
   * @param session_id - The identifier of the session
   *
   * @example
   *
   * const data = await connection.listSessions();
   * Logger.info(`${JSON.stringify(data)}`);
   */
  async listHandles(session_id: number): Promise<JanodeResponse> {
    Logger.info(`${LOG_NS} ${this.name} requesting handle list`);
    if (!session_id) {
      const error = new Error('session_id parameter not specified');
      Logger.error(`${LOG_NS} ${this.name} ${error.message}`);
      throw error;
    }
    const request = {
      janus: JANUS.ADMIN.LIST_HANDLES,
      session_id,
    };

    return this.sendRequest(request);
  }

  /**
   * (Admin API) Get an handle info.
   *
   * @param session_id - The session identifier
   * @param handle_id - The handle identifier
   * @returns The Get Handle Info response
   *
   * @example
   *
   * const data = await connection.handleInfo(session.id, handle.id);
   * Logger.info(`${JSON.stringify(data)}`);
   */
  async handleInfo(session_id: number, handle_id: number): Promise<JanodeResponse> {
    Logger.info(`${LOG_NS} ${this.name} requesting handle info`);
    if (!session_id) {
      const error = new Error('session_id parameter not specified');
      Logger.error(`${LOG_NS} ${this.name} ${error.message}`);
      throw error;
    }
    if (!handle_id) {
      const error = new Error('handle_id parameter not specified');
      Logger.error(`${LOG_NS} ${this.name} ${error.message}`);
      throw error;
    }
    const request = {
      janus: JANUS.ADMIN.HANDLE_INFO,
      session_id,
      handle_id,
    };

    return this.sendRequest(request);
  }

  /**
   * (Admin API) Start a packet capture on an handle.
   *
   * @param session_id - The session identifier
   * @param handle_id - The handle identifier
   * @param folder - The folder in which save the pcap
   * @param filename - The pcap file name
   * @param [truncate] - Number of bytes to truncate the pcap to
   * @returns The start pcap response
   */
  async startPcap(session_id: number, handle_id: number, folder: string, filename: string, truncate?: number): Promise<JanodeResponse> {
    Logger.info(`${LOG_NS} ${this.name} requesting pcap start for handle ${handle_id}`);
    if (!session_id) {
      const error = new Error('session_id parameter not specified');
      Logger.error(`${LOG_NS} ${this.name} ${error.message}`);
      throw error;
    }
    if (!handle_id) {
      const error = new Error('handle_id parameter not specified');
      Logger.error(`${LOG_NS} ${this.name} ${error.message}`);
      throw error;
    }
    if (typeof folder !== 'string' || typeof filename !== 'string') {
      const error = new Error('invalid folder or filename specified');
      Logger.error(`${LOG_NS} ${this.name} ${error.message}`);
      throw error;
    }
    const request: any = {
      janus: JANUS.ADMIN.START_PCAP,
      session_id,
      handle_id,
      folder,
      filename,
    };
    if ((typeof truncate === 'number') && truncate > 0) {
      request.truncate = truncate;
    }

    return this.sendRequest(request);
  }

  /**
   * Stop an ogoing packet capture.
   *
   * @param session_id - The session identifier
   * @param handle_id - The handle identifier
   * @returns The stop pcap response
   */
  async stopPcap(session_id: number, handle_id: number): Promise<JanodeResponse> {
    Logger.info(`${LOG_NS} ${this.name} requesting pcap stop for handle ${handle_id}`);
    if (!session_id) {
      const error = new Error('session_id parameter not specified');
      Logger.error(`${LOG_NS} ${this.name} ${error.message}`);
      throw error;
    }
    if (!handle_id) {
      const error = new Error('handle_id parameter not specified');
      Logger.error(`${LOG_NS} ${this.name} ${error.message}`);
      throw error;
    }
    const request = {
      janus: JANUS.ADMIN.STOP_PCAP,
      session_id,
      handle_id,
    };

    return this.sendRequest(request);
  }

}

export default Connection;
