import { spawn } from 'node:child_process';

// Runs a command and collects stdout and stderr together. Throws on a non-zero
// exit unless allowFail is set. `redact` strings are hidden from errors.
export function run(command, args, { cwd, env, allowFail = false, redact = [] } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let stdout = '';
    child.stdout.on('data', (d) => { output += d; stdout += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && !allowFail) {
        let message = `${command} ${args.join(' ')} exited with ${code}\n${output.slice(-3000)}`;
        for (const secret of redact) if (secret) message = message.split(secret).join('***');
        reject(new Error(message));
      } else {
        resolvePromise({ code, output, stdout: stdout.trim() });
      }
    });
  });
}
