/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * The Electron preload program includes Node's timer overloads while renderer
 * modules use the environment-neutral VS Code timer alias.
 */
type Timeout = NodeJS.Timeout;
