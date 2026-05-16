/**
 * <h1>Main Application Entry Point</h1>
 * <p>Bootstraps the standalone Angular application. This is the first file executed when the application loads.</p>
 * 
 * <h2>Bootstrap Flow:</h2>
 * <pre>
 * graph TD
 *     A[index.html loads main.js] --> B[main.ts]
 *     B --> C{bootstrapApplication}
 *     C -->|Loads Providers| D[app.config.ts]
 *     C -->|Renders Root| E[app.component.ts]
 *     E --> F[ConnectSphere Frontend Active]
 * </pre>
 */

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app.component';

// Bootstrap the root application component (App) along with the global application configuration (appConfig).
bootstrapApplication(App, appConfig)
  // Log any initialization errors directly to the browser console for debugging.
  .catch((err) => console.error(err));
