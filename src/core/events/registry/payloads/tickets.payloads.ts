export interface TicketOpenedPayload {
  readonly ticketId: string;
  readonly userId: string;
  readonly channelId: string;
  readonly category: string | null;
}

export interface TicketClosedPayload {
  readonly ticketId: string;
  readonly closedBy: string;
  readonly reason: string | null;
}

export interface TicketEventPayloads {
  'tickets.ticket.opened': TicketOpenedPayload;
  'tickets.ticket.closed': TicketClosedPayload;
}
