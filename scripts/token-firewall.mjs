import fs from 'fs';
import path from 'path';

export function enforceTokenLimit(payload) {
  const maxTokens = process.env.MAX_TOKENS ? parseInt(process.env.MAX_TOKENS, 10) : 100000;
  // A simple token estimation logic
  const estTokens = JSON.stringify(payload).length / 4;
  if (estTokens > maxTokens) {
    throw new Error(`Token limit exceeded: Estimated ${estTokens} tokens, max ${maxTokens}`);
  }
  return true;
}
