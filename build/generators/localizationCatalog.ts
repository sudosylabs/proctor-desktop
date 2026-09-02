import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { getMessagePlaceholders } from '../../src/prctr/base/common/localization.ts';
import type { Repository } from '../checks/types.ts';
import type { Generator } from './registry.ts';

export interface ExtractedLocalizationMessage {
  readonly id: string;
  readonly defaultMessage: string;
  readonly description: string;
  readonly placeholders: readonly string[];
  readonly sourcePath: string;
}

const GENERATED_SOURCE = 'src/prctr/base/common/localizationCatalog.generated.ts';
const ENGLISH_CATALOG = 'resources/localization/en.json';

export const localizationCatalogGenerator: Generator = {
  id: 'localization.catalog',
  inputs: ['src/prctr'],
  committedOutputs: [GENERATED_SOURCE, ENGLISH_CATALOG],
  buildOutputs: [],
  generate(repository, outputRoot) {
    const messages = extractLocalizationMessages(repository);
    writeOutput(outputRoot, GENERATED_SOURCE, renderTypeScript(messages));
    writeOutput(outputRoot, ENGLISH_CATALOG, renderCatalog(messages));
  }
};

export function extractLocalizationMessages(repository: Repository): readonly ExtractedLocalizationMessage[] {
  const messages = new Map<string, ExtractedLocalizationMessage>();
  const sourcePaths = repository.files()
    .filter(path => path.startsWith('src/prctr/') && path.endsWith('.ts') && path !== GENERATED_SOURCE)
    .sort();
  for (const sourcePath of sourcePaths) {
    const source = ts.createSourceFile(
      sourcePath,
      repository.read(sourcePath),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const identifiers = importedDefineMessageIdentifiers(source); if (sourcePath === 'src/prctr/platform/settings/common/settingsManifest.ts') identifiers.add('defineMessage');
    if (identifiers.size === 0) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && identifiers.has(node.expression.text)) {
        const message = parseMessageCall(sourcePath, source, node);
        const existing = messages.get(message.id);
        if (existing !== undefined) {
          throw new Error(`Duplicate localization message ${message.id} in ${existing.sourcePath} and ${sourcePath}`);
        }
        messages.set(message.id, message);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...messages.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function importedDefineMessageIdentifiers(source: ts.SourceFile): Set<string> {
  const result = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || !statement.moduleSpecifier.text.endsWith('/localization.js')) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === 'defineMessage') {
        result.add(element.name.text);
      }
    }
  }
  return result;
}

function parseMessageCall(
  sourcePath: string,
  source: ts.SourceFile,
  call: ts.CallExpression
): ExtractedLocalizationMessage {
  const argument = call.arguments[0];
  if (call.arguments.length !== 1 || argument === undefined || !ts.isObjectLiteralExpression(argument)) {
    throw sourceError(sourcePath, source, call, 'defineMessage requires one object-literal argument');
  }
  const allowed = new Set(['id', 'defaultMessage', 'description']);
  const values = new Map<string, string>();
  for (const property of argument.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      throw sourceError(sourcePath, source, property, `localization message ${property.name.text} must be a static string`);
    }
    if (!ts.isPropertyAssignment(property)) {
      throw sourceError(sourcePath, source, property, 'localization message properties must be assignments');
    }
    const name = propertyName(property.name);
    if (name === undefined || !allowed.has(name)) {
      throw sourceError(sourcePath, source, property, 'localization message contains an unknown property');
    }
    if (values.has(name)) {
      throw sourceError(sourcePath, source, property, `localization message repeats ${name}`);
    }
    const value = stringLiteral(property.initializer);
    if (value === undefined) {
      throw sourceError(sourcePath, source, property, `localization message ${name} must be a static string`);
    }
    values.set(name, value);
  }
  const id = requiredValue(values, 'id', sourcePath, source, call);
  const defaultMessage = requiredValue(values, 'defaultMessage', sourcePath, source, call);
  const description = requiredValue(values, 'description', sourcePath, source, call);
  return Object.freeze({
    id,
    defaultMessage,
    description,
    placeholders: Object.freeze([...getMessagePlaceholders(defaultMessage)]),
    sourcePath
  });
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

function stringLiteral(node: ts.Expression): string | undefined {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;
}

function requiredValue(
  values: ReadonlyMap<string, string>,
  name: string,
  sourcePath: string,
  source: ts.SourceFile,
  call: ts.CallExpression
): string {
  const value = values.get(name);
  if (value === undefined) throw sourceError(sourcePath, source, call, `localization message requires ${name}`);
  return value;
}

function sourceError(sourcePath: string, source: ts.SourceFile, node: ts.Node, problem: string): Error {
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return new Error(`${sourcePath}:${position.line + 1}:${position.character + 1}: ${problem}`);
}

function renderTypeScript(messages: readonly ExtractedLocalizationMessage[]): string {
  const entries = messages.map(message => `    ${JSON.stringify(message.id)}: ${JSON.stringify(message.defaultMessage)}`).join(',\n');
  return `// @${'generated'} by localization.catalog from static defineMessage declarations.\n`
    + `import type { LocalizationCatalog } from './localization.js';\n\n`
    + `export const englishCatalog: LocalizationCatalog = Object.freeze({\n`
    + `  locale: 'en',\n`
    + `  direction: 'ltr',\n`
    + `  messages: Object.freeze({${entries === '' ? '' : `\n${entries}\n  `}})\n`
    + `});\n`;
}

function renderCatalog(messages: readonly ExtractedLocalizationMessage[]): string {
  return `${JSON.stringify({
    generatedBy: 'localization.catalog',
    schemaVersion: 1,
    locale: 'en',
    direction: 'ltr',
    messages: Object.fromEntries(messages.map(message => [message.id, {
      message: message.defaultMessage,
      description: message.description,
      placeholders: message.placeholders,
      source: message.sourcePath
    }]))
  }, null, 2)}\n`;
}

function writeOutput(outputRoot: string, path: string, content: string): void {
  const destination = join(outputRoot, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content, 'utf8');
}
