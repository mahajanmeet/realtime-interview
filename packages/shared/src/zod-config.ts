import { z } from 'zod';

// This module must run before any schema is created. It keeps Zod from probing
// `new Function()` in Electron's strict Content Security Policy environment.
z.config({ jitless: true });
