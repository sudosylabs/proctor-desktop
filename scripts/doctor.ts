import { inspectEnvironment } from '../build/lib/environment.ts';

if (process.argv.length > 2) throw new Error('Usage: npm run doctor');
const facts = inspectEnvironment();
for (const fact of facts) console.log(`${fact.ok ? 'OK' : 'MISSING'} ${fact.name}: ${fact.detail}`);
if (facts.some((fact) => !fact.ok)) process.exitCode = 1;
