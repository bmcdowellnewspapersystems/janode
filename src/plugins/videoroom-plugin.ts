/**
 * This module contains the implementation of the VideoRoom plugin (ref. {@link https://janus.conf.meetecho.com/docs/videoroom.html}).
 * @module videoroom-plugin
 */

import Handle from '../handle.ts';
import Session from '../session.ts';

import type { JanodeEvent, JanusMessage } from '../handle.ts'

/* The plugin ID exported in the plugin descriptor */
const PLUGIN_ID = 'janus.plugin.videoroom';

/* These are the requests defined for the Janus VideoRoom API */
const REQUEST_JOIN = 'join';
const REQUEST_CONFIGURE = 'configure';
const REQUEST_JOIN_CONFIGURE = 'joinandconfigure';
const REQUEST_LIST_PARTICIPANTS = 'listparticipants';
const REQUEST_ENABLE_RECORDING = 'enable_recording';
const REQUEST_KICK = 'kick';
const REQUEST_START = 'start';
const REQUEST_PAUSE = 'pause';
const REQUEST_SWITCH = 'switch';
const REQUEST_PUBLISH = 'publish';
const REQUEST_UNPUBLISH = 'unpublish';
const REQUEST_LEAVE = 'leave';
const REQUEST_UPDATE = 'update';

const REQUEST_EXISTS = 'exists';
const REQUEST_LIST_ROOMS = 'list';
const REQUEST_CREATE = 'create';
const REQUEST_DESTROY = 'destroy';
const REQUEST_ALLOW = 'allowed';

const REQUEST_RTP_FWD_START = 'rtp_forward';
const REQUEST_RTP_FWD_STOP = 'stop_rtp_forward';
const REQUEST_RTP_FWD_LIST = 'listforwarders';

const PTYPE_PUBLISHER = 'publisher';
const PTYPE_LISTENER = 'subscriber';

type VideoRoomPluginEvents = {
  readonly PUB_JOINED: 'videoroom_joined',
  readonly SUB_JOINED: 'videoroom_subscribed',
  readonly PUB_LIST: 'videoroom_publisher_list',
  readonly PARTICIPANTS_LIST: 'videoroom_participants_list',
  readonly PUB_PEER_JOINED: 'videoroom_publisher_joined',
  readonly STARTED: 'videoroom_started',
  readonly PAUSED: 'videoroom_paused',
  readonly SWITCHED: 'videoroom_switched',
  readonly CONFIGURED: 'videoroom_configured',
  readonly SLOW_LINK: 'videoroom_slowlink',
  readonly DISPLAY: 'videoroom_display',
  readonly UNPUBLISHED: 'videoroom_unpublished',
  readonly LEAVING: 'videoroom_leaving',
  readonly UPDATED: 'videoroom_updated',
  readonly KICKED: 'videoroom_kicked',
  readonly RECORDING_ENABLED_STATE: 'videoroom_recording_enabled_state',
  readonly TALKING: 'videoroom_talking',
  readonly SC_SUBSTREAM_LAYER: 'videoroom_sc_substream_layer',
  readonly SC_TEMPORAL_LAYERS: 'videoroom_sc_temporal_layers',
  readonly ALLOWED: 'videoroom_allowed',
  readonly EXISTS: 'videoroom_exists',
  readonly ROOMS_LIST: 'videoroom_list',
  readonly CREATED: 'videoroom_created',
  readonly DESTROYED: 'videoroom_destroyed',
  readonly RTP_FWD_STARTED: 'videoroom_rtp_fwd_started',
  readonly RTP_FWD_STOPPED: 'videoroom_rtp_fwd_stopped',
  readonly RTP_FWD_LIST: 'videoroom_rtp_fwd_list',
  readonly SUCCESS: 'videoroom_success',
  readonly ERROR: 'videoroom_error',
}

/* These are the events/responses that the Janode plugin will manage */
/* Some of them will be exported in the plugin descriptor */
const PLUGIN_EVENT: VideoRoomPluginEvents = {
  PUB_JOINED: 'videoroom_joined',
  SUB_JOINED: 'videoroom_subscribed',
  PUB_LIST: 'videoroom_publisher_list',
  PARTICIPANTS_LIST: 'videoroom_participants_list',
  PUB_PEER_JOINED: 'videoroom_publisher_joined',
  STARTED: 'videoroom_started',
  PAUSED: 'videoroom_paused',
  SWITCHED: 'videoroom_switched',
  CONFIGURED: 'videoroom_configured',
  SLOW_LINK: 'videoroom_slowlink',
  DISPLAY: 'videoroom_display',
  UNPUBLISHED: 'videoroom_unpublished',
  LEAVING: 'videoroom_leaving',
  UPDATED: 'videoroom_updated',
  KICKED: 'videoroom_kicked',
  RECORDING_ENABLED_STATE: 'videoroom_recording_enabled_state',
  TALKING: 'videoroom_talking',
  SC_SUBSTREAM_LAYER: 'videoroom_sc_substream_layer',
  SC_TEMPORAL_LAYERS: 'videoroom_sc_temporal_layers',
  ALLOWED: 'videoroom_allowed',
  EXISTS: 'videoroom_exists',
  ROOMS_LIST: 'videoroom_list',
  CREATED: 'videoroom_created',
  DESTROYED: 'videoroom_destroyed',
  RTP_FWD_STARTED: 'videoroom_rtp_fwd_started',
  RTP_FWD_STOPPED: 'videoroom_rtp_fwd_stopped',
  RTP_FWD_LIST: 'videoroom_rtp_fwd_list',
  SUCCESS: 'videoroom_success',
  ERROR: 'videoroom_error',
};

interface JSEP extends RTCSessionDescriptionInit {
  e2ee?: boolean;
};

/**
 * The class implementing the VideoRoom plugin (ref. {@link https://janus.conf.meetecho.com/docs/videoroom.html}).<br>
 *
 * It extends the base Janode Handle class and overrides the "handleMessage" method.<br>
 *
 * Moreover it defines many methods to support VideoRoom operations.<br>
 *
 * @hideconstructor
 * @extends Handle
 */
export class VideoRoomHandle extends Handle {
  feed: number | string | null;
  streams: null;
  room: number | string | null;
  /**
   * Create a Janode VideoRoom handle.
   *
   * @param session - A reference to the parent session
   * @param id - The handle identifier
   */
  constructor(session: Session, id: number) {
    super(session, id);

    /**
     * Either the feed identifier assigned to this publisher handle or the publisher's feed in case this handle is a subscriber.
     */
    this.feed = null;

    /**
     * [multistream]
     * Either the streams assigned to this publisher handle or the streams subscribed to in case this handle is a subscriber.
     */
    this.streams = null;

    /**
     * The identifier of the videoroom the handle has joined.
     */
    this.room = null;
  }

  /**
   * The custom "handleMessage" needed for handling VideoRoom messages.
   *
   * @private
   * @param janus_message
   * @returns A falsy value for unhandled events, a truthy value for handled events
   */
  handleMessage(janus_message: JanusMessage): JanodeEvent {
    const { plugindata, transaction } = janus_message;
    if (plugindata && plugindata.data && plugindata.data.videoroom) {
      /**
       * @type {VideoRoomData}
       */
      const message_data: any = plugindata.data;
      const { videoroom, error, error_code, room } = message_data;

      /* Prepare an object for the output Janode event */
      const janode_event = this._newPluginEvent(janus_message);

      /* Add room information if available */
      if (room) janode_event.data.room = room;

      /* The plugin will emit an event only if the handle does not own the transaction */
      /* That means that a transaction has already been closed or this is an async event */
      const emit = (this.ownsTransaction(transaction) === false);

      switch (videoroom) {

        /* Success response */
        case 'success':
          /* Room exists API */
          if (typeof message_data.exists !== 'undefined') {
            janode_event.data.exists = message_data.exists;
            janode_event.event = PLUGIN_EVENT.EXISTS;
            break;
          }
          /* Room list API */
          if (typeof message_data.list !== 'undefined') {
            janode_event.data.list = message_data.list;
            janode_event.event = PLUGIN_EVENT.ROOMS_LIST;
            break;
          }
          /* Tokens management (add/remove/enable) */
          if (typeof message_data.allowed !== 'undefined') {
            janode_event.data.list = message_data.allowed;
            janode_event.event = PLUGIN_EVENT.ALLOWED;
            break;
          }
          /* Global recording enabled or disabled */
          if (typeof message_data.record !== 'undefined') {
            janode_event.data.record = message_data.record;
            janode_event.event = PLUGIN_EVENT.RECORDING_ENABLED_STATE;
            break;
          }

          /* Generic success event */
          janode_event.event = PLUGIN_EVENT.SUCCESS;
          break;

        /* Publisher joined */
        case 'joined':
          /* Store room and feed id */
          this.room = room;
          this.feed = message_data.id;

          janode_event.data.feed = message_data.id;
          janode_event.data.description = message_data.description;
          janode_event.data.private_id = message_data.private_id; // TODO: any
          janode_event.data.publishers = message_data.publishers.map(({ id, display, talking, audio_codec, video_codec, simulcast, streams }: any) => {
            const pub: { [index: string]: unknown } = {
              feed: id,
              display,
            };
            if (typeof talking !== 'undefined') pub.talking = talking;
            if (typeof audio_codec !== 'undefined') pub.audiocodec = audio_codec;
            if (typeof video_codec !== 'undefined') pub.videocodec = video_codec;
            if (typeof simulcast !== 'undefined') pub.simulcast = simulcast;
            /* [multistream] add streams info for this participant */
            if (typeof streams !== 'undefined') pub.streams = streams;
            return pub;
          });
          janode_event.event = PLUGIN_EVENT.PUB_JOINED;
          break;

        /* Subscriber joined */
        case 'attached':
          /* Store room and feed id */
          this.room = room;
          if (typeof message_data.id !== 'undefined') {
            this.feed = message_data.id;
            janode_event.data.feed = message_data.id;
            janode_event.data.display = message_data.display;
          }

          /* [multistream] add streams info to the subscriber joined event */
          if (typeof message_data.streams !== 'undefined') {
            this.streams = message_data.streams;
            janode_event.data.streams = message_data.streams;
          }

          janode_event.event = PLUGIN_EVENT.SUB_JOINED;
          break;

        /* Slow-link event */
        case 'slow_link':
          if (this.feed) janode_event.data.feed = this.feed;
          janode_event.data.bitrate = message_data['current-bitrate'];
          janode_event.event = PLUGIN_EVENT.SLOW_LINK;
          break;

        /* Participants list */
        case 'participants':
          janode_event.data.participants = message_data.participants.map(({ id, display, publisher, talking }: any) => {
            const peer: { [index: string]: unknown } = {
              feed: id,
              display,
              publisher,
            };
            if (typeof talking !== 'undefined') peer.talking = talking;
            return peer;
          });
          janode_event.event = PLUGIN_EVENT.PARTICIPANTS_LIST;
          break;

        /* Room created */
        case 'created':
          janode_event.event = PLUGIN_EVENT.CREATED;
          janode_event.data.permanent = message_data.permanent;
          break;

        /* Room destroyed */
        case 'destroyed':
          janode_event.event = PLUGIN_EVENT.DESTROYED;
          break;

        /* RTP forwarding started */
        case 'rtp_forward':
          janode_event.data.feed = message_data.publisher_id;
          if (message_data.rtp_stream) {
            const f = message_data.rtp_stream;
            const fwd: { [index: string]: unknown } = {
              host: f.host,
            };
            if (f.audio_stream_id) {
              fwd.audio_stream = f.audio_stream_id;
              fwd.audio_port = f.audio;
              if (typeof f.audio_rtcp === 'number') {
                fwd.audio_rtcp_port = f.audio_rtcp;
              }
            }
            if (f.video_stream_id) {
              fwd.video_stream = f.video_stream_id;
              fwd.video_port = f.video;
              if (typeof f.video_rtcp === 'number') {
                fwd.video_rtcp_port = f.video_rtcp;
              }
              if (f.video_stream_id_2) {
                fwd.video_stream_2 = f.video_stream_id_2;
                fwd.video_port_2 = f.video_2;
              }
              if (f.video_stream_id_3) {
                fwd.video_stream_3 = f.video_stream_id_3;
                fwd.video_port_3 = f.video_3;
              }
            }
            if (f.data_stream_id) {
              fwd.data_stream = f.data_stream_id;
              fwd.data_port = f.data;
            }

            janode_event.data.forwarder = fwd;
          }
          /* [multistream] */
          else if (message_data.forwarders) {
            janode_event.data.forwarders = message_data.forwarders.map((f: any) => {
              const fwd: { [index: string]: unknown } = {
                host: f.host,
              };
              if (f.type === 'audio') {
                fwd.audio_stream = f.stream_id;
                fwd.audio_port = f.port;
                if (typeof f.remote_rtcp_port === 'number') {
                  fwd.audio_rtcp_port = f.remote_rtcp_port;
                }
              }
              if (f.type === 'video') {
                fwd.video_stream = f.stream_id;
                fwd.video_port = f.port;
                if (typeof f.remote_rtcp_port === 'number') {
                  fwd.video_rtcp_port = f.remote_rtcp_port;
                }
                if (typeof f.substream === 'number') {
                  fwd.sc_substream_layer = f.substream;
                }
              }
              if (f.type === 'data') {
                fwd.data_stream = f.stream_id;
                fwd.data_port = f.port;
              }
              if (typeof f.ssrc === 'number') {
                fwd.ssrc = f.ssrc;
              }
              if (typeof f.pt === 'number') {
                fwd.pt = f.pt;
              }
              if (typeof f.srtp === 'boolean') {
                fwd.srtp = f.srtp;
              }

              return fwd;
            });
          }

          janode_event.event = PLUGIN_EVENT.RTP_FWD_STARTED;
          break;

        /* RTP forwarding stopped */
        case 'stop_rtp_forward':
          janode_event.data.feed = message_data.publisher_id;
          janode_event.data.stream = message_data.stream_id;
          janode_event.event = PLUGIN_EVENT.RTP_FWD_STOPPED;
          break;

        /* RTP forwarders list */
        case 'forwarders':
          if (message_data.rtp_forwarders) {
            janode_event.data.forwarders = message_data.rtp_forwarders.map(({ publisher_id, rtp_forwarder }: any) => {
              const pub: { [index: string]: unknown } = {
                feed: publisher_id,
              };

              pub.forwarders = rtp_forwarder.map((f: any) => {
                const fwd: { [index: string]: unknown } = {
                  host: f.ip,
                };
                if (f.audio_stream_id) {
                  fwd.audio_stream = f.audio_stream_id;
                  fwd.audio_port = f.port;
                  if (typeof f.remote_rtcp_port === 'number') {
                    fwd.audio_rtcp_port = f.remote_rtcp_port;
                  }
                }
                if (f.video_stream_id) {
                  fwd.video_stream = f.video_stream_id;
                  fwd.video_port = f.port;
                  if (typeof f.remote_rtcp_port === 'number') {
                    fwd.video_rtcp_port = f.remote_rtcp_port;
                  }
                  if (typeof f.substream === 'number') {
                    fwd.sc_substream_layer = f.substream;
                  }
                }
                if (f.data_stream_id) {
                  fwd.data_stream = f.data_stream_id;
                  fwd.data_port = f.port;
                }
                if (typeof f.ssrc === 'number') {
                  fwd.ssrc = f.ssrc;
                }
                if (typeof f.pt === 'number') {
                  fwd.pt = f.pt;
                }
                if (typeof f.srtp === 'boolean') {
                  fwd.srtp = f.srtp;
                }

                return fwd;
              });

              return pub;
            });
          }
          /* [multistream] */
          else if (message_data.publishers) {
            janode_event.data.forwarders = message_data.publishers.map(({ publisher_id, forwarders }: any) => {
              const pub: { [index: string]: unknown } = {
                feed: publisher_id,
              };

              pub.forwarders = forwarders.map((f: any) => {
                const fwd: { [index: string]: unknown } = {
                  host: f.host,
                };
                if (f.type === 'audio') {
                  fwd.audio_stream = f.stream_id;
                  fwd.audio_port = f.port;
                  if (typeof f.remote_rtcp_port === 'number') {
                    fwd.audio_rtcp_port = f.remote_rtcp_port;
                  }
                }
                if (f.type === 'video') {
                  fwd.video_stream = f.stream_id;
                  fwd.video_port = f.port;
                  if (typeof f.remote_rtcp_port === 'number') {
                    fwd.video_rtcp_port = f.remote_rtcp_port;
                  }
                  if (typeof f.substream === 'number') {
                    fwd.sc_substream_layer = f.substream;
                  }
                }
                if (f.type === 'data') {
                  fwd.data_stream = f.stream_id;
                  fwd.data_port = f.port;
                }
                if (typeof f.ssrc === 'number') {
                  fwd.ssrc = f.ssrc;
                }
                if (typeof f.pt === 'number') {
                  fwd.pt = f.pt;
                }
                if (typeof f.srtp === 'boolean') {
                  fwd.srtp = f.srtp;
                }
                return fwd;
              });

              return pub;
            });
          }

          janode_event.event = PLUGIN_EVENT.RTP_FWD_LIST;
          break;

        /* Talking events */
        case 'talking':
        case 'stopped-talking':
          janode_event.data.feed = message_data.id;
          janode_event.data.talking = (videoroom === 'talking');
          /* [multistream] */
          if (typeof message_data.mid !== 'undefined') janode_event.data.mid = message_data.mid;
          janode_event.data.audio_level = message_data['audio-level-dBov-avg'];
          janode_event.event = PLUGIN_EVENT.TALKING;
          break;

        /* [multistream] updated event */
        case 'updated':
          janode_event.data.streams = message_data.streams;
          janode_event.event = PLUGIN_EVENT.UPDATED;
          break;

        /* [multistream] updating event, sent when janus receives another "update" before getting a JSEP answer for the previous one */
        case 'updating':
          janode_event.data.streams = message_data.streams;
          janode_event.event = PLUGIN_EVENT.UPDATED;
          break;

        /* Generic events (error, notifications ...) */
        case 'event':
          /* VideoRoom Error */
          if (error) {
            janode_event.event = PLUGIN_EVENT.ERROR;
            janode_event.data = new Error(`${error_code} ${error}`);
            janode_event.data._code = error_code;
            /* In case of error, close a transaction */
            this.closeTransactionWithError(transaction, janode_event.data);
            break;
          }
          /* Participant joined notification (notify_joining) */
          if (message_data.joining) {
            janode_event.event = PLUGIN_EVENT.PUB_PEER_JOINED;
            janode_event.data.feed = message_data.joining.id;
            if (message_data.joining.display) janode_event.data.display = message_data.joining.display;
            break;
          }
          /* Publisher list notification */
          if (message_data.publishers) {
            janode_event.event = PLUGIN_EVENT.PUB_LIST;
            janode_event.data.publishers = message_data.publishers.map(({ id, display, talking, audio_codec, video_codec, simulcast, streams }: any) => {
              const pub: { [index: string]: unknown } = {
                feed: id,
                display,
              };
              if (typeof talking !== 'undefined') pub.talking = talking;
              if (typeof audio_codec !== 'undefined') pub.audiocodec = audio_codec;
              if (typeof video_codec !== 'undefined') pub.videocodec = video_codec;
              if (typeof simulcast !== 'undefined') pub.simulcast = simulcast;
              /* [multistream] add streams info for this participant */
              if (typeof streams !== 'undefined') pub.streams = streams;
              return pub;
            });
            break;
          }
          /* Configuration events (publishing, general configuration) */
          if (typeof message_data.configured !== 'undefined') {
            janode_event.event = PLUGIN_EVENT.CONFIGURED;
            if (this.feed) janode_event.data.feed = this.feed;
            /* [multistream] add streams info */
            if (typeof message_data.streams !== 'undefined') janode_event.data.streams = message_data.streams;
            janode_event.data.configured = message_data.configured;
            break;
          }
          /* Subscribed feed started */
          if (typeof message_data.started !== 'undefined') {
            janode_event.event = PLUGIN_EVENT.STARTED;
            if (this.feed) janode_event.data.feed = this.feed;
            janode_event.data.started = message_data.started;
            break;
          }
          /* Subscribed feed paused */
          if (typeof message_data.paused !== 'undefined') {
            janode_event.event = PLUGIN_EVENT.PAUSED;
            if (this.feed) janode_event.data.feed = this.feed;
            janode_event.data.paused = message_data.paused;
            break;
          }
          /* Subscribed feed switched */
          if (typeof message_data.switched !== 'undefined') {
            janode_event.event = PLUGIN_EVENT.SWITCHED;
            janode_event.data.switched = message_data.switched;
            if (message_data.switched === 'ok') {
              if (typeof message_data.id !== 'undefined') {
                janode_event.data.from_feed = this.feed;
                this.feed = message_data.id;
                janode_event.data.to_feed = this.feed;
                janode_event.data.display = message_data.display;
              }
              if (typeof message_data.streams != 'undefined') {
                this.streams = message_data.streams;
                janode_event.data.streams = message_data.streams;
              }
            }
            break;
          }
          /* Unpublished own or other feed */
          if (typeof message_data.unpublished !== 'undefined') {
            janode_event.event = PLUGIN_EVENT.UNPUBLISHED;
            janode_event.data.feed = (message_data.unpublished === 'ok') ? this.feed : message_data.unpublished;
            if (message_data.display) janode_event.data.display = message_data.display;
            break;
          }
          /* Leaving confirmation */
          if (typeof message_data.leaving !== 'undefined') {
            janode_event.event = PLUGIN_EVENT.LEAVING;
            janode_event.data.feed = (message_data.leaving === 'ok') ? this.feed : message_data.leaving;
            if (message_data.reason) janode_event.data.reason = message_data.reason;
            if (message_data.display) janode_event.data.display = message_data.display;
            break;
          }
          /* Display name changed event */
          if (typeof message_data.display !== 'undefined' && typeof message_data.switched === 'undefined') {
            janode_event.event = PLUGIN_EVENT.DISPLAY;
            janode_event.data.feed = message_data.id;
            janode_event.data.display = message_data.display;
            break;
          }
          /* Participant kicked out */
          if (typeof message_data.kicked !== 'undefined') {
            janode_event.event = PLUGIN_EVENT.KICKED;
            janode_event.data.feed = message_data.kicked;
            break;
          }
          /* Participant left (for subscribers "leave") */
          if (typeof message_data.left !== 'undefined') {
            janode_event.event = PLUGIN_EVENT.LEAVING;
            if (this.feed) janode_event.data.feed = this.feed;
            break;
          }
          /* Simulcast substream layer switch */
          if (typeof message_data.substream !== 'undefined') {
            janode_event.event = PLUGIN_EVENT.SC_SUBSTREAM_LAYER;
            if (this.feed) janode_event.data.feed = this.feed;
            /* [multistream] */
            if (typeof message_data.mid !== 'undefined') janode_event.data.mid = message_data.mid;
            janode_event.data.sc_substream_layer = message_data.substream;
            break;
          }
          /* Simulcast temporal layers switch */
          if (typeof message_data.temporal !== 'undefined') {
            janode_event.event = PLUGIN_EVENT.SC_TEMPORAL_LAYERS;
            if (this.feed) janode_event.data.feed = this.feed;
            /* [multistream] */
            if (typeof message_data.mid !== 'undefined') janode_event.data.mid = message_data.mid;
            janode_event.data.sc_temporal_layers = message_data.temporal;
            break;
          }
      }

      /* The event has been handled */
      if (janode_event.event) {
        /* Try to close the transaction */
        this.closeTransactionWithSuccess(transaction, janus_message);
        /* If the transaction was not owned, emit the event */
        if (emit) this.emit(janode_event.event, janode_event.data);
        return janode_event;
      }
    }

    /* The event has not been handled, return a falsy value */
    return null;
  }

  /*----------*/
  /* USER API */
  /*----------*/

  /* These are the APIs that users need to work with the videoroom plugin */

  /**
   * Join a videoroom as publisher.
   *
   * @param params
   * @param params.room - The room to join to
   * @param [params.feed] - The feed identifier to use, if missing it is picked by Janus
   * @param [params.audio] - True to request audio relaying
   * @param [params.video] - True to request video relaying
   * @param [params.data] - True to request datachannel relaying
   * @param [params.display] - The display name to use
   * @param [params.bitrate] - Bitrate cap
   * @param [params.token] - The optional token needed to join the room
   * @param [params.pin] - The optional pin needed to join the room
   * @param [params.record] - Enable the recording
   * @param [params.filename] - If recording, the base path/file to use for the recording
   * @param [params.descriptions] - [multistream] The descriptions object, can define a description for the tracks separately e.g. track mid:0 'Video Camera', track mid:1 'Screen'
   */
  async joinPublisher({ room, feed, audio, video, data, bitrate, record, filename, display, token, pin, descriptions }: { room: number | string; feed?: number | string; audio?: boolean; video?: boolean; data?: boolean; display?: string; bitrate?: number; token?: string; pin?: string; record?: boolean; filename?: string; descriptions?: object[]; }): Promise<VIDEOROOM_EVENT_PUB_JOINED> {
    const body: { [index: string]: unknown } = {
      request: REQUEST_JOIN,
      ptype: PTYPE_PUBLISHER,
      room,
    };
    if (typeof feed === 'string' || typeof feed === 'number') body.id = feed;
    if (typeof display === 'string') body.display = display;
    if (typeof audio === 'boolean') body.audio = audio;
    if (typeof video === 'boolean') body.video = video;
    if (typeof data === 'boolean') body.data = data;
    if (typeof bitrate === 'number') body.bitrate = bitrate;
    if (typeof record === 'boolean') body.record = record;
    if (typeof filename === 'string') body.filename = filename;
    if (typeof token === 'string') body.token = token;
    if (typeof pin === 'string') body.pin = pin;

    /* [multistream] */
    if (descriptions && Array.isArray(descriptions)) body.descriptions = descriptions;

    const response = await this.message(body);
    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.PUB_JOINED) {
      if (body.display) evtdata.display = body.display;
      return evtdata as VIDEOROOM_EVENT_PUB_JOINED;
    }
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /**
   * Join and configure videoroom handle as publisher.
   *
   * @param params
   * @param params.room - The room to join to
   * @param [params.feed] - The feed identifier to use, if missing it is picked by Janus
   * @param [params.audio] - True to request audio relaying
   * @param [params.video] - True to request video relaying
   * @param [params.data] - True to request datachannel relaying
   * @param [params.display] - The display name to use
   * @param [params.bitrate] - Bitrate cap
   * @param [params.token] - The optional token needed to join the room
   * @param [params.pin] - The optional pin needed to join the room
   * @param [params.record] - Enable the recording
   * @param [params.filename] - If recording, the base path/file to use for the recording
   * @param [params.e2ee] - True to notify end-to-end encryption for this connection
   * @param [params.descriptions] - [multistream] The descriptions object, can define a description for the tracks separately e.g. track mid:0 'Video Camera', track mid:1 'Screen'
   * @param [params.jsep] - The JSEP offer
   */
  async joinConfigurePublisher({ room, feed, audio, video, data, bitrate, record, filename, display, token, pin, e2ee, descriptions, jsep }: { room: number | string; feed?: number | string; audio?: boolean; video?: boolean; data?: boolean; display?: string; bitrate?: number; token?: string; pin?: string; record?: boolean; filename?: string; e2ee?: boolean; descriptions?: object[]; jsep?: JSEP; }): Promise<VIDEOROOM_EVENT_PUB_JOINED> {
    const body: { [index: string]: unknown } = {
      request: REQUEST_JOIN_CONFIGURE,
      ptype: PTYPE_PUBLISHER,
      room,
    };
    if (typeof feed === 'string' || typeof feed === 'number') body.id = feed;
    if (typeof display === 'string') body.display = display;
    if (typeof audio === 'boolean') body.audio = audio;
    if (typeof video === 'boolean') body.video = video;
    if (typeof data === 'boolean') body.data = data;
    if (typeof bitrate === 'number') body.bitrate = bitrate;
    if (typeof record === 'boolean') body.record = record;
    if (typeof filename === 'string') body.filename = filename;
    if (typeof token === 'string') body.token = token;
    if (typeof pin === 'string') body.pin = pin;
    if (typeof e2ee === 'boolean' && jsep) jsep.e2ee = e2ee;

    /* [multistream] */
    if (descriptions && Array.isArray(descriptions)) body.descriptions = descriptions;

    const response = await this.message(body, jsep).catch(e => {
      /* Cleanup the WebRTC status in Janus in case of errors when publishing */
      /*
       *
       * JANUS_VIDEOROOM_ERROR_NO_SUCH_FEED       428
       * JANUS_VIDEOROOM_ERROR_MISSING_ELEMENT    429
       * JANUS_VIDEOROOM_ERROR_INVALID_ELEMENT    430
       * JANUS_VIDEOROOM_ERROR_INVALID_SDP_TYPE   431
       * JANUS_VIDEOROOM_ERROR_PUBLISHERS_FULL    432
       * JANUS_VIDEOROOM_ERROR_UNAUTHORIZED       433
       * JANUS_VIDEOROOM_ERROR_ALREADY_PUBLISHED  434
       * JANUS_VIDEOROOM_ERROR_NOT_PUBLISHED      435
       * JANUS_VIDEOROOM_ERROR_ID_EXISTS          436
       * JANUS_VIDEOROOM_ERROR_INVALID_SDP        437
       *
       */
      if (jsep && e._code && e._code >= 429 && e._code <= 437 && e._code != 434)
        this.hangup().catch(() => { });
      throw e;
    });

    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.PUB_JOINED) {
      if (body.display) evtdata.display = body.display;
      return evtdata as VIDEOROOM_EVENT_PUB_JOINED;
    }
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /**
   * Configure a publisher or subscriber handle.<br>
   * Room is detected from the context since a handle must have joined before.<br>
   * Can also be used by publishers to publish a feed.<br>
   *
   * Use this API also to trigger ICE restarts. Publishers can omit the
   * restart/update flags, while subscribers need to use them to force
   * the operation.
   *
   * @param params
   * @param [params.audio] - True to request audio relaying
   * @param [params.video] - True to request video relaying
   * @param [params.data] - True to request datachannel relaying
   * @param [params.display] - The display name to use (publishers only)
   * @param [params.bitrate] - Bitrate cap (publishers only)
   * @param [params.record] - True to record the feed (publishers only)
   * @param [params.filename] - If recording, the base path/file to use for the recording (publishers only)
   * @param [params.restart] - Set to force a ICE restart
   * @param [params.update] - Set to force a renegotiation
   * @param [params.streams] - [multistream] The streams object, each stream includes mid, keyframe, send, min_delay, max_delay
   * @param [params.descriptions] - [multistream] The descriptions object, can define a description for the tracks separately e.g. track mid:0 'Video Camera', track mid:1 'Screen'
   * @param [params.sc_substream_layer] - Substream layer to receive (0-2), in case simulcasting is enabled (subscribers only)
   * @param [params.sc_substream_fallback_ms] - How much time in ms without receiving packets will make janus drop to the substream below (subscribers only)
   * @param [params.sc_temporal_layers] - Temporal layers to receive (0-2), in case VP8 simulcasting is enabled (subscribers only)
   * @param [params.e2ee] - True to notify end-to-end encryption for this connection
   * @param [params.jsep] - The JSEP offer (publishers only)
   * @param [params.keyframe] - True to request a keyframe (publishers only)
   */
  async configure({ audio, video, data, bitrate, record, filename, display, restart, update, streams, descriptions, sc_substream_layer, sc_substream_fallback_ms, sc_temporal_layers, e2ee, jsep, keyframe }: { audio?: boolean; video?: boolean; data?: boolean; display?: string; bitrate?: number; record?: boolean; filename?: string; restart?: boolean; update?: boolean; streams?: object[]; descriptions?: object[]; sc_substream_layer?: number; sc_substream_fallback_ms?: number; sc_temporal_layers?: number; e2ee?: boolean; jsep?: JSEP; keyframe?: boolean; }): Promise<VIDEOROOM_EVENT_CONFIGURED> {
    const body: { [index: string]: unknown } = {
      request: REQUEST_CONFIGURE,
    };

    /* [multistream] */
    if (streams && Array.isArray(streams)) {
      body.streams = streams;
    }
    else {
      if (typeof audio === 'boolean') body.audio = audio;
      if (typeof video === 'boolean') body.video = video;
      if (typeof data === 'boolean') body.data = data;
      if (typeof sc_substream_layer === 'number') body.substream = sc_substream_layer;
      if (typeof sc_substream_fallback_ms === 'number') body.fallback = 1000 * sc_substream_fallback_ms;
      if (typeof sc_temporal_layers === 'number') body.temporal = sc_temporal_layers;
    }

    if (typeof bitrate === 'number') body.bitrate = bitrate;
    if (typeof record === 'boolean') body.record = record;
    if (typeof filename === 'string') body.filename = filename;
    if (typeof display === 'string') body.display = display;
    if (typeof restart === 'boolean') body.restart = restart;
    if (typeof update === 'boolean') body.update = update;
    if (typeof e2ee === 'boolean' && jsep) jsep.e2ee = e2ee;
    if (typeof keyframe === 'boolean') body.keyframe = keyframe;

    /* [multistream] */
    if (descriptions && Array.isArray(descriptions)) body.descriptions = descriptions;

    const response = await this.message(body, jsep).catch(e => {
      /* Cleanup the WebRTC status in Janus in case of errors when publishing */
      /*
       *
       * JANUS_VIDEOROOM_ERROR_NO_SUCH_FEED       428
       * JANUS_VIDEOROOM_ERROR_MISSING_ELEMENT    429
       * JANUS_VIDEOROOM_ERROR_INVALID_ELEMENT    430
       * JANUS_VIDEOROOM_ERROR_INVALID_SDP_TYPE   431
       * JANUS_VIDEOROOM_ERROR_PUBLISHERS_FULL    432
       * JANUS_VIDEOROOM_ERROR_UNAUTHORIZED       433
       * JANUS_VIDEOROOM_ERROR_ALREADY_PUBLISHED  434
       * JANUS_VIDEOROOM_ERROR_NOT_PUBLISHED      435
       * JANUS_VIDEOROOM_ERROR_ID_EXISTS          436
       * JANUS_VIDEOROOM_ERROR_INVALID_SDP        437
       *
       */
      if (jsep && e._code && e._code >= 429 && e._code <= 437 && e._code != 434)
        this.hangup().catch(() => { });
      throw e;
    });
    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.CONFIGURED && evtdata.configured === 'ok') {
      if (body.display) evtdata.display = body.display;
      if (typeof body.request === 'boolean') evtdata.restart = body.restart;
      if (typeof body.update === 'boolean') evtdata.update = body.update;
      return evtdata as VIDEOROOM_EVENT_CONFIGURED;
    }
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /**
   * Publish a feed in the room.
   * Room is detected from the context since a handle must have joined before.
   *
   * @param params
   * @param [params.audio] - True to request audio relaying
   * @param [params.video] - True to request video relaying
   * @param [params.data] - True to request datachannel relaying
   * @param [params.display] - The display name to use
   * @param [params.bitrate] - Bitrate cap
   * @param [params.record] - True to record the feed
   * @param [params.filename] - If recording, the base path/file to use for the recording
   * @param [params.descriptions] - [multistream] The descriptions object, for each stream you can define description
   * @param [params.e2ee] - True to notify end-to-end encryption for this connection
   * @param params.jsep - The JSEP offer
   */
  async publish({ audio, video, data, bitrate, record, filename, display, descriptions, e2ee, jsep }: { audio?: boolean; video?: boolean; data?: boolean; display?: string; bitrate?: number; record?: boolean; filename?: string; descriptions?: object[]; e2ee?: boolean; jsep: RTCSessionDescriptionInit; }): Promise<VIDEOROOM_EVENT_CONFIGURED> {
    if (typeof jsep === 'object' && jsep && jsep.type !== 'offer') {
      const error = new Error('jsep must be an offer');
      return Promise.reject(error);
    }
    const body: { [index: string]: unknown } = {
      request: REQUEST_PUBLISH,
    };

    if (typeof audio === 'boolean') body.audio = audio;
    if (typeof video === 'boolean') body.video = video;
    if (typeof data === 'boolean') body.data = data;

    if (typeof bitrate === 'number') body.bitrate = bitrate;
    if (typeof record === 'boolean') body.record = record;
    if (typeof filename === 'string') body.filename = filename;
    if (typeof display === 'string') body.display = display; // @ts-expect-error
    if (typeof e2ee === 'boolean' && jsep) jsep.e2ee = e2ee;

    /* [multistream] */
    if (descriptions && Array.isArray(descriptions)) {
      body.descriptions = descriptions;
    }

    const response = await this.message(body, jsep).catch(e => {
      /* Cleanup the WebRTC status in Janus in case of errors when publishing */
      /*
       *
       * JANUS_VIDEOROOM_ERROR_NO_SUCH_FEED       428
       * JANUS_VIDEOROOM_ERROR_MISSING_ELEMENT    429
       * JANUS_VIDEOROOM_ERROR_INVALID_ELEMENT    430
       * JANUS_VIDEOROOM_ERROR_INVALID_SDP_TYPE   431
       * JANUS_VIDEOROOM_ERROR_PUBLISHERS_FULL    432
       * JANUS_VIDEOROOM_ERROR_UNAUTHORIZED       433
       * JANUS_VIDEOROOM_ERROR_ALREADY_PUBLISHED  434
       * JANUS_VIDEOROOM_ERROR_NOT_PUBLISHED      435
       * JANUS_VIDEOROOM_ERROR_ID_EXISTS          436
       * JANUS_VIDEOROOM_ERROR_INVALID_SDP        437
       *
       */
      if (jsep && e._code && e._code >= 429 && e._code <= 437 && e._code != 434)
        this.hangup().catch(() => { });
      throw e;
    });

    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.CONFIGURED && evtdata.configured === 'ok') {
      if (body.display) evtdata.display = body.display;
      return evtdata as VIDEOROOM_EVENT_CONFIGURED;
    }
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /**
   * Unpublish a feed in the room.
   */
  async unpublish(): Promise<VIDEOROOM_EVENT_UNPUBLISHED> {
    const body = {
      request: REQUEST_UNPUBLISH,
    };

    const response = await this.message(body);
    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.UNPUBLISHED)
      return evtdata as VIDEOROOM_EVENT_UNPUBLISHED;
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /**
   * Join a room as subscriber.
   *
   * @param params
   * @param string} params.room - The room to join
   * @param string} [params.feed=0] - The feed the user wants to subscribe to
   * @param [params.audio] - Whether or not audio should be relayed
   * @param [params.video] - Whether or not video should be relayed
   * @param [params.data] - Whether or not data should be relayed
   * @param [params.offer_audio] - Whether or not audio should be negotiated
   * @param [params.offer_video] - Whether or not video should be negotiated
   * @param [params.offer_data] - Whether or not data should be negotiated
   * @param [params.private_id] - The private id to correlate with publisher
   * @param [params.sc_substream_layer] - Substream layer to receive (0-2), in case simulcasting is enabled
   * @param [params.sc_substream_fallback_ms] - How much time in ms without receiving packets will make janus drop to the substream below
   * @param [params.sc_temporal_layers] - Temporal layers to receive (0-2), in case VP8 simulcasting is enabled
   * @param [params.streams] - [multistream] The streams object, each stream includes feed, mid, send, ...
   * @param [params.autoupdate] - [multistream] Whether a new SDP offer is sent automatically when a subscribed publisher leaves
   * @param [params.use_msid] - [multistream] Whether subscriptions should include an msid that references the publisher
   * @param [params.token] - The optional token needed
   * @param [params.pin] - The optional password required to join the room
   */
  async joinSubscriber({ room, feed, audio, video, data, offer_audio, offer_video, offer_data, private_id, sc_substream_layer, sc_substream_fallback_ms, sc_temporal_layers, streams, autoupdate, use_msid, token, pin }: { room: number | string; feed?: number | string; audio?: boolean; video?: boolean; data?: boolean; offer_audio?: boolean; offer_video?: boolean; offer_data?: boolean; private_id?: number; sc_substream_layer?: number; sc_substream_fallback_ms?: number; sc_temporal_layers?: number; streams?: object[]; autoupdate?: boolean; use_msid?: boolean; token?: string; pin?: string; }): Promise<VIDEOROOM_EVENT_SUB_JOINED> {
    const body: { [index: string]: unknown } = {
      request: REQUEST_JOIN,
      ptype: PTYPE_LISTENER,
      room,
    };

    /* [multistream] */
    if (streams && Array.isArray(streams)) {
      body.streams = streams;
    }
    else {
      body.feed = feed;
      if (typeof audio === 'boolean') body.audio = audio;
      if (typeof video === 'boolean') body.video = video;
      if (typeof data === 'boolean') body.data = data;
      if (typeof offer_audio === 'boolean') body.offer_audio = offer_audio;
      if (typeof offer_video === 'boolean') body.offer_video = offer_video;
      if (typeof offer_data === 'boolean') body.offer_data = offer_data;
      if (typeof sc_substream_layer === 'number') body.substream = sc_substream_layer;
      if (typeof sc_substream_fallback_ms === 'number') body.fallback = 1000 * sc_substream_fallback_ms;
      if (typeof sc_temporal_layers === 'number') body.temporal = sc_temporal_layers;
    }
    if (typeof private_id === 'number') body.private_id = private_id;
    if (typeof token === 'string') body.token = token;
    if (typeof pin === 'string') body.pin = pin;

    /* [multistream] */
    if (typeof autoupdate === 'boolean') body.autoupdate = autoupdate;
    if (typeof use_msid === 'boolean') body.use_msid = use_msid;

    const response = await this.message(body);
    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.SUB_JOINED)
      return evtdata as VIDEOROOM_EVENT_SUB_JOINED;
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /**
   * Alias for "joinSubscriber".
   *
   * @see VideoRoomHandle#joinSubscriber
   */
  async joinListener(params: { room: number | string; feed?: number | string; audio?: boolean; video?: boolean; data?: boolean; offer_audio?: boolean; offer_video?: boolean; offer_data?: boolean; private_id?: number; sc_substream_layer?: number; sc_substream_fallback_ms?: number; sc_temporal_layers?: number; streams?: object[]; autoupdate?: boolean; use_msid?: boolean; token?: string; pin?: string; }): Promise<VIDEOROOM_EVENT_SUB_JOINED> {
    return this.joinSubscriber(params);
  }

  /**
   * Start a subscriber stream.
   *
   * @param params
   * @param params.jsep - The JSEP answer
   * @param [params.e2ee] - True to hint an end-to-end encrypted negotiation
   */
  async start({ jsep, e2ee }: { jsep: JSEP; e2ee?: boolean; }): Promise<VIDEOROOM_EVENT_STARTED> {
    const body = {
      request: REQUEST_START,
    };
    if (jsep)
      jsep.e2ee = (typeof e2ee === 'boolean') ? e2ee : jsep.e2ee;

    const response = await this.message(body, jsep);
    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.STARTED && evtdata.started === 'ok')
      return evtdata as VIDEOROOM_EVENT_STARTED;
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /**
   * Pause a subscriber feed.
   */
  async pause(): Promise<VIDEOROOM_EVENT_PAUSED> {
    const body = {
      request: REQUEST_PAUSE,
    };

    const response = await this.message(body);
    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.PAUSED && evtdata.paused === 'ok')
      return evtdata as VIDEOROOM_EVENT_PAUSED;
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /**
   * Switch to another feed.
   *
   * @param params
   * @param [params.to_feed] - The feed id of the new publisher to switch to
   * @param [params.audio] - True to subscribe to the audio feed
   * @param [params.video] - True to subscribe to the video feed
   * @param [params.data] - True to subscribe to the datachannels of the feed
   * @param [params.streams] - [multistream] streams array containing feed, mid, sub_mid ...
   */
  async switch({ to_feed, audio, video, data, streams }: { to_feed?: number | string; audio?: boolean; video?: boolean; data?: boolean; streams?: object[]; }): Promise<VIDEOROOM_EVENT_SWITCHED> {
    const body: { [index: string]: unknown } = {
      request: REQUEST_SWITCH,
    };

    /* [multistream] */
    if (streams && Array.isArray(streams)) {
      body.streams = streams;
    }
    else {
      body.feed = to_feed;
      if (typeof audio === 'boolean') body.audio = audio;
      if (typeof video === 'boolean') body.video = video;
      if (typeof data === 'boolean') body.data = data;
    }

    const response = await this.message(body);
    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.SWITCHED && evtdata.switched === 'ok') {
      return evtdata as VIDEOROOM_EVENT_SWITCHED;
    }
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /**
   * Leave a room.
   * Can be used by both publishers and subscribers.
   */
  async leave(): Promise<VIDEOROOM_EVENT_LEAVING> {
    const body = {
      request: REQUEST_LEAVE,
    };

    const response = await this.message(body);
    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.LEAVING)
      return evtdata as VIDEOROOM_EVENT_LEAVING;
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /**
   * [multistream] Update a subscription.
   *
   * @param params
   * @param params.subscribe - The array of streams to subscribe
   * @param params.unsubscribe - The array of streams to unsubscribe
   *
   * @returns {Promise<VIDEOROOM_EVENT_UPDATED>}
   */
  async update({ subscribe, unsubscribe }: { subscribe: any[]; unsubscribe?: any[]; }): Promise<VIDEOROOM_EVENT_UPDATED> {
    const body: any = {
      request: REQUEST_UPDATE,
    };
    if (subscribe && Array.isArray(subscribe)) body.subscribe = subscribe;
    if (unsubscribe && Array.isArray(unsubscribe)) body.unsubscribe = unsubscribe;

    const response = await this.message(body);
    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.UPDATED) {
      return evtdata as VIDEOROOM_EVENT_UPDATED;
    }
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /*----------------*/
  /* Management API */
  /*----------------*/

  /* These are the APIs needed to manage videoroom resources (rooms, forwarders ...) */

  /**
   * List the participants inside a room.
   *
   * @param params
   * @param params.room - The room where the list is being requested
   * @param params.secret - The optional secret for the operation
   */
  async listParticipants({ room, secret }: { room: number | string; secret: string; }): Promise<VIDEOROOM_EVENT_PARTICIPANTS_LIST> {
    const body: { [index: string]: unknown } = {
      request: REQUEST_LIST_PARTICIPANTS,
      room,
    };
    if (typeof secret === 'string') body.secret = secret;

    const response = await this.message(body);
    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.PARTICIPANTS_LIST)
      return evtdata as VIDEOROOM_EVENT_PARTICIPANTS_LIST;
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /**
   * Enable or disable recording for all participants in a room while the conference is in progress.
   *
   * @param params
   * @param params.room - The room where the change of recording state is being requested
   * @param params.secret - The optional secret for the operation
   * @param params.record - True starts recording for all participants in an already running conference, false stops the recording
   */
  async enable_recording({ room, secret, record }: { room: number | string; secret: string; record: boolean; }): Promise<VIDEOROOM_EVENT_RECORDING_ENABLED_STATE> {
    const body: { [index: string]: unknown } = {
      request: REQUEST_ENABLE_RECORDING,
      room,
      record
    };
    if (typeof secret === 'string') body.secret = secret;

    const response = await this.message(body);
    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.RECORDING_ENABLED_STATE) {
      evtdata.room = body.room;
      return evtdata as VIDEOROOM_EVENT_RECORDING_ENABLED_STATE;
    }
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /**
   * Kick a publisher out from a room.
   *
   * @param params
   * @param params.room - The room where the kick is being requested
   * @param params.feed - The identifier of the feed to kick out
   * @param params.secret - The optional secret for the operation
   */
  async kick({ room, feed, secret }: { room: number | string; feed: number | string; secret: string; }): Promise<VIDEOROOM_EVENT_KICKED> {
    const body: { [index: string]: unknown } = {
      request: REQUEST_KICK,
      room,
      id: feed,
    };
    if (typeof secret === 'string') body.secret = secret;

    const response = await this.message(body);
    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.SUCCESS) {
      evtdata.room = body.room;
      evtdata.feed = body.id;
      return evtdata as VIDEOROOM_EVENT_KICKED;
    }
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /**
   * Check if a room exists.
   *
   * @param params
   * @param params.room - The room to check
   */
  async exists({ room }: { room: number | string; }): Promise<VIDEOROOM_EVENT_EXISTS> {
    const body: { [index: string]: unknown } = {
      request: REQUEST_EXISTS,
      room,
    };

    const response = await this.message(body);
    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.EXISTS)
      return evtdata as VIDEOROOM_EVENT_EXISTS;
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /**
   * List all the available rooms.
   *
   * @param params
   * @param [params.admin_key] - The admin key needed for invoking the API
   */
  async list({ admin_key }: { admin_key?: string; } = {}): Promise<VIDEOROOM_EVENT_LIST> {
    const body: { [index: string]: unknown } = {
      request: REQUEST_LIST_ROOMS,
    };
    if (typeof admin_key === 'string') body.admin_key = admin_key;

    const response = await this.message(body);
    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.ROOMS_LIST)
      return evtdata as VIDEOROOM_EVENT_LIST;
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /**
   * Create a new room.
   *
   * @param params
   * @param [params.room] - The room identifier, if missing picked by janus
   * @param [params.description] - A textual description of the room
   * @param [params.max_publishers] - The max number of publishers allowed
   * @param [params.permanent] - True to make Janus persist the room on th config file
   * @param [params.is_private] - Make the room private (hidden from listing)
   * @param [params.secret] - The secret that will be used to modify the room
   * @param [params.pin] - The pin needed to access the room
   * @param [params.admin_key] - The admin key needed for invoking the API
   * @param [params.bitrate] - The bitrate cap that will be used for publishers
   * @param [params.bitrate_cap] - Make the bitrate cap an insormountable limit
   * @param [params.fir_freq] - The PLI interval in seconds
   * @param [params.audiocodec] - Comma separated list of allowed audio codecs
   * @param [params.videocodec] - Comma separated list of allowed video codecs
   * @param [params.talking_events] - True to enable talking events
   * @param [params.talking_level_threshold] - Audio level threshold for talking events in the range [0, 127]
   * @param [params.talking_packets_threshold] - Audio packets threshold for talking events
   * @param [params.require_pvtid] - Whether subscriptions are required to provide a valid private_id
   * @param [params.notify_joining] - Whether to notify all participants when a new participant joins the room
   * @param [params.require_e2ee] - Whether all participants are required to publish and subscribe using e2e encryption
   * @param [params.record] - Wheter to enable recording of any publisher
   * @param [params.rec_dir] - Folder where recordings should be stored
   * @param [params.videoorient] - Whether the video-orientation RTP extension must be negotiated
   * @param [params.h264_profile] - H264 specific profile to prefer
   * @param [params.vp9_profile] - VP9 specific profile to prefer
   * @param [params.threads] - Number of threads to assist with the relaying of publishers in the room
   */
  async create({ room, description, max_publishers, permanent, is_private, secret, pin, admin_key, bitrate,
    bitrate_cap, fir_freq, audiocodec, videocodec, talking_events, talking_level_threshold, talking_packets_threshold,
    require_pvtid, notify_joining, require_e2ee, record, rec_dir, videoorient, h264_profile, vp9_profile, threads }: { room?: number | string; description?: string; max_publishers?: number; permanent?: boolean; is_private?: boolean; secret?: string; pin?: string; admin_key?: string; bitrate?: number; bitrate_cap?: boolean; fir_freq?: number; audiocodec?: string; videocodec?: string; talking_events?: boolean; talking_level_threshold?: number; talking_packets_threshold?: number; require_pvtid?: boolean; notify_joining?: boolean; require_e2ee?: boolean; record?: boolean; rec_dir?: string; videoorient?: boolean; h264_profile?: string; vp9_profile?: string; threads?: number; }): Promise<VIDEOROOM_EVENT_CREATED> {
    const body: { [index: string]: unknown } = {
      request: REQUEST_CREATE,
    };
    if (typeof room === 'string' || typeof room === 'number') body.room = room;
    if (typeof description === 'string') body.description = description;
    if (typeof max_publishers === 'number') body.publishers = max_publishers;
    if (typeof permanent === 'boolean') body.permanent = permanent;
    if (typeof is_private === 'boolean') body.is_private = is_private;
    if (typeof secret === 'string') body.secret = secret;
    if (typeof pin === 'string') body.pin = pin;
    if (typeof admin_key === 'string') body.admin_key = admin_key;
    if (typeof bitrate === 'number') body.bitrate = bitrate;
    if (typeof bitrate_cap === 'boolean') body.bitrate_cap = bitrate_cap;
    if (typeof fir_freq === 'number') body.fir_freq = fir_freq;
    if (typeof audiocodec === 'string') body.audiocodec = audiocodec;
    if (typeof videocodec === 'string') body.videocodec = videocodec;
    if (typeof talking_events === 'boolean') body.audiolevel_event = talking_events;
    if (typeof talking_level_threshold === 'number' && talking_level_threshold >= 0 && talking_level_threshold <= 127) body.audio_level_average = talking_level_threshold;
    if (typeof talking_packets_threshold === 'number' && talking_packets_threshold > 0) body.audio_active_packets = talking_packets_threshold;
    if (typeof require_pvtid === 'boolean') body.require_pvtid = require_pvtid;
    if (typeof notify_joining === 'boolean') body.notify_joining = notify_joining;
    if (typeof require_e2ee === 'boolean') body.require_e2ee = require_e2ee;
    if (typeof record === 'boolean') body.record = record;
    if (typeof rec_dir === 'string') body.rec_dir = rec_dir;
    if (typeof videoorient === 'boolean') body.videoorient_ext = videoorient;
    if (typeof h264_profile === 'string') body.h264_profile = h264_profile;
    if (typeof vp9_profile === 'string') body.vp9_profile = vp9_profile;
    if (typeof threads === 'number') body.threads = threads;

    const response = await this.message(body);
    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.CREATED)
      return evtdata as VIDEOROOM_EVENT_CREATED;
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /**
   * Destroy a room.
   *
   * @param params
   * @param params.room - The room to destroy
   * @param [params.permanent] - True to remove the room from the Janus config file
   * @param [params.secret] - The secret needed to manage the room
   */
  async destroy({ room, permanent, secret }: { room: number | string; permanent?: boolean; secret?: string; }): Promise<VIDEOROOM_EVENT_DESTROYED> {
    const body: { [index: string]: unknown } = {
      request: REQUEST_DESTROY,
      room,
    };
    if (typeof permanent === 'boolean') body.permanent = permanent;
    if (typeof secret === 'string') body.secret = secret;

    const response = await this.message(body);
    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.DESTROYED)
      return evtdata as VIDEOROOM_EVENT_DESTROYED;
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /**
   * Edit the ACL tokens for a room.
   *
   * @param params
   * @param params.room - The room where to change the acl
   * @param params.action - The action to execute on the acl
   * @param params.list - The list of tokens to execute the action onto
   * @param [params.secret] - The secret needed to manage the room
   */
  async allow({ room, action, list, secret }: { room: number | string, action: "enable" | "disable" | "add" | "remove", list: string[], secret?: string }): Promise<VIDEOROOM_EVENT_ALLOWED> {
    const body: { [index: string]: unknown } = {
      request: REQUEST_ALLOW,
      room,
      action,
    };
    if (list && list.length > 0) body.allowed = list;
    if (typeof secret === 'string') body.secret = secret;

    const response = await this.message(body);
    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.ALLOWED)
      return evtdata as VIDEOROOM_EVENT_ALLOWED;
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /**
   * Start a RTP forwarding in a room.
   *
   * @param params
   * @param params.room - The room where to start a forwarder
   * @param params.feed - The feed identifier to forward (must be published)
   * @param params.host - The target host for the forwarder
   * @param [params.streams] - [multistream] The streams array containing mid, port, rtcp_port, port_2 ...
   * @param [params.audio_port] - The target audio RTP port, if audio is to be forwarded
   * @param [params.audio_rtcp_port] - The target audio RTCP port, if audio is to be forwarded
   * @param [params.audio_ssrc] - The SSRC that will be used for audio RTP
   * @param [params.video_port] - The target video RTP port, if video is to be forwarded
   * @param [params.video_rtcp_port] - The target video RTCP port, if video is to be forwarded
   * @param [params.video_ssrc] - The SSRC that will be used for video RTP
   * @param [params.video_port_2] - The target video RTP port for simulcast substream
   * @param [params.video_ssrc_2] - The SSRC that will be used for video RTP substream
   * @param [params.video_port_3] - The target video RTP port for simulcast substream
   * @param [params.video_ssrc_3] - The SSRC that will be used for video RTP substream
   * @param [params.data_port] - The target datachannels port, if datachannels are to be forwarded
   * @param [params.secret] - The secret needed for managing the room
   * @param [params.admin_key] - The admin key needed for invoking the API
   */
  async startForward({ room, feed, host, streams, audio_port, audio_rtcp_port, audio_ssrc, video_port, video_rtcp_port, video_ssrc, video_port_2, video_ssrc_2, video_port_3, video_ssrc_3, data_port, secret, admin_key }: { room: number | string; feed: number | string; host: string; streams?: object[]; audio_port?: number; audio_rtcp_port?: number; audio_ssrc?: number; video_port?: number; video_rtcp_port?: number; video_ssrc?: number; video_port_2?: number; video_ssrc_2?: number; video_port_3?: number; video_ssrc_3?: number; data_port?: number; secret?: string; admin_key?: string; }): Promise<VIDEOROOM_EVENT_RTP_FWD_STARTED> {
    const body: { [index: string]: unknown } = {
      request: REQUEST_RTP_FWD_START,
      room,
      publisher_id: feed,
    };
    if (typeof host === 'string') body.host = host;
    /* [multistream] */
    if (streams && Array.isArray(streams)) {
      body.streams = streams;
    }
    else {
      if (typeof audio_port === 'number') body.audio_port = audio_port;
      if (typeof audio_rtcp_port === 'number') body.audio_rtcp_port = audio_rtcp_port;
      if (typeof audio_ssrc === 'number') body.audio_ssrc = audio_ssrc;
      if (typeof video_port === 'number') body.video_port = video_port;
      if (typeof video_rtcp_port === 'number') body.video_rtcp_port = video_rtcp_port;
      if (typeof video_ssrc === 'number') body.video_ssrc = video_ssrc;
      if (typeof video_port_2 === 'number') body.video_port_2 = video_port_2;
      if (typeof video_ssrc_2 === 'number') body.video_ssrc_2 = video_ssrc_2;
      if (typeof video_port_3 === 'number') body.video_port_3 = video_port_3;
      if (typeof video_ssrc_3 === 'number') body.video_ssrc_3 = video_ssrc_3;
      if (typeof data_port === 'number') body.data_port = data_port;
    }

    if (typeof secret === 'string') body.secret = secret;
    if (typeof admin_key === 'string') body.admin_key = admin_key;

    const response = await this.message(body);
    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.RTP_FWD_STARTED)
      return evtdata as VIDEOROOM_EVENT_RTP_FWD_STARTED;
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /**
   * Stop a RTP forwarder in a room.
   *
   * @param params
   * @param params.room - The room where to stop a forwarder
   * @param params.feed - The feed identifier for the forwarder to stop (must be published)
   * @param params.stream - The forwarder identifier as returned by the start forward API
   * @param [params.secret] - The secret needed for managing the room
   * @param [params.admin_key] - The admin key needed for invoking the API
   */
  async stopForward({ room, feed, stream, secret, admin_key }: { room: number | string; feed: number | string; stream: number | string; secret?: string; admin_key?: string; }): Promise<VIDEOROOM_EVENT_RTP_FWD_STOPPED> {
    const body: { [index: string]: unknown } = {
      request: REQUEST_RTP_FWD_STOP,
      room,
      publisher_id: feed,
      stream_id: stream,
    };
    if (typeof secret === 'string') body.secret = secret;
    if (typeof admin_key === 'string') body.admin_key = admin_key;

    const response = await this.message(body);
    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.RTP_FWD_STOPPED)
      return evtdata as VIDEOROOM_EVENT_RTP_FWD_STOPPED;
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

  /**
   * List the active forwarders in a room.
   *
   * @param params
   * @param params.room - The room where to list the forwarders
   * @param [params.secret] - The secret needed for managing the room
   */
  async listForward({ room, secret }: { room: number | string; secret?: string; }): Promise<VIDEOROOM_EVENT_RTP_FWD_LIST> {
    const body: { [index: string]: unknown } = {
      request: REQUEST_RTP_FWD_LIST,
      room,
    };
    if (typeof secret === 'string') body.secret = secret;

    const response = await this.message(body);
    const { event, data: evtdata } = this._getPluginEvent(response);
    if (event === PLUGIN_EVENT.RTP_FWD_LIST)
      return evtdata as VIDEOROOM_EVENT_RTP_FWD_LIST;
    const error = new Error(`unexpected response to ${body.request} request`);
    throw (error);
  }

}


//BEN TODO regroup and rename these types to be clearer

/**
 * The payload of the plugin message (cfr. Janus docs).
 * {@link https://janus.conf.meetecho.com/docs/videoroom.html}
 *
 * @private
 */
export type VideoRoomData = object

export interface VideoRoomHandleEventMap {
  videoroom_publisher_joined: [VIDEOROOM_PUB_PEER_JOINED],
  videoroom_publisher_list: [VIDEOROOM_PUB_LIST],
  videoroom_destroyed: [VIDEOROOM_EVENT_DESTROYED],
  videoroom_unpublished: [VIDEOROOM_EVENT_UNPUBLISHED],
  videoroom_leaving: [VIDEOROOM_EVENT_LEAVING],
  videoroom_display: [VIDEOROOM_DISPLAY],
  videoroom_configured: [VIDEOROOM_EVENT_CONFIGURED],
  videoroom_slowlink: [VIDEOROOM_SLOWLINK],
  videoroom_talking: [VIDEOROOM_TALKING],
  videoroom_kicked: [VIDEOROOM_EVENT_KICKED],
  videoroom_record_enabled_state: [VIDEOROOM_EVENT_RECORDING_ENABLED_STATE],
  videoroom_sc_substream_layer: [VIDEOROOM_SC_SUBSTREAM_LAYER],
  videoroom_sc_temporal_layers: [VIDEOROOM_SC_TEMPORAL_LAYERS],
  videoroom_updated: [VIDEOROOM_EVENT_UPDATED],
  videoroom_error: [Error]
}

/**
 * The response event when a publisher has joined.
 *
 * @property room - The involved room
 * @property feed - The feed identifier
 * @property [display] - The dsplay name, if available
 * @property description - A description of the room, if available
 * @property private_id - The private id that can be used when subscribing
 * @property publishers - The list of active publishers
 * @property string} publishers[].feed - The feed of an active publisher
 * @property [publishers[].display] - The display name of an active publisher
 * @property [publishers[].talking] - Whether the publisher is talking or not
 * @property [publishers[].audiocodec] - The audio codec used by active publisher
 * @property [publishers[].videocodec] - The video codec used by active publisher
 * @property publishers[].simulcast - True if the publisher uses simulcast (VP8 and H.264 only)
 * @property [publishers[].streams] - [multistream] Streams description as returned by Janus
 * @property [e2ee] - True if the stream is end-to-end encrypted
 * @property [jsep] - The JSEP answer
 */
export type VIDEOROOM_EVENT_PUB_JOINED = {
  room: string;
  feed: string;
  display?: string;
  description: string;
  private_id: number;
  publishers: {
    feed: string;
    display?: string;
    talking?: boolean;
    audiocodec?: string;
    videocodec?: string;
    simulcast: boolean;
    streams?: { // BEN TODO See Pub List Streams
      type: "audio" | "video" | "data",
      mindex: number,
      mid: string
    }[]
  }[];
  e2ee?: boolean;
  jsep?: RTCSessionDescription;
}

/**
 * The response event when a subscriber has joined.
 *
 * @property - The involved room
 * @property - The published feed identifier
 * @property - The published feed display name
 * @property - [multistream] Streams description as returned by Janus
 */
export type VIDEOROOM_EVENT_SUB_JOINED = {
  room: string,
  feed?: string,
  display?: string,
  streams?: { // BEN TODO see Pub List Streams
    type: "audio" | "video" | "data",
    mindex: number,
    mid: string
  }[]
  jsep: RTCSessionDescriptionInit
}

/**
* Active publishers list updated.
* @event VideoRoomHandle#event:VIDEOROOM_PUB_LIST
* @type {Object}
* @property {number|string} room - The involved room
* @property {number|string} feed - The current feed identifier
* @property {object[]} publishers - List of the new publishers
* @property {number|string} publishers[].feed - Feed identifier of the new publisher
* @property {string} publishers[].display - Display name of the new publisher
* @property {boolean} [publishers[].talking] - Whether the publisher is talking or not
* @property {string} [publishers[].audiocodec] - The audio codec used by active publisher
* @property {string} [publishers[].videocodec] - The video codec used by active publisher
* @property {boolean} publishers[].simulcast - True if the publisher uses simulcast (VP8 and H.264 only)
* @property {object[]} [publishers[].streams] - [multistream] Streams description as returned by Janus
*/
export type VIDEOROOM_PUB_LIST = {
  room: string,
  feed: string,
  publishers: {
    feed: string,
    display: string,
    talking?: boolean,
    audiocodec?: string,
    videocodec?: string,
    simulcast?: boolean,
    streams: { //TODO incomplete, different fields depending on type, perhaps should use disciminated union type? 
      type: "audio" | "video" | "data",
      mindex: number,
      mid: string
    }[]
  }[]
}

/**
 * The response event to a participant list request.
 *
 * @property room - The involved room
 * @property participants - The list of current participants
 * @property participants[].feed - Feed identifier of the participant
 * @property [participants[].display] - The participant's display name, if available
 * @property participants[].publisher - Whether the user is an active publisher in the room
 * @property [participants[].talking] - True if participant is talking
 */
export type VIDEOROOM_EVENT_PARTICIPANTS_LIST = {
  room: number | string;
  participants: {
    feed: number | string;
    display?: string;
    publisher: boolean;
    talking?: boolean;
  };
}

/**
* A peer has joined the room (notify-joining).
*
* @event VideoRoomHandle#event:VIDEOROOM_PUB_PEER_JOINED
* @type {Object}
* @property {number|string} room - The involved room
* @property {number|string} feed - The feed identifier that joined
* @property {string} display - The display name of the peer
*/
export type VIDEOROOM_PUB_PEER_JOINED = {
  room: number | string,
  feed: number | string,
  display: string
}

/**
* A participant has changed the display name.
* @event VideoRoomHandle#event:VIDEOROOM_DISPLAY
* @type {Object}
* @property {number|string} room - The involved room
* @property {number|string} feed - The feed of the peer that change display name
* @property {string} display - The new display name of the peer
*/
export type VIDEOROOM_DISPLAY = {
  room: string,
  feed: string,
  display: string
}

/**
* A handle received a slow link notification.
*
* @event VideoRoomHandle#event:VIDEOROOM_SLOWLINK
* @type {Object}
* @property {number|string} room - The involved room
* @property {number|string} feed - The feed of the peer that change display name
* @property {number} bitrate - The current bitrate cap for the participant
*/
type VIDEOROOM_SLOWLINK = {
  room: string | number,
  feed: string | number,
  bitrate: number
}

/**
* A switch to a different simulcast substream has been completed.
* @event VideoRoomHandle#event:VIDEOROOM_SC_SUBSTREAM_LAYER
* @type {Object}
* @property {number|string} room - The involved room
* @property {number|string} feed - The feed of the peer this notification refers to
* @property {number} sc_substream_layer - The new simuclast substream layer relayed
*/
type VIDEOROOM_SC_SUBSTREAM_LAYER = {
  room: number | string,
  feed: number | string,
  sc_substream_layer: number
}

/**
* A switch to a different number of simulcast temporal layers has been completed.
*
* @event VideoRoomHandle#event:VIDEOROOM_SC_TEMPORAL_LAYERS
* @type {Object}
* @property {number|string} room - The involved room
* @property {number|string} feed - The feed of the peer this switch notification refers to
* @property {number} sc_temporal_layers - The new number of simuclast teporal layers relayed
*/
type VIDEOROOM_SC_TEMPORAL_LAYERS = {
  room: number | string,
  feed: number | string,
  sc_temporal_layers: number
}

/**
* Notify if the current user is talking.
*
* @event VideoRoomHandle#event:VIDEOROOM_TALKING
* @type {Object}
* @property {number|string} room - The involved room
* @property {number|string} feed - The feed of the peer this talking notification refers to
* @property {boolean} talking - True if the participant is talking
* @property {number} audio_level - The audio level of the participant in the range [0,127]
*/
export type VIDEOROOM_TALKING = {
  room: string,
  feed: string,
  talking: boolean,
  audio_level: number
}

/**
 * The response event for room create request.
 *
 * @property room - The created room
 * @property permanent - True if the room has been persisted on the Janus configuratin file
 */
export type VIDEOROOM_EVENT_CREATED = {
  room: number | string,
  permanent: boolean
}

/**
 * The response event for room destroy request.
 *
 * @property room - The destroyed room
 * @property permanent - True if the room has been removed from the Janus configuration file
 */
export type VIDEOROOM_EVENT_DESTROYED = {
  room: number | string;
  permanent?: boolean;
}

/**
 * The response event for room exists request.
 *
 * @property room - The queried room
 */
export type VIDEOROOM_EVENT_EXISTS = {
  room: number | string;
  exists: boolean
}

/**
 * Descriptrion of an active RTP forwarder.
 * @property host - The target host
 * @property [audio_port] - The RTP audio target port
 * @property [audio_rtcp_port] - The RTCP audio target port
 * @property [audio_stream] - The audio forwarder identifier
 * @property [video_port] - The RTP video target port
 * @property [video_rtcp_port] - The RTCP video target port
 * @property [video_stream] - The video forwarder identifier
 * @property [video_port_2] - The RTP video target port (simulcast)
 * @property [video_stream_2] - The video forwarder identifier (simulcast)
 * @property [video_port_3] - The RTP video target port (simulcast)
 * @property [video_stream_3] - The video forwarder identifier (simulcast)
 * @property [data_port] - The datachannels target port
 * @property [data_stream] - The datachannels forwarder identifier
 * @property [ssrc] - SSRC this forwarder is using
 * @property [pt] - payload type this forwarder is using
 * @property [sc_substream_layer] - video simulcast substream this video forwarder is relaying
 * @property [srtp] - whether the RTP stream is encrypted
 */
export type RtpForwarder = {
  host: string;
  audio_port?: number;
  audio_rtcp_port?: number;
  audio_stream?: number;
  video_port?: number;
  video_rtcp_port?: number;
  video_stream?: number;
  video_port_2?: number;
  video_stream_2?: number;
  video_port_3?: number;
  video_stream_3?: number;
  data_port?: number;
  data_stream?: number;
  ssrc?: number;
  pt?: number;
  sc_substream_layer?: number;
  srtp?: boolean;
}

/**
 * The response event for RTP forward start request.
 *
 * @property room - The involved room
 * @property [forwarder] - The forwarder object
 * @property [forwarders] - [multistream] The array of forwarders
 */
export type VIDEOROOM_EVENT_RTP_FWD_STARTED = {
  room: number | string;
  forwarder?: RtpForwarder;
  forwarders?: RtpForwarder[];
}

/**
 * The response event for RTP forward stop request.
 *
 * @property room - The involved room
 * @property feed - The feed identifier being forwarded
 * @property stream - The forwarder identifier
 */
export type VIDEOROOM_EVENT_RTP_FWD_STOPPED = {
  room: number | string;
  feed: number | string;
  stream: number;
}

/**
 * The response event for RTP forwarders list request.
 * @property {number|string} room - The involved room
 *
 * @property {object[]} forwarders - The list of forwarders
 * @property {number|string} forwarders[].feed - The feed that is being forwarded
 * @property {RtpForwarder[]} forwarders[].forwarders -The list of the forwarders for this feed
 */
export type VIDEOROOM_EVENT_RTP_FWD_LIST = {
  room: number | string;
  forwarders: {
    feed: number | string;
    forwarders: RtpForwarder[];
  };
}

/**
 * The response event for videoroom list request.
 *
 * @property list - The list of the room as returned by Janus
 */
export type VIDEOROOM_EVENT_LIST = {
  list: object[]
}

/**
 * The response event for ACL tokens edit (allowed) request.
 *
 * @property list - The updated, complete, list of allowed tokens
 */
export type VIDEOROOM_EVENT_ALLOWED = {
  list: string[];
}

/**
 * The response event for publisher/subscriber configure request.
 *
 * @property room - The involved room
 * @property feed - The feed identifier
 * @property [display] - The display name, if available
 * @property [restart] - True if the request had it true
 * @property [update] - True if the request had it true
 * @property configured - A string with the value returned by Janus
 * @property [streams] - [multistream] Streams description as returned by Janus
 * @property [e2ee] - True if the stream is end-to-end encrypted
 * @property [jsep] - The JSEP answer
 */
export type VIDEOROOM_EVENT_CONFIGURED = {
  room: number,
  feed: number,
  display?: string,
  restart?: boolean,
  update?: boolean,
  configured: string,
  streams: object[],
  e2ee?: boolean,
  jsep?: RTCSessionDescription
}

/**
 * The response event for subscriber start request.
 *
 * @property room - The involved room
 * @property [feed] - The feed that started
 * @property [e2ee] - True if started stream is e2ee
 * @property started - A string with the value returned by Janus
 */
export type VIDEOROOM_EVENT_STARTED = {
  room: number | string,
  feed?: number | string,
  e2ee?: boolean,
  started: string
}

/**
 * The response event for subscriber pause request.
 *
 * room - The involved room
 * feed - The feed that has been paused
 * paused - A string with the value returned by Janus
 */
export type VIDEOROOM_EVENT_PAUSED = {
  room: number | string;
  feed: number | string;
  paused: string;
}

/**
 * The response event for subscriber switch request.
 *
 * @property room - The involved room
 * @property [from_feed] - The feed that has been switched from
 * @property [to_feed] - The feed that has been switched to
 * @property switched - A string with the value returned by Janus
 * @property [display] - The display name of the new feed
 * @property [streams] - [multistream] The updated streams array
 */
export type VIDEOROOM_EVENT_SWITCHED = {
  room: number | string;
  from_feed?: number | string;
  to_feed?: number | string;
  switched: string;
  display?: string;
  streams?: object[];
}

/**
 * The response event for publisher unpublish request.
 *
 * @property room - The involved room
 * @property feed - The feed that unpublished
 */
export type VIDEOROOM_EVENT_UNPUBLISHED = {
  room: string,
  feed: string,
}

/**
 * The response event for publiher/subscriber leave request.
 *
 * @property room - The involved room
 * @property feed - The feed that left
 * @property reason - An optional string with the reason of the leaving
 */
export type VIDEOROOM_EVENT_LEAVING = {
  room: string,
  feed: string,
  reason?: string
}

/**
 * The response event for the kick request.
 *
 * @property room - The involved room
 * @property feed - The feed that has been kicked
 */
export type VIDEOROOM_EVENT_KICKED = {
  room: string;
  feed: string;
}

/**
 * The response event for the recording enabled request.
 *
 * @property room - The involved room
 * @property recording - Whether or not the room recording is now enabled
 */
export type VIDEOROOM_EVENT_RECORDING_ENABLED_STATE = {
  room: number | string;
  recording: boolean;
}

/**
 * [multistream] The response event for update subscriber request.
 *
 * @property - The involved room
 * @property - The updated JSEP offer
 * @property - List of the updated streams in this subscription
 */
export type VIDEOROOM_EVENT_UPDATED = {
  room: string;
  jsep?: RTCSessionDescription;
  streams: { // BEN TODO see other stream ben todos
    type: "audio" | "video" | "data",
    mindex: number,
    mid: string
  }[];
}

// Ben TODO: How do i make this into types?
/**
 * The exported plugin descriptor.
 *
 * @type {Object}
 * @property {string} id - The plugin identifier used when attaching to Janus
 * @property {VideoRoomHandle} Handle - The custom class implementing the plugin
 * @property EVENT - The events emitted by the plugin
 * @property EVENT.VIDEOROOM_PUB_PEER_JOINED {@link VideoRoomHandle#event:VIDEOROOM_PUB_PEER_JOINED VIDEOROOM_PUB_PEER_JOINED}
 * @property EVENT.VIDEOROOM_PUB_LIST {@link VideoRoomHandle#event:VIDEOROOM_PUB_LIST VIDEOROOM_PUB_LIST}
 * @property EVENT.VIDEOROOM_DESTROYED {@link VideoRoomHandle#event:VIDEOROOM_DESTROYED VIDEOROOM_DESTROYED}
 * @property EVENT.VIDEOROOM_UNPUBLISHED {@link VideoRoomHandle#event:VIDEOROOM_UNPUBLISHED VIDEOROOM_UNPUBLISHED}
 * @property EVENT.VIDEOROOM_LEAVING {@link VideoRoomHandle#event:VIDEOROOM_LEAVING VIDEOROOM_LEAVING}
 * @property EVENT.VIDEOROOM_DISPLAY {@link VideoRoomHandle#event:VIDEOROOM_DISPLAY VIDEOROOM_DISPLAY}
 * @property EVENT.VIDEOROOM_CONFIGURED {@link VideoRoomHandle#event:VIDEOROOM_CONFIGURED VIDEOROOM_CONFIGURED}
 * @property EVENT.VIDEOROOM_SLOWLINK {@link VideoRoomHandle#event:VIDEOROOM_SLOWLINK VIDEOROOM_SLOWLINK}
 * @property EVENT.VIDEOROOM_TALKING {@link VideoRoomHandle#event:VIDEOROOM_TALKING VIDEOROOM_TALKING}
 * @property EVENT.VIDEOROOM_KICKED {@link VideoRoomHandle#event:VIDEOROOM_KICKED VIDEOROOM_KICKED}
 * @property EVENT.VIDEOROOM_RECORDING_ENABLED_STATE {@link VideoRoomHandle#event:VIDEOROOM_RECORDING_ENABLED_STATE VIDEOROOM_RECORDING_ENABLED_STATE}
 * @property EVENT.VIDEOROOM_SC_SUBSTREAM_LAYER {@link VideoRoomHandle#event:VIDEOROOM_SC_SUBSTREAM_LAYER VIDEOROOM_SC_SUBSTREAM_LAYER}
 * @property EVENT.VIDEOROOM_SC_TEMPORAL_LAYERS {@link VideoRoomHandle#event:VIDEOROOM_SC_TEMPORAL_LAYERS VIDEOROOM_SC_TEMPORAL_LAYERS}
 * @property EVENT.VIDEOROOM_UPDATED {@link VideoRoomHandle#event:VIDEOROOM_UPDATED VIDEOROOM_UPDATED}
 * @property EVENT.VIDEOROOM_ERROR {@link VideoRoomHandle#event:VIDEOROOM_ERROR VIDEOROOM_ERROR}
 */
export default {
  id: PLUGIN_ID,
  Handle: VideoRoomHandle,
  EVENT: {
    /**
     * A peer has joined the room (notify-joining).
     *
     * @event VideoRoomHandle#event:VIDEOROOM_PUB_PEER_JOINED
     * @type {Object}
     * @property {number|string} room - The involved room
     * @property {number|string} feed - The feed identifier that joined
     * @property {string} display - The display name of the peer
     */
    VIDEOROOM_PUB_PEER_JOINED: PLUGIN_EVENT.PUB_PEER_JOINED,

    /**
     * Active publishers list updated.
     *
     * @event VideoRoomHandle#event:VIDEOROOM_PUB_LIST
     * @type {Object}
     * @property {number|string} room - The involved room
     * @property {number|string} feed - The current feed identifier
     * @property {object[]} publishers - List of the new publishers
     * @property {number|string} publishers[].feed - Feed identifier of the new publisher
     * @property {string} publishers[].display - Display name of the new publisher
     * @property {boolean} [publishers[].talking] - Whether the publisher is talking or not
     * @property {string} [publishers[].audiocodec] - The audio codec used by active publisher
     * @property {string} [publishers[].videocodec] - The video codec used by active publisher
     * @property {boolean} publishers[].simulcast - True if the publisher uses simulcast (VP8 and H.264 only)
     * @property {object[]} [publishers[].streams] - [multistream] Streams description as returned by Janus
     */
    VIDEOROOM_PUB_LIST: PLUGIN_EVENT.PUB_LIST,

    /**
     * The videoroom has been destroyed.
     *
     * @event VideoRoomHandle#event:VIDEOROOM_DESTROYED
     * @type {Object}
     * @property {number|string} room - The destroyed room
     * @property {boolean} permanent - True if the room has been removed from the Janus configuration file
     */
    VIDEOROOM_DESTROYED: PLUGIN_EVENT.DESTROYED,

    /**
     * A feed has been unpublished.
     *
     * @eventVideoRoomHandle#event:VIDEOROOM_UNPUBLISHED
     * @type {Object}
     * @property {number|string} room - The involved room
     * @property {number|string} feed - The feed that unpublished
     */
    VIDEOROOM_UNPUBLISHED: PLUGIN_EVENT.UNPUBLISHED,

    /**
     * A peer has left the room.
     *
     * @event VideoRoomHandle#event:VIDEOROOM_LEAVING
     * @type {Object}
     * @property {number|string} room - The involved room
     * @property {number|string} feed - The feed that left
     * @property {string} [reason] - An optional string with the reason of the leaving
     */
    VIDEOROOM_LEAVING: PLUGIN_EVENT.LEAVING,

    /**
     * A participant has changed the display name.
     *
     * @event VideoRoomHandle#event:VIDEOROOM_DISPLAY
     * @type {Object}
     * @property {number|string} room - The involved room
     * @property {number|string} feed - The feed of the peer that change display name
     * @property {string} display - The new display name of the peer
     */
    VIDEOROOM_DISPLAY: PLUGIN_EVENT.DISPLAY,

    /**
     * A handle received a configured event.
     *
     * @event VideoRoomHandle#event:VIDEOROOM_CONFIGURED
     * @type {Object}
     * @property {number|string} room - The involved room
     * @property {number|string} feed - The feed identifier
     * @property {string} [display] - The display name, if available
     * @property {boolean} [restart] - True if the request had it true
     * @property {boolean} [update] - True if the request had it true
     * @property {string} configured - A string with the value returned by Janus
     * @property {object[]} [streams] - [multistream] Streams description as returned by Janus
     * @property {boolean} [e2ee] - True if the stream is end-to-end encrypted
     * @property {RTCSessionDescription} [jsep] - The JSEP answer
     */
    VIDEOROOM_CONFIGURED: PLUGIN_EVENT.CONFIGURED,

    /**
     * A handle received a slow link notification.
     *
     * @event VideoRoomHandle#event:VIDEOROOM_SLOWLINK
     * @type {Object}
     * @property {number|string} room - The involved room
     * @property {number|string} feed - The feed of the peer that change display name
     * @property {number} bitrate - The current bitrate cap for the participant
     */
    VIDEOROOM_SLOWLINK: PLUGIN_EVENT.SLOW_LINK,

    /**
     * Notify if the current user is talking.
     *
     * @event VideoRoomHandle#event:VIDEOROOM_TALKING
     * @type {Object}
     * @property {number|string} room - The involved room
     * @property {number|string} feed - The feed of the peer this talking notification refers to
     * @property {boolean} talking - True if the participant is talking
     * @property {number} audio_level - The audio level of the participant in the range [0,127]
     */
    VIDEOROOM_TALKING: PLUGIN_EVENT.TALKING,

    /**
     * A feed has been kicked out.
     *
     * @event VideoRoomHandle#event:VIDEOROOM_KICKED
     * @type {Object}
     * @property {number|string} room - The involved room
     * @property {number|string} feed - The feed that has been kicked
     */
    VIDEOROOM_KICKED: PLUGIN_EVENT.KICKED,

    /**
     * Conference recording has been enabled or disabled.
     *
     * @event VideoRoomHandle#event:VIDEOROOM_RECORDING_ENABLED_STATE
     * @type {Object}
     * @property {number|string} room - The involved room
     * @property {boolean} recording - Whether or not the room recording is now enabled
     */
    VIDEOROOM_RECORDING_ENABLED_STATE: PLUGIN_EVENT.RECORDING_ENABLED_STATE,

    /**
     * A switch to a different simulcast substream has been completed.
     *
     * @event VideoRoomHandle#event:VIDEOROOM_SC_SUBSTREAM_LAYER
     * @type {Object}
     * @property {number|string} room - The involved room
     * @property {number|string} feed - The feed of the peer this notification refers to
     * @property {number} sc_substream_layer - The new simuclast substream layer relayed
     */
    VIDEOROOM_SC_SUBSTREAM_LAYER: PLUGIN_EVENT.SC_SUBSTREAM_LAYER,

    /**
     * A switch to a different number of simulcast temporal layers has been completed.
     *
     * @event VideoRoomHandle#event:VIDEOROOM_SC_TEMPORAL_LAYERS
     * @type {Object}
     * @property {number|string} room - The involved room
     * @property {number|string} feed - The feed of the peer this switch notification refers to
     * @property {number} sc_temporal_layers - The new number of simuclast teporal layers relayed
     */
    VIDEOROOM_SC_TEMPORAL_LAYERS: PLUGIN_EVENT.SC_TEMPORAL_LAYERS,

    /**
     * A multistream subscription has been updated.
     *
     * @event VideoRoomHandle#event:VIDEOROOM_UPDATED
     * @type {Object}
     * @property {number|string} room - The involved room
     * @property {RTCSessionDescription} [jsep] - The updated JSEP offer
     * @property {object[]} streams - List of the updated streams in this subscription
     */
    VIDEOROOM_UPDATED: PLUGIN_EVENT.UPDATED,

    /**
     * A generic videoroom error.
     *
     * @event VideoRoomHandle#event:VIDEOROOM_ERROR
     * @type {Error}
     */
    VIDEOROOM_ERROR: PLUGIN_EVENT.ERROR,
  },
};