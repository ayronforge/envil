import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  applyReplacements,
  createDirectTransformContext,
  createResolvedTransformContext,
  type ModuleResolver,
  type Replacement,
  type TransformContext,
  type TransformResult,
} from "./transform/ast.ts";
import { collectClientReplacements } from "./transform/client.ts";
import { collectServerReplacements } from "./transform/server.ts";

/** Runtime selected for an Envil build output. */
export type EnvilBuildTarget = "server" | "client";

/** Controls how Envil transforms environment definitions. */
export interface EnvilPluginOptions {
  /**
   * Explicit build target. Vite detects this per module graph when omitted.
   * Other bundlers default to client so an ambiguous build fails closed.
   */
  readonly target?: EnvilBuildTarget;
}

const runtimeTargetMarker = "__ENVIL_RUNTIME_TARGET__";
const envilModuleName = "@ayronforge/envil";
const runtimeTargetExpression =
  /Reflect\.get\(\s*globalThis\s*,\s*Symbol\.for\(\s*["']__ENVIL_RUNTIME_TARGET__["']\s*\)\s*,?\s*\)/g;
const packageEligibility = new Map<string, Promise<boolean>>();

function nodeModulePackageRoot(id: string): string | undefined {
  const normalized = id.replaceAll("\\", "/");
  const marker = "/node_modules/";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex === -1) {
    return undefined;
  }

  const packagePath = normalized.slice(markerIndex + marker.length).split("/");
  const first = packagePath[0];
  if (first === undefined || first === "") {
    return undefined;
  }
  if (!first.startsWith("@")) {
    return `${normalized.slice(0, markerIndex + marker.length)}${first}`;
  }
  const second = packagePath[1];
  return second === undefined
    ? undefined
    : `${normalized.slice(0, markerIndex + marker.length)}${first}/${second}`;
}

function manifestUsesEnvil(manifest: unknown): boolean {
  if (typeof manifest !== "object" || manifest === null) {
    return false;
  }
  for (const field of [
    "dependencies",
    "peerDependencies",
    "optionalDependencies",
    "devDependencies",
  ]) {
    const dependencies: unknown = Reflect.get(manifest, field);
    if (
      typeof dependencies === "object" &&
      dependencies !== null &&
      Object.hasOwn(dependencies, envilModuleName)
    ) {
      return true;
    }
  }
  return false;
}

function packageUsesEnvil(packageRoot: string): Promise<boolean> {
  const existing = packageEligibility.get(packageRoot);
  if (existing !== undefined) {
    return existing;
  }
  const eligibility = readFile(join(packageRoot, "package.json"), "utf8").then(
    (source) => {
      const manifest: unknown = JSON.parse(source);
      return manifestUsesEnvil(manifest);
    },
    () => false,
  );
  packageEligibility.set(packageRoot, eligibility);
  return eligibility;
}

async function shouldResolveImports(code: string, id: string): Promise<boolean> {
  const packageRoot = nodeModulePackageRoot(id);
  if (packageRoot === undefined || code.includes(envilModuleName)) {
    return true;
  }
  return packageUsesEnvil(packageRoot);
}

function targetReplacements(
  context: TransformContext,
  target: EnvilBuildTarget,
): ReadonlyArray<Replacement> {
  return target === "client"
    ? collectClientReplacements(context)
    : collectServerReplacements(context);
}

function runtimeTargetReplacements(
  code: string,
  target: EnvilBuildTarget,
): ReadonlyArray<Replacement> {
  if (!code.includes(runtimeTargetMarker)) {
    return [];
  }

  return [...code.matchAll(runtimeTargetExpression)].flatMap(
    (match): ReadonlyArray<Replacement> => {
      if (match.index === undefined) {
        return [];
      }
      return [
        {
          start: match.index,
          end: match.index + match[0].length,
          text: JSON.stringify(target),
        },
      ];
    },
  );
}

function transformModule(
  code: string,
  id: string,
  target: EnvilBuildTarget,
  context: TransformContext | undefined,
): TransformResult | undefined {
  return applyReplacements(code, id, [
    ...runtimeTargetReplacements(code, target),
    ...(context === undefined ? [] : targetReplacements(context, target)),
  ]);
}

/**
 * Compiles direct Envil imports synchronously for Babel and focused source tests.
 */
export function transformEnvilModule(
  code: string,
  id: string,
  target: EnvilBuildTarget,
): TransformResult | undefined {
  const cleanId = id.split(/[?#]/, 1)[0] ?? id;
  return transformModule(code, cleanId, target, createDirectTransformContext(code, cleanId));
}

/** Compiles Envil imports after resolving their re-export origin with the active bundler. */
export async function transformResolvedEnvilModule(
  code: string,
  id: string,
  target: EnvilBuildTarget,
  resolveModule: ModuleResolver,
): Promise<TransformResult | undefined> {
  const cleanId = id.split(/[?#]/, 1)[0] ?? id;
  const context = (await shouldResolveImports(code, cleanId))
    ? await createResolvedTransformContext(code, cleanId, resolveModule)
    : undefined;
  return transformModule(code, cleanId, target, context);
}
