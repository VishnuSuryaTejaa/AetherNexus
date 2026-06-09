import { EventEmitter } from 'events';

/**
 * Shared AI Logger EventEmitter.
 * 
 * - `orchestrator.js` (Domain 2) imports this and emits 'insight' events.
 * - `server.ts` (API Gateway) imports this and forwards 'insight' events 
 *   to connected frontend clients via io.emit('ai-log', payload).
 * 
 * This module acts as an in-process event bus. Both files must be loaded
 * in the SAME Node.js process for the EventEmitter to be shared.
 * When running as separate processes, use the MongoDB change stream
 * or a Redis pub/sub channel as the inter-process bridge instead.
 */
export const aiLogger = new EventEmitter();
