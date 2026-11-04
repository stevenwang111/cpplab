import { config } from '../config.js';
import { Semaphore } from './semaphore.js';

/** Process-wide limits shared by run and debug paths. */
export const compileSemaphore = new Semaphore(config.limits.maxConcurrentCompiles);
export const runSemaphore = new Semaphore(config.limits.maxConcurrentRuns);
