import type { JanodeRequest } from "./handle.ts";

/**
 * This module contains several Janus constants related to the Janus/Admin API and Janode, like:<br>
 *
 * - Janus request names<br>
 *
 * - Janus response names<br>
 *
 * - Janus event names<br>
 *
 * - Janode event names<br>
 *
 * Some helper methods related to the protocols are defined here too.
 * @module protocol
 */

/**
 * Janus protocol constants
 *
 * @private
 */
export const JANUS = {
  /**
   * Janus API requests
   */
  REQUEST: {
    /* connection level requests */
    SERVER_INFO: 'info',
    /* session level requests */
    CREATE_SESSION: 'create',
    KEEPALIVE: 'keepalive',
    DESTROY_SESSION: 'destroy',
    /* handle level requests */
    ATTACH_PLUGIN: 'attach',
    MESSAGE: 'message',
    TRICKLE: 'trickle',
    HANGUP: 'hangup',
    DETACH_PLUGIN: 'detach',
  },
  /**
   * Janus temporary response (ack)
   */
  ACK: 'ack',
  /**
   * Janus definitive responses
   */
  RESPONSE: {
    SUCCESS: 'success',
    SERVER_INFO: 'server_info',
    ERROR: 'error',
  },
  /**
   * Janus events
   */
  EVENT: {
    EVENT: 'event',
    DETACHED: 'detached',
    ICE_FAILED: 'ice-failed',
    HANGUP: 'hangup',
    MEDIA: 'media',
    TIMEOUT: 'timeout',
    WEBRTCUP: 'webrtcup',
    SLOWLINK: 'slowlink',
    TRICKLE: 'trickle',
  },
  /**
   * Janus Admin API requests
   */
  ADMIN: {
    LIST_SESSIONS: 'list_sessions',
    LIST_HANDLES: 'list_handles',
    HANDLE_INFO: 'handle_info',
    START_PCAP: 'start_pcap',
    STOP_PCAP: 'stop_pcap',
  },
};

/**
 * @property CONNECTION_CLOSED - {@link module:connection~Connection#event:CONNECTION_CLOSED CONNECTION_CLOSED}
 * @property SESSION_DESTROYED - {@link module:session~Session#event:SESSION_DESTROYED SESSION_DESTROYED}
 * @property HANDLE_DETACHED - {@link module:handle~Handle#event:HANDLE_DETACHED HANDLE_DETACHED}
 * @property HANDLE_ICE_FAILED - {@link module:handle~Handle#event:HANDLE_ICE_FAILED HANDLE_ICE_FAILED}
 * @property HANDLE_HANGUP - {@link module:handle~Handle#event:HANDLE_HANGUP HANDLE_HANGUP}
 * @property HANDLE_MEDIA - {@link module:handle~Handle#event:HANDLE_MEDIA HANDLE_MEDIA}
 * @property HANDLE_WEBRTCUP - {@link module:handle~Handle#event:HANDLE_WEBRTCUP HANDLE_WEBRTCUP}
 * @property HANDLE_SLOWLINK - {@link module:handle~Handle#event:HANDLE_SLOWLINK HANDLE_SLOWLINK}
 * @property HANDLE_TRICKLE - {@link module:handle~Handle#event:HANDLE_TRICKLE HANDLE_TRICKLE}
 * @property CONNECTION_ERROR - {@link module:connection~Connection#event:CONNECTION_ERROR CONNECTION_ERROR}
 */
export type JanodeCoreEvents = {
  readonly CONNECTION_CLOSED: 'connection_closed',
  readonly SESSION_DESTROYED: 'session_destroyed',
  readonly HANDLE_DETACHED: 'handle_detached',
  readonly HANDLE_ICE_FAILED: 'handle_ice_failed',
  readonly HANDLE_HANGUP: 'handle_hangup',
  readonly HANDLE_MEDIA: 'handle_media',
  readonly HANDLE_WEBRTCUP: 'handle_webrtcup',
  readonly HANDLE_SLOWLINK: 'handle_slowlink',
  readonly HANDLE_TRICKLE: 'handle_trickle',
  readonly CONNECTION_ERROR: 'connection_error',
}

/**
 * Janode protocol constants
 *
 * @private
 */
export const JANODE: { EVENT: JanodeCoreEvents } = {
  /**
   * Janode core events.
   *
   * @type {JanodeCoreEvents}
   */
  EVENT: {
    CONNECTION_CLOSED: 'connection_closed',
    SESSION_DESTROYED: 'session_destroyed',
    HANDLE_DETACHED: 'handle_detached',
    HANDLE_ICE_FAILED: 'handle_ice_failed',
    HANDLE_HANGUP: 'handle_hangup',
    HANDLE_MEDIA: 'handle_media',
    HANDLE_WEBRTCUP: 'handle_webrtcup',
    HANDLE_SLOWLINK: 'handle_slowlink',
    HANDLE_TRICKLE: 'handle_trickle',
    CONNECTION_ERROR: 'connection_error',
  },
};

/**
 * Check if a message from Janus is a definitive response.
 *
 * @private
 * @param data - The data from Janus
 * @returns True if the check succeeds
 */
// TODO: add data type
export const isResponseData = (data: JanodeRequest): boolean => {
  if (typeof data === 'object' && data) {
    return Object.values(JANUS.RESPONSE).includes(data.janus);
  }
  return false;
};

/**
 * Check if a message from Janus is an event.
 *
 * @private
 * @param data - The data from Janus
 * @returns True if the check succeeds
 */
// TODO: add data type
export const isEventData = (data: JanodeRequest): boolean => {
  if (typeof data === 'object' && data) {
    return data.janus === JANUS.EVENT.EVENT;
  }
  return false;
};

/**
 * Check if a message from Janus is an error.
 *
 * @private
 * @param data - The data from Janus
 * @returns True if the check succeeds
 */
// TODO: add data type
export const isErrorData = (data: JanodeRequest): boolean => {
  if (typeof data === 'object' && data) {
    return data.janus === JANUS.RESPONSE.ERROR;
  }
  return false;
};

/**
 * Check if a message from Janus is a timeout notification.
 *
 * @private
 * @param data - The data from Janus
 * @returns True if the check succeeds
 */
// TODO: add data type
export const isTimeoutData = (data: JanodeRequest): boolean => {
  if (typeof data === 'object' && data) {
    return data.janus === JANUS.EVENT.TIMEOUT;
  }
  return false;
};

/**
 * Check if a message from Janus is an ack.
 *
 * @private
 * @param data - The data from Janus
 * @returns True if the check succeeds
 */
// TODO: add data type
export const isAckData = (data: JanodeRequest): boolean => {
  if (typeof data === 'object' && data) {
    return data.janus === JANUS.ACK;
  }
  return false;
};