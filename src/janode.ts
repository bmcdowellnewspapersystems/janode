/**
 * This module is the entry point of the Janode library.<br>
 *
 * Users start by importing the library and using the functions and properties exported by this module.
 * @module janode
 */

import Logger from './utils/logger.ts';
const LOG_NS = '[janode.ts]';
import Configuration from './configuration.ts';
import Connection from './connection.ts';
import { JANODE as JANODE_PROTO } from './protocol.ts';
const { EVENT } = JANODE_PROTO;

import Session from './session.ts';
import Handle from './handle.ts';
import type { JanodeCoreEvents } from './protocol.ts';
import type { ClientOptions } from 'ws';

/**
 * An object describing a janus server (e.g. url, secret).
 *
 * @property url - The URL to reach this server API
 * @property apisecret - The API secret for this server
 * @property [token] - The optional Janus API token
 */
export type ServerObjectConf = {
  url: string,
  apisecret: string,
  token?: string
}

/**
 * The configuration passed by the user.
 *
 * @property [server_key] - The key used to refer to this server in Janode.connect
 * @property address - The server to connect to
 * @property [retry_time_secs=10] - The seconds between any connection attempts
 * @property [max_retries=5] - The maximum number of retries before issuing a connection error
 * @property [is_admin=false] - True if the connection is dedicated to the Janus Admin API
 * @property [ws_options] - Specific WebSocket transport options
 */
export type RawConfiguration = {
  server_key?: string,
  address: ServerObjectConf[] | ServerObjectConf,
  retry_time_secs?: number,
  max_retries?: number,
  is_admin?: boolean,
  ws_options?: ClientOptions
}

/**
 * @private
 */
interface Constructor<T> {
  new(session: Session, id: number): T
}

/**
 * The plugin descriptor used when attaching a plugin from a session.
 *
 * @property id - The plugin id used when sending the attach request to Janus
 * @property [Handle] - The class implementing the handle
 * @property [EVENT] - The object containing the events emitted by the plugin
 */
export type PluginDescriptor<T extends Handle = Handle> = {
  id: string,
  Handle?: Constructor<T>,
  event?: JanodeCoreEvents
}

/**
 * Connect using a defined configuration.<br>
 *
 * The input configuration can be an object or an array. In case it is an array and the param "key" is provided,
 * Janode will pick a server configuration according to "key" type. If it is a number it will pick the index "key" of the array.
 * If it is a string it will pick the server configuration that matches the "server_key" property.
 * In case "key" is missing, Janode will fallback to index 0.
 *
 * @param config - The configuration to be used
 * @param [key=0] - The index of the config in the array to use, or the server of the arrray matching this server key
 * @returns The promise resolving with the Janode connection
 *
 * @example
 *
 * // simple example with single object and no key
 * const connection = await Janode.connect({
 *   address: {
 *	   url: 'ws://127.0.0.1:8188/',
 *	   apisecret: 'secret'
 *	 },
 * });
 *
 * // example with an array and a key 'server_2'
 * // connection is established with ws://127.0.0.1:8002
 * const connection = await Janode.connect([{
 *   server_key: 'server_1',
 *   address: {
 *	   url: 'ws://127.0.0.1:8001/',
 *	   apisecret: 'secret'
 *	 },
 * },
 * {
 *   server_key: 'server_2',
 *   address: {
 *	   url: 'ws://127.0.0.1:8002/',
 *	   apisecret: 'secondsecret'
 *	 },
 * }], 'server_2');
 *
 * // example with an array and a key 'server_B' with multiple addresses
 * // connection is attempted starting with ws://127.0.0.1:8003
 * const connection = await Janode.connect([{
 *   server_key: 'server_A',
 *   address: {
 *	   url: 'ws://127.0.0.1:8001/',
 *	   apisecret: 'secret'
 *	 },
 * },
 * {
 *   server_key: 'server_B',
 *   address: [{
 *	   url: 'ws://127.0.0.1:8003/',
 *	   apisecret: 'secondsecret'
 *	 },
 *   {
 *     url: 'ws://127.0.0.2:9003/',
 *	   apisecret: 'thirdsecret'
 *   }],
 * }], 'server_B');
 */
const connect = (config: RawConfiguration | RawConfiguration[], key?: number | string): Promise<Connection> => {
  Logger.info(`${LOG_NS} creating new connection`);
  const janus_server_list = Array.isArray(config) ? config : [config];
  let index = 0;
  if (typeof key === 'number')
    index = key;
  if (typeof key === 'string')
    index = janus_server_list.findIndex(({ server_key }) => server_key === key);
  if (!key)
    Logger.verbose(`${LOG_NS} omitted server key, falling back to the first server in configuration`);

  const server_raw_conf = janus_server_list[index];
  if (!server_raw_conf) {
    const error = new Error(`server configuration not defined for server #${key || index}`);
    Logger.error(`${LOG_NS} ${error.message}`);
    throw error;
  }

  const server_conf = new Configuration(server_raw_conf);
  Logger.verbose(`${LOG_NS} creating connection with server configuration ${JSON.stringify(server_conf)}`);
  const janus_connection = new Connection(server_conf);
  return janus_connection.open();
};

export default {
  connect,
  /**
   * The Logger used in Janode.
   *
   * @type
   */
  Logger: Logger,

  /**
   * Events emitted by Janode
   *
   * @type
   */
  EVENT: EVENT,
};
