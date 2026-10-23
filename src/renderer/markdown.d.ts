export type MarkdownBlock =
  | { type: 'code'; language: string; text: string; start: number }
  | { type: 'heading'; level: number; text: string; start: number }
  | { type: 'list'; ordered: boolean; items: string[]; start: number }
  | { type: 'paragraph'; text: string; start: number };

export function parseMarkdown(input: string): MarkdownBlock[];
