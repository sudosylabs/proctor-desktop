export type LocalizationDirection = 'ltr' | 'rtl';

export type LocalizationValue = string | number | boolean | null | undefined;

export interface MessageDescriptor {
	readonly id: string;
	readonly defaultMessage: string;
	readonly description: string;
	readonly placeholders: readonly string[];
}

export interface LocalizationCatalog {
	readonly locale: string;
	readonly direction: LocalizationDirection;
	readonly messages: Readonly<Record<string, string>>;
}

export interface LocalizationContext {
	readonly locale: string;
	readonly direction: LocalizationDirection;
	format(
		descriptor: MessageDescriptor,
		values?: Readonly<Record<string, LocalizationValue>>
	): string;
}

export interface LocalizationOptions {
	readonly requestedLocale: string;
	readonly messages: readonly MessageDescriptor[];
	readonly catalogs?: readonly LocalizationCatalog[];
	readonly pseudo?: boolean;
}

export interface MessageDefinition {
	readonly id: string;
	readonly defaultMessage: string;
	readonly description: string;
}

type TemplateToken = string | { readonly placeholder: string };

interface CompiledTemplate {
	readonly placeholders: readonly string[];
	readonly tokens: readonly TemplateToken[];
}

interface PreparedCatalog {
	readonly locale: string;
	readonly direction: LocalizationDirection;
	readonly messages: ReadonlyMap<string, CompiledTemplate>;
}

const MESSAGE_ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/u;
const PLACEHOLDER_NAME = /^[a-z][a-zA-Z0-9]*$/u;

export function defineMessage(definition: MessageDefinition): MessageDescriptor {
	if (!MESSAGE_ID.test(definition.id)) {
		throw new TypeError(`Invalid localization message identifier: ${definition.id}`);
	}
	if (definition.description.trim() === '') {
		throw new TypeError(`Localization message ${definition.id} requires a description`);
	}
	const compiled = compileTemplate(definition.defaultMessage, definition.id);
	return Object.freeze({
		id: definition.id,
		defaultMessage: definition.defaultMessage,
		description: definition.description,
		placeholders: Object.freeze([...compiled.placeholders])
	});
}

export function getMessagePlaceholders(message: string): readonly string[] {
	return compileTemplate(message, 'message').placeholders;
}

export function createLocalization(options: LocalizationOptions): LocalizationContext {
	const descriptors = new Map<
		string,
		{
			readonly descriptor: MessageDescriptor;
			readonly template: CompiledTemplate;
		}
	>();
	for (const descriptor of options.messages) {
		if (descriptors.has(descriptor.id)) {
			throw new TypeError(`Duplicate localization message identifier: ${descriptor.id}`);
		}
		const normalized = defineMessage(descriptor);
		if (!sameStrings(normalized.placeholders, descriptor.placeholders)) {
			throw new TypeError(
				`Localization message ${descriptor.id} has stale placeholder metadata`
			);
		}
		descriptors.set(descriptor.id, {
			descriptor: normalized,
			template: compileTemplate(normalized.defaultMessage, normalized.id)
		});
	}

	const catalogs = prepareCatalogs(options.catalogs ?? [], descriptors);
	const pseudo = options.pseudo === true || options.requestedLocale === 'pseudo';
	const requestedLocale = pseudo ? 'pseudo' : canonicalizeLocale(options.requestedLocale);
	const fallbackChain = pseudo
		? []
		: localeFallbacks(requestedLocale)
				.map((locale) => catalogs.get(locale.toLowerCase()))
				.filter((catalog): catalog is PreparedCatalog => catalog !== undefined);
	const resolvedCatalog = fallbackChain[0];
	const context: LocalizationContext = {
		locale: pseudo ? 'pseudo' : (resolvedCatalog?.locale ?? 'en'),
		direction: pseudo ? 'ltr' : (resolvedCatalog?.direction ?? 'ltr'),
		format: (descriptor, values = {}) => {
			const registered = descriptors.get(descriptor.id);
			if (registered === undefined) {
				throw new TypeError(`Localization message is not registered: ${descriptor.id}`);
			}
			const template =
				fallbackChain
					.map((catalog) => catalog.messages.get(descriptor.id))
					.find((candidate): candidate is CompiledTemplate => candidate !== undefined) ??
				registered.template;
			const formatted = formatTemplate(template, values, descriptor.id);
			return pseudo ? pseudoTranslate(formatted) : formatted;
		}
	};
	return Object.freeze(context);
}

function prepareCatalogs(
	inputs: readonly LocalizationCatalog[],
	descriptors: ReadonlyMap<string, { readonly descriptor: MessageDescriptor }>
): ReadonlyMap<string, PreparedCatalog> {
	const result = new Map<string, PreparedCatalog>();
	for (const input of inputs) {
		const locale = canonicalizeLocale(input.locale);
		const key = locale.toLowerCase();
		if (result.has(key)) {
			throw new TypeError(`Duplicate localization catalog: ${locale}`);
		}
		if (input.direction !== 'ltr' && input.direction !== 'rtl') {
			throw new TypeError(`Invalid localization direction for ${locale}`);
		}
		const messages = new Map<string, CompiledTemplate>();
		for (const [id, value] of Object.entries(input.messages)) {
			const descriptor = descriptors.get(id)?.descriptor;
			if (descriptor === undefined) {
				throw new TypeError(
					`Localization catalog ${locale} contains unknown message: ${id}`
				);
			}
			if (typeof value !== 'string') {
				throw new TypeError(`Localization catalog ${locale} message ${id} is not a string`);
			}
			const compiled = compileTemplate(value, `${locale}:${id}`);
			if (!sameStrings(compiled.placeholders, descriptor.placeholders)) {
				throw new TypeError(
					`Localization catalog ${locale} message ${id} has different placeholders`
				);
			}
			messages.set(id, compiled);
		}
		result.set(key, Object.freeze({ locale, direction: input.direction, messages }));
	}
	return result;
}

function compileTemplate(message: string, owner: string): CompiledTemplate {
	const tokens: TemplateToken[] = [];
	const placeholders: string[] = [];
	const seen = new Set<string>();
	let literal = '';
	const pushLiteral = (): void => {
		if (literal !== '') {
			tokens.push(literal);
			literal = '';
		}
	};

	for (let index = 0; index < message.length;) {
		const character = message[index];
		if (character === '{') {
			if (message[index + 1] === '{') {
				literal += '{';
				index += 2;
				continue;
			}
			const end = message.indexOf('}', index + 1);
			if (end < 0) {
				throw new TypeError(
					`Localization template ${owner} contains an unmatched opening brace`
				);
			}
			const placeholder = message.slice(index + 1, end);
			if (!PLACEHOLDER_NAME.test(placeholder)) {
				throw new TypeError(
					`Localization template ${owner} contains invalid placeholder {${placeholder}}`
				);
			}
			pushLiteral();
			tokens.push(Object.freeze({ placeholder }));
			if (!seen.has(placeholder)) {
				seen.add(placeholder);
				placeholders.push(placeholder);
			}
			index = end + 1;
			continue;
		}
		if (character === '}') {
			if (message[index + 1] !== '}') {
				throw new TypeError(
					`Localization template ${owner} contains an unmatched closing brace`
				);
			}
			literal += '}';
			index += 2;
			continue;
		}
		literal += character;
		index++;
	}
	pushLiteral();
	return Object.freeze({
		placeholders: Object.freeze(placeholders),
		tokens: Object.freeze(tokens)
	});
}

function formatTemplate(
	template: CompiledTemplate,
	values: Readonly<Record<string, LocalizationValue>>,
	id: string
): string {
	const keys = Object.keys(values);
	for (const placeholder of template.placeholders) {
		if (!Object.hasOwn(values, placeholder)) {
			throw new TypeError(
				`Localization message ${id} is missing placeholder: ${placeholder}`
			);
		}
	}
	for (const key of keys) {
		if (!template.placeholders.includes(key)) {
			throw new TypeError(`Localization message ${id} received unknown placeholder: ${key}`);
		}
	}
	return template.tokens
		.map((token) => {
			if (typeof token === 'string') return token;
			const value: unknown = values[token.placeholder];
			if (
				typeof value === 'string' ||
				typeof value === 'number' ||
				typeof value === 'boolean' ||
				value === null ||
				value === undefined
			) {
				return String(value);
			}
			throw new TypeError(
				`Localization message ${id} received an invalid placeholder value: ${token.placeholder}`
			);
		})
		.join('');
}

function canonicalizeLocale(locale: string): string {
	try {
		const canonical = Intl.getCanonicalLocales(locale.trim())[0];
		if (canonical === undefined) throw new RangeError('empty locale');
		return canonical;
	} catch {
		throw new TypeError(`Invalid localization locale: ${locale}`);
	}
}

function localeFallbacks(locale: string): readonly string[] {
	const result: string[] = [];
	let candidate = locale;
	while (candidate !== '') {
		result.push(candidate);
		const separator = candidate.lastIndexOf('-');
		if (separator < 0) break;
		candidate = candidate.slice(0, separator);
	}
	if (!result.some((candidateLocale) => candidateLocale.toLowerCase() === 'en'))
		result.push('en');
	return result;
}

function pseudoTranslate(value: string): string {
	return `\uFF3B${value.replace(/[aouei]/gu, '$&$&')}\uFF3D`;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}
