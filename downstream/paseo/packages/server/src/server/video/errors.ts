export class EditorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "EditorError";
  }
}

export function editorFailure(code: string, sanitizedDetail: string, retryable = false): never {
  throw new EditorError(code, sanitizedDetail, retryable);
}

export function describeEditorError(error: unknown): {
  code: string;
  retryable: boolean;
  sanitizedDetail: string;
} {
  if (error instanceof EditorError) {
    return { code: error.code, retryable: error.retryable, sanitizedDetail: error.message };
  }
  return {
    code: "INTERNAL",
    retryable: false,
    sanitizedDetail: "The video service could not complete the request",
  };
}
