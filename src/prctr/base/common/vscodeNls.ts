/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See docs/upstream/licenses/vscode-MIT.txt.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port localization-runtime

export interface ILocalizeInfo {
  readonly key: string;
  readonly comment: readonly string[];
}

export interface ILocalizedString {
  readonly original: string;
  readonly value: string;
}

export interface VSCodeNlsConfiguration {
  readonly language?: string;
  readonly messages?: readonly string[];
  readonly osLocale?: string;
  readonly userLocale?: string;
}

type PositionalValue = string | number | boolean | undefined | null;

let configuration: Readonly<VSCodeNlsConfiguration> | undefined;

export function configureVSCodeNls(next: VSCodeNlsConfiguration): void {
  if (configuration !== undefined) {
    throw new Error('VS Code localization compatibility is already configured');
  }
  configuration = Object.freeze({
    ...(next.language === undefined ? {} : { language: next.language }),
    ...(next.messages === undefined ? {} : { messages: Object.freeze([...next.messages]) }),
    ...(next.osLocale === undefined ? {} : { osLocale: next.osLocale }),
    ...(next.userLocale === undefined ? {} : { userLocale: next.userLocale })
  });
}

export function getNLSMessages(): readonly string[] {
  return configuration?.messages ?? [];
}

export function getNLSLanguage(): string | undefined {
  return configuration?.language;
}

export function getNLSConfiguration(): Readonly<VSCodeNlsConfiguration> | undefined {
  return configuration;
}

export function localize(
  info: ILocalizeInfo,
  message: string,
  ...args: readonly PositionalValue[]
): string;
export function localize(
  key: string,
  message: string,
  ...args: readonly PositionalValue[]
): string;
export function localize(
  data: ILocalizeInfo | string | number,
  message: string | null,
  ...args: readonly PositionalValue[]
): string {
  const value = typeof data === 'number' ? lookupMessage(data, message) : requireFallback(message);
  return format(value, args);
}

export function localize2(
  info: ILocalizeInfo,
  message: string,
  ...args: readonly PositionalValue[]
): ILocalizedString;
export function localize2(
  key: string,
  message: string,
  ...args: readonly PositionalValue[]
): ILocalizedString;
export function localize2(
  data: ILocalizeInfo | string | number,
  originalMessage: string,
  ...args: readonly PositionalValue[]
): ILocalizedString {
  const message = typeof data === 'number'
    ? lookupMessage(data, originalMessage)
    : originalMessage;
  const value = format(message, args);
  return {
    value,
    original: originalMessage === message ? value : format(originalMessage, args)
  };
}

function lookupMessage(index: number, fallback: string | null): string {
  const message = getNLSMessages()[index];
  if (typeof message === 'string') return message;
  if (typeof fallback === 'string') return fallback;
  throw new Error(`!!! NLS MISSING: ${index} !!!`);
}

function requireFallback(message: string | null): string {
  if (typeof message === 'string') return message;
  throw new TypeError('Unbuilt VS Code localization calls require an English fallback');
}

function format(message: string, args: readonly PositionalValue[]): string {
  const result = args.length === 0 ? message : message.replace(/\{(\d+)\}/gu, (match, rest: string) => {
    const argument: unknown = args[Number.parseInt(rest, 10)];
    return typeof argument === 'string' || typeof argument === 'number' || typeof argument === 'boolean'
      || argument === undefined || argument === null
      ? String(argument)
      : match;
  });
  return getNLSLanguage() === 'pseudo'
    ? `\uFF3B${result.replace(/[aouei]/gu, '$&$&')}\uFF3D`
    : result;
}
