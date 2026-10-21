import { parseId, type IdKind } from "../model";

/**
 * A tiny schema reader that collects every problem it finds instead of stopping at the first.
 * When a file fails to open, the author gets a full list of what is wrong and where.
 */
export class Reader {
  readonly errors: string[] = [];

  fail(path: string, message: string): undefined {
    this.errors.push(`${path}: ${message}`);
    return undefined;
  }

  object(value: unknown, path: string): Record<string, unknown> | undefined {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return this.fail(path, "expected an object");
  }

  array(value: unknown, path: string): readonly unknown[] | undefined {
    return Array.isArray(value) ? value : this.fail(path, "expected an array");
  }

  string(value: unknown, path: string): string | undefined {
    return typeof value === "string" ? value : this.fail(path, "expected a string");
  }

  optionalString(value: unknown, path: string): string | undefined {
    return value === undefined ? undefined : this.string(value, path);
  }

  oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T | undefined {
    if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
      return value as T;
    }
    return this.fail(path, `expected one of ${allowed.join(", ")}`);
  }

  integer(value: unknown, min: number, max: number, path: string): number | undefined {
    if (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max) {
      return value;
    }
    return this.fail(path, `expected an integer between ${min} and ${max}`);
  }

  id<K extends IdKind>(kind: K, value: unknown, path: string) {
    return parseId(kind, value) ?? this.fail(path, `expected a ${kind} id`);
  }

  /** Reads each element, keeping only the ones that parsed. Errors are already recorded. */
  each<T>(value: unknown, path: string, read: (item: unknown, path: string) => T | undefined): T[] {
    const items = this.array(value, path) ?? [];
    return items
      .map((item, index) => read(item, `${path}[${index}]`))
      .filter((item): item is T => item !== undefined);
  }
}
