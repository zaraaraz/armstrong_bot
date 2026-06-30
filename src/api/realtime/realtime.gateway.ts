import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
import {
  OnGatewayConnection,
  SubscribeMessage as OnMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { EventBus } from '../../core/events/event-bus';
import { PermissionService } from '../../core/permissions/application/permission.service';
import type { AuthenticatedActor } from '../common/context/api-actor';
import { RealtimeAuth } from './realtime.auth';
import {
  CHANNEL_CLAIM,
  roomFor,
  type RealtimeChannel,
  type SubscribeMessage,
} from './events.contract';

interface SocketState {
  actor: AuthenticatedActor;
}

const STATE = new WeakMap<Socket, SocketState>();

/**
 * Realtime hub on the `/ws` namespace. Authenticates the handshake, gates room
 * subscription by guild scope + claim, and fans out Event Bus events to the
 * matching rooms. The gateway is a pure subscriber/forwarder — it never calls
 * domain logic.
 */
@WebSocketGateway({ namespace: '/ws', cors: true })
export class RealtimeGateway implements OnGatewayConnection, OnModuleInit {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer() server!: Server;

  constructor(
    private readonly auth: RealtimeAuth,
    private readonly permissions: PermissionService,
    @Inject(EventBus) private readonly eventBus: EventBus,
  ) {}

  onModuleInit(): void {
    // Fan out dashboard/job/log events as they become available on the bus.
    this.eventBus.subscribe(
      'api.webhook.received',
      (envelope) => {
        const { guildId } = envelope.payload;
        if (!guildId) return;
        this.server.to(roomFor(guildId, 'logs')).emit('log', {
          guildId,
          level: 'info',
          category: 'api.webhook',
          message: `webhook ${envelope.payload.provider}:${envelope.payload.eventType}`,
          ts: envelope.occurredAt,
        });
      },
      { handlerId: 'api.realtime:onWebhookReceived' },
    );
  }

  async handleConnection(socket: Socket): Promise<void> {
    const result = await this.auth.authenticate(socket);
    if (!result) {
      socket.emit('error', { code: 'UNAUTHORIZED', message: 'Auth required' });
      socket.disconnect(true);
      return;
    }
    STATE.set(socket, { actor: result.actor });
  }

  @OnMessage('subscribe')
  async onSubscribe(
    @MessageBody() msg: SubscribeMessage,
    @ConnectedSocket() socket: Socket,
  ): Promise<void> {
    const state = STATE.get(socket);
    if (!state) return;
    for (const channel of msg.channels) {
      const allowed = await this.canJoin(state.actor, msg.guildId, channel);
      if (allowed) {
        await socket.join(roomFor(msg.guildId, channel));
      } else {
        socket.emit('error', {
          code: 'FORBIDDEN',
          message: `Missing claim for ${channel}`,
        });
      }
    }
  }

  @OnMessage('unsubscribe')
  async onUnsubscribe(
    @MessageBody() msg: SubscribeMessage,
    @ConnectedSocket() socket: Socket,
  ): Promise<void> {
    for (const channel of msg.channels) {
      await socket.leave(roomFor(msg.guildId, channel));
    }
  }

  private async canJoin(
    actor: AuthenticatedActor,
    guildId: string,
    channel: RealtimeChannel,
  ): Promise<boolean> {
    if (actor.guildScope.size > 0 && !actor.guildScope.has(guildId)) {
      return false;
    }
    const claim = CHANNEL_CLAIM[channel];
    if (actor.type === 'service' || actor.method === 'jwt') {
      return actor.claims.has(claim) || actor.claims.has('*');
    }
    return this.permissions.can(
      { userId: actor.id, guildId, discordRoleIds: [], isGuildOwner: false },
      claim,
    );
  }
}
