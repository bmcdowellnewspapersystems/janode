/**
 * This module contains the Handle class definition.
 * @module handle
 * @private
 */

import { EventEmitter } from 'events';

import Logger from './utils/logger.ts';
const LOG_NS = '[handle.ts]';
import { getNumericID } from './utils/utils.ts';
import { JANUS, JANODE, isAckData, isResponseData, isErrorData, JanodeCoreEvents } from './protocol.ts';

import Session from './session.ts';
import TransactionManager from './tmanager.ts';
import type { TransactionOwner, PendingTransaction } from './tmanager.ts';
import { VideoRoomHandleEventMap } from './plugins/videoroom-plugin.ts';

// TODO: are JanodeRequest/JanusMessage and JanodeResponse/JanodeEvent the same thing?
export type JanodeRequest = any
export type JanodeResponse = any
export type JanusMessage = any
export type JanodeEvent = any

export type HandleEventsMap = {
  handle_detached: [{ id: number }],
  handle_ice_failed: [{}],
  handle_hangup: [{ reason: string }],
  handle_media: [{ type: string, receiving: boolean, mid: string, substream: number, seconds: number }],
  handle_webrtcup: [{}],
  handle_slowlink: [{ uplink: boolean, media: string, mid: string, lost: number }],
  handle_trickle: [{ completed: boolean, sdpMid: string, sdpMLineIndex: number, candidate: string }],
  error: [{ message: string }]
}

const PLUGIN_EVENT_SYM = Symbol('plugin_event');

/**
 * Class representing a Janode handle.<br>
 *
 * Users implementing new plugins must extend this class and override the `handleMessage` function.<br>
 *
 * Handle extends EventEmitter, so an instance can emit events and users can subscribe to them.<br>
 *
 * Users are not expected to create Handle instances, but insted use the Session.attach() API.
 *
 * @hideconstructor
 */
class Handle extends EventEmitter<HandleEventsMap & VideoRoomHandleEventMap> implements TransactionOwner {
  private _tm: TransactionManager;
  private _detaching: boolean;
  private _detached: boolean;
  session: Session;
  id: number;
  name: string;
  private _sessionDestroyedListener: () => void;
  /**
   * Create a Janode handle.
   *
   * @param session - A reference to the parent session
   * @param id - The handle identifier
   */
  constructor(session: Session, id: number) {
    super();

    /**
     * The transaction manager used by this handle.
     */
    this._tm = session._tm; // keep track of pending requests

    /**
     * A boolean flag indicating that the handle is being detached.
     * Once the detach has been completed, the flag returns to false.
     */
    this._detaching = false;

    /**
     * A boolean flag indicating that the handle has been detached.
     */
    this._detached = false;

    /**
     * The parent Janode session.
     */
    this.session = session;

    /**
     * The handle unique id, usually taken from Janus response.
     */
    this.id = id;

    /**
     * A more descriptive, not unique string (used for logging).
     */
    this.name = `[${this.id}]`;

    /**
     * The callback function used for a session destroyed event.
     */
    this._sessionDestroyedListener = this._signalDetach.bind(this);

    /* Set a listener to run a callback when session gets destroyed */
    this.session.once(JANODE.EVENT.SESSION_DESTROYED, this._sessionDestroyedListener);
    /* Set a dummy error listener to avoid to avoid unmanaged errors */
    this.on('error', e => `${LOG_NS} ${this.name} catched unmanaged error ${e.message}`);
  }

  /**
   * Cleanup the handle closing all owned transactions, emitting the detached event
   * and removing all registered listeners.
   *
   * @private
   */
  _signalDetach(): void {
    if (this._detached) return;
    this._detaching = false;
    this._detached = true;

    /* Remove the listener for session destroyed event */
    this.session.removeListener(JANODE.EVENT.SESSION_DESTROYED, this._sessionDestroyedListener);
    /* Close all pending transactions for this handle with an error */
    this._tm.closeAllTransactionsWithError(this, new Error('handle detached'));
    /* Emit the detached event */
    /**
     * The handle has been detached.
     *
     * @event Handle#event:HANDLE_DETACHED
     * @type {Object}
     * @property {number} id - The handle identifier
     */
    this.emit(JANODE.EVENT.HANDLE_DETACHED, { id: this.id });
    /* Remove all listeners to avoid leaks */
    this.removeAllListeners();
  }

  /**
   * Helper to check if a pending transaction is a trickle.
   *
   * @private
   * @param id - The transaction identifier
   */
  _isTrickleTx(id: string): boolean {
    const tx = this._tm.get(id);
    if (tx) return tx.request === JANUS.REQUEST.TRICKLE;
    return false;
  }

  /**
   * Helper to check if a pending transaction is a hangup.
   *
   * @private
   * @param id - The transaction identifier
   * @returns
   */
  _isHangupTx(id: string): boolean {
    const tx = this._tm.get(id);
    if (tx) return tx.request === JANUS.REQUEST.HANGUP;
    return false;
  }

  /**
   * Helper to check if a pending transaction is a detach.
   *
   * @private
   * @param id - The transaction identifier
   * @returns 
   */
  _isDetachTx(id: string): boolean {
    const tx = this._tm.get(id);
    if (tx) return tx.request === JANUS.REQUEST.DETACH_PLUGIN;
    return false;
  }

  /**
   * Manage a message sent to this handle. If this involves a owned transaction
   * and the response is a definitive one, the transaction will be closed.
   * In case the instance implements a `handleMessage` method, this function will
   * pass the message to it on order to let a plugin implements its custom logic.
   * Generic Janus API events like `detached`, `hangup` etc. are handled here.
   *
   * @private
   * @param janus_message
   */
  _handleMessage(janus_message: JanodeRequest): void {
    const { transaction, janus } = janus_message;

    /* First check if a transaction is involved */
    if (transaction) {
      Logger.verbose(`${LOG_NS} ${this.name} received ${janus} for transaction ${transaction}`);

      /* First check if this handle owns the transaction */
      if (this.ownsTransaction(transaction)) {

        /*
         * Pending transaction management. Close transaction in case of:
         * 1) Ack response to a trickle request
         * 2) Definitive (success/error) response
         */

        /* Case #1: close tx related to trickles */
        if (isAckData(janus_message)) {
          if (this._isTrickleTx(transaction)) {
            this.closeTransactionWithSuccess(transaction, janus_message);
          }
          return;
        }

        /* Case #2: close tx with a definitive response */
        if (isResponseData(janus_message)) {
          if (isErrorData(janus_message)) {
            /* Case #2 (error): close tx with a definitive error */
            const error = new Error(`${janus_message.error.code} ${janus_message.error.reason}`);
            this.closeTransactionWithError(transaction, error);
            return;
          }

          /* Case #2 (success) */

          /* Close hangup Tx */
          if (this._isHangupTx(transaction)) {
            this.closeTransactionWithSuccess(transaction, janus_message);
            return;
          }

          /* Close detach tx */
          if (this._isDetachTx(transaction)) {
            this.closeTransactionWithSuccess(transaction, janus_message);
            return;
          }

          /*
           * If an instance implements a handleMessage method, try to use it.
           * The custom handler may decide to close tx with success or error.
           * A falsy return from handleMessage is considered as a "not-handled" message.
           */
          if (!this.handleMessage(janus_message)) {
            Logger.verbose(`${LOG_NS} ${this.name} received response could not be handled by the plugin`);
          }

          /*
           * As a fallback always close with success a transaction with a definitive success response.
           * Closing a transaction is an indempotent action.
           */
          this.closeTransactionWithSuccess(transaction, janus_message);
          return;
        }
      }
    }

    /* Handling of a message that did not close a transaction (e.g. async events) */
    const janode_event_data: any = {};
    switch (janus) {

      /* Generic Janus event */
      case JANUS.EVENT.EVENT: {
        /* If an instance implements a handleMessage method, use it */
        if (!this.handleMessage(janus_message)) {
          /* If handleMessage has a falsy return close tx with error */
          Logger.warn(`${LOG_NS} ${this.name} received event could not be handled by the plugin`);
          const error = new Error('unmanaged event');
          this.closeTransactionWithError(transaction, error);
        }
        break;
      }

      /* Detached event: the handle has been detached */
      case JANUS.EVENT.DETACHED: {
        this._signalDetach();
        break;
      }

      /* ice-failed event: Janus ICE agent has detected a failure */
      case JANUS.EVENT.ICE_FAILED: {
        /**
         * The handle has detected an ICE failure.
         *
         * @event Handle#event:HANDLE_ICE_FAILED
         * @type {Object}
         */
        this.emit(JANODE.EVENT.HANDLE_ICE_FAILED, janode_event_data);
        break;
      }

      /* Hangup event: peer connection is down */
      /* In this case the janus message has a reason field */
      case JANUS.EVENT.HANGUP: {
        if (typeof janus_message.reason !== 'undefined') janode_event_data.reason = janus_message.reason;
        /**
         * The handle WebRTC connection has been closed.
         *
         * @event Handle#event:HANDLE_HANGUP
         * @type {Object}
         * @property {string} [reason] - The reason of the hangup (e.g. ICE failed)
         */
        this.emit(JANODE.EVENT.HANDLE_HANGUP, janode_event_data);
        break;
      }

      /* Media event: a/v media reception from Janus */
      /* In this case the janus message has "type" and "receiving" fields */
      case JANUS.EVENT.MEDIA: {
        if (typeof janus_message.type !== 'undefined') janode_event_data.type = janus_message.type;
        if (typeof janus_message.receiving !== 'undefined') janode_event_data.receiving = janus_message.receiving;
        if (typeof janus_message.mid !== 'undefined') janode_event_data.mid = janus_message.mid;
        if (typeof janus_message.substream !== 'undefined') janode_event_data.substream = janus_message.substream;
        if (typeof janus_message.seconds !== 'undefined') janode_event_data.seconds = janus_message.seconds;
        /**
         * The handle received a media notification.
         *
         * @event Handle#event:HANDLE_MEDIA
         * @type {Object}
         * @property {string} type - The kind of media (audio/video)
         * @property {boolean} receiving - True if Janus is receiving media
         * @property {string} [mid] - The involved mid
         * @property {number} [substream] - The involved simulcast substream
         * @property {number} [seconds] - Time, in seconds, with no media
         */
        this.emit(JANODE.EVENT.HANDLE_MEDIA, janode_event_data);
        break;
      }

      /* Webrtcup event: peer connection is up */
      case JANUS.EVENT.WEBRTCUP: {
        /**
         * The handle WebRTC connection is up.
         *
         * @event Handle#event:HANDLE_WEBRTCUP
         * @type {Object}
         */
        this.emit(JANODE.EVENT.HANDLE_WEBRTCUP, janode_event_data);
        break;
      }

      /* Slowlink event: NACKs number increasing */
      /* In this case the janus message has "uplink" and "nacks" fields */
      case JANUS.EVENT.SLOWLINK: {
        if (typeof janus_message.uplink !== 'undefined') janode_event_data.uplink = janus_message.uplink;
        if (typeof janus_message.mid !== 'undefined') janode_event_data.mid = janus_message.mid;
        if (typeof janus_message.media !== 'undefined') janode_event_data.media = janus_message.media;
        if (typeof janus_message.lost !== 'undefined') janode_event_data.lost = janus_message.lost;
        /**
         * The handle has received a slowlink notification.
         *
         * @event Handle#event:HANDLE_SLOWLINK
         * @type {Object}
         * @property {boolean} uplink - The direction of the slow link
         * @property {string} media - The media kind (audio/video)
         * @property {string} [mid] - The involved stream mid
         * @property {number} lost - Number of missing packets in the last time slot
         */
        this.emit(JANODE.EVENT.HANDLE_SLOWLINK, janode_event_data);
        break;
      }

      /* Trickle from Janus */
      case JANUS.EVENT.TRICKLE: {
        const { completed, sdpMid, sdpMLineIndex, candidate } = janus_message.candidate;
        if (!completed) {
          janode_event_data.sdpMid = sdpMid;
          janode_event_data.sdpMLineIndex = sdpMLineIndex;
          janode_event_data.candidate = candidate;
        }
        else {
          janode_event_data.completed = true;
        }

        /**
         * The handle has received a trickle notification.
         *
         * @event Handle#event:HANDLE_TRICKLE
         * @type {Object}
         * @property {boolean} [completed] - If true, this notifies the end of triclking (the other fields of the event are missing in this case)
         * @property {string} [sdpMid] - The mid the candidate refers to
         * @property {number} [sdpMLineIndex] - The m-line the candidate refers to
         * @property {string} [candidate] - The candidate string
         */
        this.emit(JANODE.EVENT.HANDLE_TRICKLE, janode_event_data);
        break;
      }

      default:
        Logger.error(`${LOG_NS} ${this.name} unknown janus event directed to the handle ${JSON.stringify(janus_message)}`);
    }
  }

  /**
   * Decorate request with handle id and transaction (if missing).
   *
   * @private
   * @param request
   */
  _decorateRequest(request: JanodeRequest) {
    request.transaction = request.transaction || getNumericID();
    request.handle_id = request.handle_id || this.id;
  }

  decorateRequest(request: JanodeRequest) {
    this._decorateRequest(request);
  }

  /**
   * Helper method used by plugins to create a new plugin event and assign it to a janus message.
   *
   * @private
   */
  _newPluginEvent(janus_message: JanusMessage): JanodeEvent {
    /* Prepare an object for the output Janode event */
    const janode_event: any = {
      /* The name of the resolved event */
      event: null,
      /* The event payload */
      data: {},
    };

    /* Add JSEP data if available */
    if (janus_message.jsep) {
      janode_event.data.jsep = janus_message.jsep;
      if (typeof janus_message.jsep.e2ee === 'boolean') janode_event.data.e2ee = janus_message.jsep.e2ee;
    }

    janus_message[PLUGIN_EVENT_SYM] = janode_event;
    return janode_event;
  }

  /**
   * Helper method used by plugins to get an assigned plugin eventfrom a handled janus message.
   *
   * @private
   */
  _getPluginEvent(janus_message: JanusMessage): JanodeCoreEvents {
    return janus_message[PLUGIN_EVENT_SYM] || {};
  }

  /**
   * Stub handleMessage (it is overriden by specific plugin handlers).
   * Implementations must return falsy values for unhandled events and truthy value
   * for handled events.
   */
  handleMessage(_janus_message: JanusMessage): JanodeEvent {
    return null;
  }

  /**
   * Helper to check if the handle is managing a specific transaction.
   *
   * @property id - The transaction id
   * @returns True if this handle is the owner
   */
  ownsTransaction(id: string): boolean {
    return this._tm.getTransactionOwner(id) === this;
  }

  /**
   * Helper to close a transaction with error.
   *
   * @property id - The transaction id
   * @property error - The error object
   */
  closeTransactionWithError(id: string, error: Error): void {
    this._tm.closeTransactionWithError(id, this, error);
    return;
  }

  /**
   * Helper to close a transaction with success.
   *
   * @property {string} id - The transaction id
   * @property {Object} [data] - The callback success data
   * @returns {void}
   */
  closeTransactionWithSuccess(id: string, data: JanodeResponse): void {
    this._tm.closeTransactionWithSuccess(id, this, data);
    return;
  }


  /**
   * Send a request from this handle.
   *
   * @param request
   * @param [timeout_ms=0]
   * @returns A promise resolving with the response to the request
   */
  async sendRequest(request: JanodeRequest, timeout_ms: number = 0): Promise<JanodeResponse> {
    /* Input check */
    if (typeof request !== 'object' || !request) {
      const error = new Error('request must be an object');
      Logger.error(`${LOG_NS} ${this.name} ${error.message}`);
      throw error;
    }

    /* Check handle status */
    if (this._detached) {
      const error = new Error('unable to send request because handle has been detached');
      Logger.error(`${LOG_NS} ${this.name} ${error.message}`);
      throw error;
    }

    /* Add handle properties */
    this._decorateRequest(request);

    return new Promise<PendingTransaction>((resolve, reject) => {
      /* Create a new transaction if the transaction does not exist */
      /* Use promise resolve and reject fn as callbacks for the transaction */
      this._tm.createTransaction(request.transaction, this, request.janus, resolve, reject, timeout_ms);

      /* Send this message through the parent janode session */
      this.session.sendRequest(request).catch(error => {
        /* In case of error quickly close the transaction */
        this.closeTransactionWithError(request.transaction, error);
      });
    });
  }

  /**
   * Gracefully detach the Handle.
   */
  async detach(): Promise<void> {
    if (this._detaching) {
      const error = new Error('detaching already in progress');
      Logger.verbose(`${LOG_NS} ${this.name} ${error.message}`);
      throw error;
    }
    if (this._detached) {
      const error = new Error('already detached');
      Logger.verbose(`${LOG_NS} ${this.name} ${error.message}`);
      throw error;
    }
    Logger.info(`${LOG_NS} ${this.name} detaching handle`);
    this._detaching = true;

    const request = {
      janus: JANUS.REQUEST.DETACH_PLUGIN,
    };

    try {
      await this.sendRequest(request);
      this._signalDetach();
      return;
    }
    catch (error) {
      this._detaching = false;
      Logger.error(`${LOG_NS} ${this.name} error while detaching (${(error as Error).message})`);
    }
  }

  /**
   * Close the peer connection associated to this handle.
   *
   * @returns
   */
  async hangup(): Promise<JanodeResponse> {
    const request = {
      janus: JANUS.REQUEST.HANGUP,
    };

    try {
      return this.sendRequest(request);
    }
    catch (error) {
      Logger.error(`${LOG_NS} ${this.name} error while hanging up (${(error as Error).message})`);
      throw error;
    }
  }

  /**
   * Send an ICE candidate / array of candidates.
   */
  async trickle(candidate: RTCIceCandidate | RTCIceCandidate[] | { completed: true }): Promise<void> {
    /* If candidate is null or undefined, send an ICE trickle complete message */
    if (!candidate) return this.trickleComplete();

    /* Input checking */
    if (typeof candidate !== 'object') {
      const error = new Error('invalid candidate object');
      Logger.error(`${LOG_NS} ${this.name} ${error.message}`);
      throw error;
    }

    const request: any = {
      janus: JANUS.REQUEST.TRICKLE
    };

    /* WATCH OUT ! In case of an array, the field is name "candidates" */
    if (Array.isArray(candidate)) {
      request.candidates = candidate;
    }
    else {
      request.candidate = candidate;
    }

    try {
      return this.sendRequest(request) as Promise<void>;
    } catch (error) {
      Logger.error(`${LOG_NS} ${this.name} error on trickle (${(error as Error).message})`);
      throw error;
    }
  }

  /**
   * Send ICE trickle complete message.
   *
   * @returns {Promise<void>}
   */
  async trickleComplete(): Promise<void> {
    return this.trickle({
      completed: true
    });
  }

  /**
   * Send a `message` to Janus from this handle, with given body and optional jsep.
   *
   * @param body - The body of the message
   * @param [jsep]
   * @returns A promise resolving with the response to the message
   *
   * @example
   * // This is a plugin that sends a message with a custom body
   * const body = {
   *   audio: true,
   *   video: true,
   *   record: false,
   * };
   *
   * await handle.message(body, jsep);
   *
   */
  async message(body: any, jsep?: RTCSessionDescription): Promise<JanodeResponse> {
    const request: any = {
      janus: JANUS.REQUEST.MESSAGE,
      body,
    };
    if (jsep) request.jsep = jsep;

    try {
      return this.sendRequest(request);
    }
    catch (error) {
      Logger.error(`${LOG_NS} ${this.name} error on message (${(error as Error).message})`);
      throw error;
    }
  }

}

export default Handle;