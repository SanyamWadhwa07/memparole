// The one model call a memory system may make: turn an observation into a note.
export interface ModelRequest {
  instructions: string;
  message: string;
}

export interface Model {
  readonly name: string;
  complete(request: ModelRequest): Promise<string>;
}
