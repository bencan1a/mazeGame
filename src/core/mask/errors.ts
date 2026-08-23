/** Thrown when a raw blob cannot be repaired into a usable `Mask`. */
export class MaskRepairError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'MaskRepairError';
  }
}
