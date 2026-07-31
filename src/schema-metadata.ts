import { Schema, SchemaAST } from "effect";

import { REDACTED_ANNOTATION } from "./schemas.ts";

function hasRedactedAnnotation(ast: SchemaAST.AST, visited: Set<SchemaAST.AST>): boolean {
  if (visited.has(ast)) {
    return false;
  }
  visited.add(ast);

  if (SchemaAST.resolveAt<boolean>(REDACTED_ANNOTATION)(ast) === true) {
    return true;
  }
  const representation = SchemaAST.resolveAt<unknown>("representation")(ast);
  if (
    typeof representation === "object" &&
    representation !== null &&
    "id" in representation &&
    representation.id === "effect/schema/Redacted"
  ) {
    return true;
  }

  if (ast.encoding?.some((link) => hasRedactedAnnotation(link.to, visited))) {
    return true;
  }
  if (SchemaAST.isUnion(ast)) {
    return ast.types.some((member) => hasRedactedAnnotation(member, visited));
  }
  if (SchemaAST.isSuspend(ast)) {
    return hasRedactedAnnotation(ast.thunk(), visited);
  }
  if (SchemaAST.isDeclaration(ast)) {
    return ast.typeParameters.some((parameter) => hasRedactedAnnotation(parameter, visited));
  }
  if (SchemaAST.isArrays(ast)) {
    return [...ast.elements, ...ast.rest].some((element) =>
      hasRedactedAnnotation(element, visited),
    );
  }
  if (SchemaAST.isObjects(ast)) {
    return (
      ast.propertySignatures.some((property) => hasRedactedAnnotation(property.type, visited)) ||
      ast.indexSignatures.some((index) => hasRedactedAnnotation(index.type, visited))
    );
  }

  return false;
}

export function isRedactedSchema(schema: Schema.Top): boolean {
  return hasRedactedAnnotation(schema.ast, new Set());
}

export function getSchemaIdentifier(schema: Schema.Top): string | undefined {
  return SchemaAST.resolveIdentifier(schema.ast);
}
