/** Scope of an audited action. Values match the Prisma `AuditScope` enum. */
export enum AuditScope {
  Guild = 'GUILD',
  Global = 'GLOBAL',
}

/**
 * Origin channel through which the action entered the system.
 * Values match the Prisma `AuditSource` enum.
 */
export enum AuditSource {
  Command = 'COMMAND',
  Dashboard = 'DASHBOARD',
  Api = 'API',
  Job = 'JOB',
  System = 'SYSTEM',
  Event = 'EVENT',
}

/** Kind of actor behind an entry. Values match the Prisma `AuditActorType` enum. */
export enum AuditActorType {
  User = 'USER',
  System = 'SYSTEM',
  Bot = 'BOT',
}
