/**
 * Entry point for `code --extensionTestsPath`. VS Code calls run().
 * A thrown error fails the host run with a non-zero exit.
 */
import { runAll } from './suite';

export async function run(): Promise<void> {
  console.log('\n── OMNIS CODE in-host verification ──\n');
  await runAll();
}
