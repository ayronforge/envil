import { Option, Schema, SchemaAST } from "effect";

import { REDACTED_ANNOTATION } from "./schemas.ts";

function hasRedactedAnnotation(ast: SchemaAST.AST, visited: Set<SchemaAST.AST>): boolean {
  if (visited.has(ast)) {
    return false;
  }
  visited.add(ast);

  const redacted = Option.getOrUndefined(
    SchemaAST.getAnnotation<boolean>(ast, REDACTED_ANNOTATION),
  );
  if (redacted === true) {
    return true;
  }

  if (SchemaAST.isTransformation(ast)) {
    return hasRedactedAnnotation(ast.from, visited) || hasRedactedAnnotation(ast.to, visited);
  }
  if (SchemaAST.isRefinement(ast)) {
    return hasRedactedAnnotation(ast.from, visited);
  }
  if (SchemaAST.isUnion(ast)) {
    return ast.types.some((member) => hasRedactedAnnotation(member, visited));
  }
  if (SchemaAST.isSuspend(ast)) {
    return hasRedactedAnnotation(ast.f(), visited);
  }

  return false;
}

/**
 * Returns whether a schema contains envil's redacted wrapper, including when
 * that wrapper is nested inside optional or default combinators.
 */
export function isRedactedSchema(schema: Schema.Schema.Any): boolean {
  return hasRedactedAnnotation(schema.ast, new Set());
}

/**
 * Returns a safe schema identifier for diagnostics without formatting the
 * rejected input.
 */
export function getSchemaIdentifier(schema: Schema.Schema.Any): string | undefined {
  return Option.getOrUndefined(SchemaAST.getIdentifierAnnotation(schema.ast));
}
