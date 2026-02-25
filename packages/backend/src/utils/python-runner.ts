import { spawn } from 'node:child_process';
import { pythonRuntimeService } from '../services/python-runtime';

const MAX_AUTO_INSTALL_ROUNDS = 3;

export interface PythonRunnerOptions {
  code: string;
  input?: string;
  actorUserId?: number | null;
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
  autoInstalledRequirements?: string[];
}

export const runPythonSnippet = async (options: PythonRunnerOptions): Promise<PythonRunnerResult> => {
  const { code, input, actorUserId, timeoutMs, maxOutputChars, maxSourceChars } = options;
  if (!code || !code.trim()) {
    throw new Error('Python code不能为空');
  }
  const normalizedCode = code.replace(/\r\n/g, '\n');
  if (normalizedCode.length > maxSourceChars) {
    throw new Error(`Python 代码超出限制（最大 ${maxSourceChars} 字符）`);
  }
  const command = await pythonRuntimeService.getManagedPythonPath();
  const args = ['-c', normalizedCode];
  const outputLimit = Math.max(256, maxOutputChars);
  const startedAt = Date.now();

  const attemptRun = (): Promise<PythonRunnerResult> =>
    new Promise((resolve, reject) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutLength = 0;
      let stderrLength = 0;
      let truncated = false;
      const attemptStartedAt = Date.now();

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

      const child = spawn(command, args, { stdio: 'pipe' });
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
          durationMs: Math.max(0, Date.now() - attemptStartedAt),
          truncated,
        });
      });

      if (typeof input === 'string' && input.length > 0) {
        child.stdin.write(input);
      }
      child.stdin.end();
    });

  const autoInstalledRequirements: string[] = [];
  let lastResult: PythonRunnerResult | null = null;
  let installFailureReason = '';
  let autoInstallRounds = 0;
  const installedRequirementSet = new Set<string>();
  const canAutoInstall =
    Boolean(actorUserId) && (await pythonRuntimeService.getAutoInstallOnMissing());

  while (true) {
    const result = await attemptRun().catch((error: any) => {
      throw new Error(
        error?.message
          ? `Python 命令执行失败：${error.message}`
          : 'Python 命令执行失败',
      );
    });
    lastResult = result;
    if ((result.exitCode ?? 1) === 0) {
      break;
    }
    if (!canAutoInstall) {
      break;
    }
    if (autoInstallRounds >= MAX_AUTO_INSTALL_ROUNDS) {
      break;
    }

    const output = `${result.stderr}\n${result.stdout}`;
    const requirements = pythonRuntimeService
      .parseMissingRequirementsFromOutput(output)
      .filter((requirement) => !installedRequirementSet.has(requirement));
    if (requirements.length === 0) {
      break;
    }

    try {
      await pythonRuntimeService.installRequirements({
        requirements,
        source: 'python_auto',
      });
      for (const requirement of requirements) {
        installedRequirementSet.add(requirement);
        autoInstalledRequirements.push(requirement);
      }
      autoInstallRounds += 1;
    } catch (installError: any) {
      installFailureReason =
        installError instanceof Error
          ? installError.message
          : String(installError || 'unknown error');
      break;
    }
  }

  if (!lastResult) {
    throw new Error('Python 命令执行失败');
  }

  const finalStderrLines: string[] = [];
  const trimmedStderr = (lastResult.stderr || '').trim();
  if (trimmedStderr) {
    finalStderrLines.push(trimmedStderr);
  }
  if (installFailureReason) {
    finalStderrLines.push(`自动安装依赖失败：${installFailureReason}`);
  }

  return {
    ...lastResult,
    stderr: finalStderrLines.join('\n').trim(),
    durationMs: Math.max(0, Date.now() - startedAt),
    autoInstalledRequirements: autoInstalledRequirements.length > 0 ? autoInstalledRequirements : undefined,
  };
};
