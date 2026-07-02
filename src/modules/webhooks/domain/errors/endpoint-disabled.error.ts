/**
 * Thrown when an inbound delivery targets an endpoint that is disabled,
 * soft-deleted, or unknown. Surfaces as a 404-equivalent so a probe cannot
 * distinguish "disabled" from "never existed".
 */
export class EndpointDisabledError extends Error {
  constructor(reason = 'endpoint not found or disabled') {
    super(reason);
    this.name = 'EndpointDisabledError';
  }
}
