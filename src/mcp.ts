#!/usr/bin/env node
import { StringDecoder } from 'node:string_decoder';
import { handle, PARSE_ERROR, type Response } from './mcp/protocol.js';
import { stopEngines } from './node/stop.js';

// A Model Context Protocol server over standard input and output: one JSON
// message per line. Standard output carries protocol messages only.

// The largest real message is an export of 6,000,000 characters, JSON-escaped.
const MAX_LINE_CHARACTERS = 16_777_216;

const send = (response: Response): void => {
  process.stdout.write(`${JSON.stringify(response)}\n`);
};

// One message at a time, answered in the order received.
let queue: Promise<void> = Promise.resolve();
function accept(line: string): void {
  if (line.trim() === '') return;
  queue = queue.then(async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return send(PARSE_ERROR);
    }
    const response = await handle(parsed);
    if (response !== undefined) send(response);
  });
}

const decoder = new StringDecoder('utf8');
let buffer = '';
let skipping = false; // inside a line that was already too long
process.stdin.on('data', (chunk: Buffer) => {
  buffer += decoder.write(chunk);
  for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (skipping) skipping = false;
    else accept(line);
  }
  if (buffer.length > MAX_LINE_CHARACTERS) {
    buffer = '';
    if (!skipping) queue = queue.then(() => send(PARSE_ERROR));
    skipping = true;
  }
});
process.stdin.on('end', () => {
  if (!skipping) accept(buffer);
  void queue.then(stopEngines);
});
