export type ClaimString = string;
export type PermissionEffect = 'GRANT' | 'DENY' | 'UNSET';

export class InvalidClaimError extends Error {
  constructor(raw: string) {
    super(
      `Invalid claim format: "${raw}". Expected dot-namespaced lowercase string or wildcard.`,
    );
    this.name = 'InvalidClaimError';
  }
}

export class Claim {
  private static readonly PATTERN =
    /^(?:\*|[a-z0-9]+(?:\.[a-z0-9]+)*(?:\.\*)?)$/;

  private constructor(public readonly value: ClaimString) {}

  static parse(raw: string): Claim {
    const v = raw.trim().toLowerCase();
    if (!Claim.PATTERN.test(v)) throw new InvalidClaimError(raw);
    return new Claim(v);
  }

  /** True if this held/granted claim covers the required claim. */
  covers(required: Claim): boolean {
    if (this.value === '*') return true;
    if (this.value === required.value) return true;
    if (this.value.endsWith('.*')) {
      const prefix = this.value.slice(0, -1);
      return required.value.startsWith(prefix);
    }
    return false;
  }

  /** Higher specificity wins on conflict. */
  specificity(): number {
    if (this.value === '*') return 0;
    const depth = this.value.split('.').length;
    return this.value.endsWith('.*') ? depth - 1 + 0.5 : depth;
  }

  toString(): string {
    return this.value;
  }
}
