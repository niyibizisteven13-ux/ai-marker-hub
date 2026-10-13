/**
 * PLACEHOLDER used only by this package's tests.
 * In your app, DO NOT copy this file: AiResponseView imports your existing ./MarkdownRenderer.
 */
export default function MarkdownRenderer({ content }: { content: string }) {
  return <div className="whitespace-pre-wrap">{content}</div>;
}
