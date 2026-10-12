/** CSS view-transition-name must be an ident: letters, digits, hyphen, underscore. */
export function vtName(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/[^\w-]+/g, "_").slice(0, 64)}`;
}
