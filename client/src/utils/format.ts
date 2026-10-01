const oneDecimal = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "1,8", not "1.8": a German reader parses the dot as a thousands separator. */
export function decimal(value: number): string {
  return oneDecimal.format(value);
}
