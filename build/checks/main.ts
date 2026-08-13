import process from 'node:process';
import { assuranceReport } from './assurance.ts';
import { FileSystemRepository } from './repository.ts';
import { checkMap, checks } from './registry.ts';
import { compareDiagnostics } from './types.ts';

function selections(arguments_: readonly string[]): { readonly ids: readonly string[]; readonly paths: readonly string[]; readonly inspect: boolean } {
  const ids: string[] = []; const paths: string[] = []; let inspect = false;
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index];
    if (argument === '--inspect') inspect = true;
    else if (argument === '--check') {
      const id = arguments_[++index];
      if (id === undefined) throw new Error('--check requires an exact check id');
      ids.push(id);
    } else if (argument === '--path') {
      const path = arguments_[++index];
      if (path === undefined || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) throw new Error('--path requires one safe exact repository path');
      paths.push(path.replace(/^\.\//, ''));
    } else throw new Error(`Unknown argument ${argument}`);
  }
  return { ids, paths, inspect };
}

const repository = new FileSystemRepository(process.cwd());
const map = checkMap();
const options = selections(process.argv.slice(2));
if (options.inspect) {
  process.stdout.write(`${assuranceReport(repository)}\n`);
} else {
  const selected = options.ids.length === 0 ? checks : options.ids.map(id => {
    const check = map.get(id);
    if (check === undefined) throw new Error(`Unknown check id ${id}`);
    return check;
  });
  const context = { repository, registeredCheckIds: new Set(map.keys()) };
  const completeDiagnostics = (await Promise.all(selected.map(check => check.run(context)))).flat().sort(compareDiagnostics);
  const diagnostics = options.paths.length === 0 ? completeDiagnostics : completeDiagnostics.filter(item => options.paths.includes(item.path));
  for (const item of diagnostics) {
    const location = `${item.path}${item.line === undefined ? '' : `:${item.line}${item.column === undefined ? '' : `:${item.column}`}`}`;
    process.stderr.write(`${item.checkId} ${location}\n  ${item.problem}\n  Remediation: ${item.remediation}\n`);
  }
  if (diagnostics.length > 0) process.exitCode = 1;
  else {
    const focus = options.paths.length === 0 ? '' : ` with explicit path focus (${options.paths.join(', ')}); run the full check before handoff`;
    process.stdout.write(`Checked ${selected.length} repository control${selected.length === 1 ? '' : 's'}${focus}.\n`);
  }
}
