import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ensureWritableTarget,
  getDefaultEnvOutputPath,
  getDefaultExampleInputPath,
  pathExists,
  readTextFileOrThrow,
  resolveFromCwd,
  writeFileAtomic,
} from "./fs-utils.ts";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function makeTempDir(suffix: string) {
  tempDir = await mkdtemp(path.join(os.tmpdir(), `envil-fs-${suffix}-`));
  return tempDir;
}

describe("pathExists", () => {
  test("returns true for existing file", async () => {
    const dir = await makeTempDir("exists-file");
    const filePath = path.join(dir, "test.txt");
    await writeFile(filePath, "content");
    expect(await pathExists(filePath)).toBe(true);
  });

  test("returns true for existing directory", async () => {
    const dir = await makeTempDir("exists-dir");
    const subDir = path.join(dir, "sub");
    await mkdir(subDir);
    expect(await pathExists(subDir)).toBe(true);
  });

  test("returns false for non-existing path", async () => {
    const dir = await makeTempDir("no-exist");
    expect(await pathExists(path.join(dir, "nope.txt"))).toBe(false);
  });
});

describe("resolveFromCwd", () => {
  test("resolves relative path against cwd", () => {
    const result = resolveFromCwd("/home/user/project", "src/env.ts");
    expect(result).toBe("/home/user/project/src/env.ts");
  });

  test("returns absolute path unchanged", () => {
    const result = resolveFromCwd("/home/user/project", "/tmp/env.ts");
    expect(result).toBe("/tmp/env.ts");
  });

  test("resolves dot-relative path", () => {
    const result = resolveFromCwd("/home/user/project", "./src/env.ts");
    expect(result).toBe("/home/user/project/src/env.ts");
  });
});

describe("getDefaultEnvOutputPath", () => {
  test("returns src/env.ts when src/ exists", async () => {
    const dir = await makeTempDir("default-out-src");
    await mkdir(path.join(dir, "src"));
    const result = await getDefaultEnvOutputPath(dir);
    expect(result).toBe(path.join(dir, "src", "env.ts"));
  });

  test("returns env.ts in root when no src/", async () => {
    const dir = await makeTempDir("default-out-nosrc");
    const result = await getDefaultEnvOutputPath(dir);
    expect(result).toBe(path.join(dir, "env.ts"));
  });
});

describe("getDefaultExampleInputPath", () => {
  test("returns root env.ts when it exists", async () => {
    const dir = await makeTempDir("input-root");
    await writeFile(path.join(dir, "env.ts"), "content");
    const result = await getDefaultExampleInputPath(dir);
    expect(result).toBe(path.join(dir, "env.ts"));
  });

  test("returns src/env.ts when root missing but src/env.ts exists", async () => {
    const dir = await makeTempDir("input-src");
    await mkdir(path.join(dir, "src"));
    await writeFile(path.join(dir, "src", "env.ts"), "content");
    const result = await getDefaultExampleInputPath(dir);
    expect(result).toBe(path.join(dir, "src", "env.ts"));
  });

  test("prefers root env.ts over src/env.ts", async () => {
    const dir = await makeTempDir("input-both");
    await writeFile(path.join(dir, "env.ts"), "root");
    await mkdir(path.join(dir, "src"));
    await writeFile(path.join(dir, "src", "env.ts"), "src");
    const result = await getDefaultExampleInputPath(dir);
    expect(result).toBe(path.join(dir, "env.ts"));
  });

  test("falls back to src/env.ts when neither exists but src/ dir does", async () => {
    const dir = await makeTempDir("input-fallback-src");
    await mkdir(path.join(dir, "src"));
    const result = await getDefaultExampleInputPath(dir);
    expect(result).toBe(path.join(dir, "src", "env.ts"));
  });

  test("falls back to root env.ts when nothing exists", async () => {
    const dir = await makeTempDir("input-fallback-root");
    const result = await getDefaultExampleInputPath(dir);
    expect(result).toBe(path.join(dir, "env.ts"));
  });
});

describe("ensureWritableTarget", () => {
  test("throws when file exists and force is false", async () => {
    const dir = await makeTempDir("writable-exists");
    const filePath = path.join(dir, "existing.ts");
    await writeFile(filePath, "content");
    await expect(ensureWritableTarget(filePath, false)).rejects.toThrow("already exists");
  });

  test("does not throw when file exists and force is true", async () => {
    const dir = await makeTempDir("writable-force");
    const filePath = path.join(dir, "existing.ts");
    await writeFile(filePath, "content");
    await expect(ensureWritableTarget(filePath, true)).resolves.toBeUndefined();
  });

  test("does not throw when file does not exist", async () => {
    const dir = await makeTempDir("writable-nofile");
    const filePath = path.join(dir, "new.ts");
    await expect(ensureWritableTarget(filePath, false)).resolves.toBeUndefined();
  });
});

describe("readTextFileOrThrow", () => {
  test("reads file content", async () => {
    const dir = await makeTempDir("read-ok");
    const filePath = path.join(dir, "data.txt");
    await writeFile(filePath, "hello world");
    const content = await readTextFileOrThrow(filePath, "test file");
    expect(content).toBe("hello world");
  });

  test("throws with label on missing file", async () => {
    const dir = await makeTempDir("read-missing");
    await expect(readTextFileOrThrow(path.join(dir, "nope.txt"), "config")).rejects.toThrow(
      "Unable to read config",
    );
  });
});

describe("writeFileAtomic", () => {
  test("writes file content", async () => {
    const dir = await makeTempDir("write-basic");
    const filePath = path.join(dir, "output.ts");
    await writeFileAtomic(filePath, "generated code");
    const content = await readFile(filePath, "utf8");
    expect(content).toBe("generated code");
  });

  test("creates intermediate directories", async () => {
    const dir = await makeTempDir("write-nested");
    const filePath = path.join(dir, "a", "b", "output.ts");
    await writeFileAtomic(filePath, "nested content");
    const content = await readFile(filePath, "utf8");
    expect(content).toBe("nested content");
  });

  test("overwrites existing file", async () => {
    const dir = await makeTempDir("write-overwrite");
    const filePath = path.join(dir, "output.ts");
    await writeFile(filePath, "old content");
    await writeFileAtomic(filePath, "new content");
    const content = await readFile(filePath, "utf8");
    expect(content).toBe("new content");
  });
});
