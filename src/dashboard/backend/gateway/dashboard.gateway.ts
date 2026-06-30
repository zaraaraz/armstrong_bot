import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { EventBus } from '../../../core/events/event-bus';
import { GuildAccessService } from '../services/guild-access.service';
import { TicketService } from './ticket.service';

export type DashboardChannel = 'logs' | 'modules' | 'jobs' | 'analytics';

interface SocketState {
  sessionId: string;
  discordId: string;
}

const STATE = new WeakMap<Socket, SocketState>();

function room(guildId: string, channel: DashboardChannel): string {
  return `guild:${guildId}:${channel}`;
}

/**
 * Dashboard realtime hub. Authenticates the handshake with a single-use ticket,
 * gates channel subscription on `Manage Guild`, and forwards `dashboard.*` and
 * (as they land) module/log/job events to the matching guild rooms.
 */
@WebSocketGateway({ namespace: '/realtime', cors: true })
export class DashboardGateway implements OnGatewayConnection, OnModuleInit {
  private readonly logger = new Logger(DashboardGateway.name);

  @WebSocketServer() server!: Server;

  constructor(
    private readonly tickets: TicketService,
    private readonly access: GuildAccessService,
    @Inject(EventBus) private readonly eventBus: EventBus,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(
      'dashboard.module.toggled',
      (e) => {
        this.server
          .to(room(e.payload.guildId, 'modules'))
          .emit('module:state', e.payload);
      },
      { handlerId: 'dashboard.gateway:onModuleToggled' },
    );
    this.eventBus.subscribe(
      'dashboard.backup.requested',
      (e) => {
        this.server
          .to(room(e.payload.guildId, 'jobs'))
          .emit('job:state', e.payload);
      },
      { handlerId: 'dashboard.gateway:onBackupRequested' },
    );
  }

  async handleConnection(socket: Socket): Promise<void> {
    const ticket = this.ticketFrom(socket);
    const payload = ticket ? await this.tickets.consume(ticket) : null;
    if (!payload) {
      socket.emit('error', { code: 'UNAUTHORIZED' });
      socket.disconnect(true);
      return;
    }
    STATE.set(socket, {
      sessionId: payload.sessionId,
      discordId: payload.discordId,
    });
  }

  @SubscribeMessage('subscribe')
  async onSubscribe(
    @MessageBody() msg: { guildId: string; channel: DashboardChannel },
    @ConnectedSocket() socket: Socket,
  ): Promise<void> {
    const state = STATE.get(socket);
    if (!state) return;
    try {
      await this.access.assertManage(state.sessionId, msg.guildId);
      await socket.join(room(msg.guildId, msg.channel));
    } catch {
      socket.emit('error', { code: 'FORBIDDEN', guildId: msg.guildId });
    }
  }

  private ticketFrom(socket: Socket): string | null {
    const q = socket.handshake.query['ticket'];
    return typeof q === 'string' ? q : null;
  }
}
