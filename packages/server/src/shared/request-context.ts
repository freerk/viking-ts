import { createHash } from 'crypto';

export class UserIdentifier {
  constructor(
    readonly accountId: string,
    readonly userId: string,
    readonly agentId: string,
  ) {}

  /** User-level space name: the userId directly. */
  userSpaceName(): string {
    return this.userId;
  }

  /** Agent-level space name: md5(userId:agentId)[:12]. */
  agentSpaceName(): string {
    return createHash('md5')
      .update(`${this.userId}:${this.agentId}`)
      .digest('hex')
      .slice(0, 12);
  }

  static default(): UserIdentifier {
    return new UserIdentifier('default', 'default', 'default');
  }
}

export interface RequestContext {
  user: UserIdentifier;
}
