import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function resolveFromCwd(cwd: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}

export async function getDefaultEnvOutputPath(cwd: string): Promise<string> {
  const srcDir = path.join(cwd, "src");
  if (await pathExists(srcDir)) {
    return path.join(srcDir, "env.ts");
  }
  return path.join(cwd, "env.ts");
}

export async function getDefaultExampleInputPath(cwd: string): Promise<string> {
  const rootEnv = path.join(cwd, "env.ts");
  const srcEnv = path.join(cwd, "src", "env.ts");

  if (await pathExists(rootEnv)) return rootEnv;
  if (await pathExists(srcEnv)) return srcEnv;

  const srcDir = path.join(cwd, "src");
  if (await pathExists(srcDir)) {
    return srcEnv;
  }

  return rootEnv;
}

export async function ensureWritableTarget(targetPath: string, force: boolean): Promise<void> {
  if (!force && (await pathExists(targetPath))) {
    throw new Error(`"${targetPath}" already exists. Use --force if you want to replace it.`);
  }
}

export async function readTextFileOrThrow(filePath: string, label: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    throw new Error(
      `Could not read ${label} at "${filePath}". Check that the file exists and is readable.`,
    );
  }
}

export async function writeFileAtomic(targetPath: string, contents: string): Promise<void> {
  const directory = path.dirname(targetPath);
  const tempPath = path.join(
    directory,
    `.envil-tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(tempPath, contents, "utf8");
    await rename(tempPath, targetPath);
  } catch {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw new Error(
      `Could not write "${targetPath}". Check that the destination is writable and try again.`,
    );
  }
}
