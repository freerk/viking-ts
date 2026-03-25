export class VikingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'VikingError';
  }
}

export class NotFoundError extends VikingError {
  constructor(uri: string) {
    super(`Not found: ${uri}`, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends VikingError {
  constructor(message: string) {
    super(message, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

export class InvalidUriError extends VikingError {
  constructor(uri: string) {
    super(`Invalid Viking URI: ${uri}`, 'INVALID_URI');
    this.name = 'InvalidUriError';
  }
}
