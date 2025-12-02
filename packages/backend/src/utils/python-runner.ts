import { spawn } from 'node:child_process';

export interface PythonRunnerOptions {
  code: string;
  input?: string;
  command: string;
  args?: string[];
  timeoutMs: number;
  maxOutputChars: number;
  maxSourceChars: number;
}

export interface PythonRunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  truncated: boolean;
}

const sanitizeArgs = (args?: string[]) =>
  Array.isArray(args) ? args.map((value) => value ?? '').filter((value) => typeof value === 'string') : [];

export const runPythonSnippet = async (options: PythonRunnerOptions): Promise<PythonRunnerResult> => {
  const { code, input, command, timeoutMs, maxOutputChars, maxSourceChars } = options;
  if (!code || !code.trim()) {
    throw new Error('Python code不能为空');
  }
  const normalizedCode = code.replace(/\r\n/g, '\n');
  if (normalizedCode.length > maxSourceChars) {
    throw new Error(`Python 代码超出限制（最大 ${maxSourceChars} 字符）`);
  }
  const args = [...sanitizeArgs(options.args), '-c', normalizedCode];
  const outputLimit = Math.max(256, maxOutputChars);
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutLength = 0;
  let stderrLength = 0;
  let truncated = false;
  const startedAt = Date.now();

  const collect = (chunks: Buffer[], chunk: Buffer, currentLength: number) => {
    if (truncated) return currentLength;
    const nextLength = currentLength + chunk.length;
    if (nextLength <= outputLimit) {
      chunks.push(chunk);
      return nextLength;
    }
    const remaining = outputLimit - currentLength;
    if (remaining > 0) {
      chunks.push(chunk.subarray(0, remaining));
    }
    truncated = true;
    return outputLimit;
  };

  const attemptRun = (cmd: string): Promise<PythonRunnerResult> =>
    new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: 'pipe' });
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              child.kill('SIGKILL');
              reject(new Error(`Python 执行超时（${timeoutMs}ms）`));
            }, timeoutMs)
          : null;

      child.on('error', (error) => {
        if (timer) clearTimeout(timer);
        reject(error);
      });

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutLength = collect(stdoutChunks, chunk, stdoutLength);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrLength = collect(stderrChunks, chunk, stderrLength);
      });

      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          exitCode: typeof code === 'number' ? code : null,
          durationMs: Math.max(0, Date.now() - startedAt),
          truncated,
        });
      });

      if (typeof input === 'string' && input.length > 0) {
        child.stdin.write(input);
      }
      child.stdin.end();
    });

  return attemptRun(command).catch((error: any) => {
    if (error?.code === 'ENOENT' && command === 'python3') {
      return attemptRun('python');
    }
    throw new Error(
      error?.message
        ? `Python 命令执行失败：${error.message}`
        : 'Python 命令执行失败',
    );
  });
};
