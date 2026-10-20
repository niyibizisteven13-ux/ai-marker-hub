import type { ReactNode } from "react";
import { ActivityLine, Step } from "./ActivityLine";
import type { ChatStreamState } from "../hooks/useChatStream";

interface GeneratedFile {
  id: string;
  name: string;
  url: string;
  mime?: string;
}

interface Props {
  stream: ChatStreamState;
  renderMarkdown?: (text: string) => ReactNode;
}

export function StreamingMessage({ stream, renderMarkdown }: Props) {
  const { phase, text, current, steps, files, error, startedAt, endedAt } = stream;
  const live = phase === "thinking" || phase === "streaming";
  const running = steps.some((s) => s.status === "running");

  const busy = live && (!text || running || Boolean(current));

  return (
    <div className="bw-message space-y-2.5">
      <ActivityLine steps={steps} current={current} busy={busy} startedAt={startedAt} endedAt={endedAt} />

      {text && (
        <div className={phase === "streaming" && !busy ? "bw-caret" : undefined}>
          {renderMarkdown ? renderMarkdown(text) : <div style={{ whiteSpace: "pre-wrap" }}>{text}</div>}
        </div>
      )}

      {files.length > 0 && (
        <div className="bw-files">
          {files.map((f) => (
            <a key={f.id} className="bw-file" href={f.url} download={f.name}>
              <span aria-hidden="true">📄</span>
              <span>{f.name}</span>
            </a>
          ))}
        </div>
      )}

      {phase === "stopped" && <div className="bw-time">Stopped</div>}
      {phase === "error" && <div className="bw-error">{error ?? "Something went wrong. Please try again."}</div>}
    </div>
  );
}

export default StreamingMessage;
